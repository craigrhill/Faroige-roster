// Source for netlify/functions/foroige.mjs (built by `npm run build:function`).
//
// Volunteer rota for a Foroige club. Everything lives in the private Netlify
// Blobs store "foroige" and nothing here is ever published. Access is by
// personal code, which proves who someone is; a signed token then keeps them
// signed in for TOKEN_DAYS.
//
// The rule this exists to enforce: every club night and every event needs a
// set number of leaders on it (3 by default). On a club night one of them
// must hold the building training (1 by default); at an event, nobody has to
// (0 by default), because the training is about the building. All three
// numbers are per club and any of them can be overridden on a single night
// or event. The page shows the shortfall; the numbers live here.
//
// Three roles, held as flags on a person. The field names match the sibling
// Scouts rota so the two stay diffable; the words shown to people differ:
//   secretary  the club coordinator. Keeps the roster and the calendar: what
//              is on, when, whether it is called off, and how many leaders it
//              needs. On roster.html.
//   lead       the club leader. Puts anyone on a night, and is not held to
//              the numbers. On rota.html.
//   (neither)  a leader: puts themselves on a night while there is a place
//              for them. First come, first served.
// While no coordinator exists yet, club leaders hold the coordinator's powers
// so nobody is locked out.
//
// Keys in the store:
//   secret          HMAC key, generated on first use, never leaves the server
//   roster          { people: [{ id, name, sections, trained, lead, secretary, codeHash }] }
//   calendar        { entries: [{ id, kind, date, endDate, title, location,
//                                 details, need, needTrained, off }] }
//                   The club's own calendar, kept by the coordinator. kind is
//                   "m" for a club night and "e" for an event; that is what
//                   decides whether the training rule applies. While this is
//                   empty the pages fall back to rota-config.json.
//   section/<key>   { required, requiredTrained, requiredTrainedEvents,
//                     slots: { <slotId>: { who: [personId] } } }
//                   Only who is on a night lives here. What it needs, and
//                   whether it is on at all, are on its calendar entry.
//
// Slot ids are made by the page: "m:YYYY-MM-DD" for a club night,
// "e:YYYY-MM-DD:Title" for an event. The server stores ticks against whatever
// ids it is given, so the page owns the calendar.
//
// Every write is read-modify-write guarded by the document's etag, retried on
// a conflict, so two people editing at once cannot overwrite each other.
//
// API (all JSON; auth by the x-rota-token header):
//   OPTIONS                                         204
//   GET    ?sections=a,b                            { me, people, sections, calendar }
//   POST   ?a=bootstrap  x-admin-password  {name,sections}  { person, code }  first coordinator
//   POST   ?a=login                        {code}   { token, me }
//   POST   ?a=slot     {section,id,add?,remove?}                 { section }
//   POST   ?a=required {section,required?,requiredTrained?,requiredTrainedEvents?}
//                                                            { section }   coordinator
//   POST   ?a=person   {name,sections,trained,lead,secretary}  { person, code }   coordinator
//   POST   ?a=people   {people:[{name,sections,trained,lead}]} { added, skipped }  coordinator
//   POST   ?a=person-update {id,name?,sections?,trained?,lead?,secretary?}  { person }
//   POST   ?a=person-remove {id,sections}                     { people }
//   POST   ?a=recode   {id}                                   { code }
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const STORE = "foroige";
const TOKEN_DAYS = 365; // a code signs a phone in for a year
const DEFAULT_REQUIRED = 3;        // leaders on every club night and event
const DEFAULT_REQUIRED_TRAINED = 1; // of whom this many must hold the training
const DEFAULT_REQUIRED_TRAINED_EVENTS = 0; // but not at an event, away from the building
const MAX_BULK = 100;              // names accepted in one paste
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-password, x-rota-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers });
const fail = (status, error) => json(status, { error });

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// No password is baked in here. Set ADMIN_PASSWORD in Netlify, scoped to
// Functions, and redeploy. Unset means the club cannot be bootstrapped, which
// is the safe way round: a hash committed to a repo is a password in the repo.
function adminOk(req) {
  const envPw = process.env.ADMIN_PASSWORD;
  if (!envPw) return false;
  return safeEqual(req.headers.get("x-admin-password") || "", envPw);
}

// ---- store access with optimistic concurrency ----
async function readDoc(store, key, fallback) {
  const r = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
  return r && r.data ? { doc: r.data, etag: r.etag } : { doc: fallback(), etag: null };
}
async function update(store, key, fallback, fn) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { doc, etag } = await readDoc(store, key, fallback);
    const next = fn(doc);
    if (next === false) return doc;
    next.updatedAt = new Date().toISOString();
    const r = await store.set(key, JSON.stringify(next), etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (r.modified !== false) return next;
  }
  throw new Error("Someone else saved at the same moment. Try again.");
}
const secrets = new WeakMap();
async function secret(store) {
  if (secrets.has(store)) return secrets.get(store);
  const r = await store.getWithMetadata("secret", { type: "text", consistency: "strong" });
  let s = r && r.data;
  if (!s) {
    s = randomBytes(32).toString("hex");
    const w = await store.set("secret", s, { onlyIfNew: true });
    if (w.modified === false) s = (await store.getWithMetadata("secret", { type: "text", consistency: "strong" })).data;
  }
  secrets.set(store, s);
  return s;
}

// ---- codes and tokens ----
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
function newCode() { const b = randomBytes(8); let c = ""; for (let i = 0; i < 8; i++) c += ALPHABET[b[i] & 31]; return c.slice(0, 4) + "-" + c.slice(4); }
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z2-9]/g, "");
const hmac = (sec, s, enc) => createHmac("sha256", Buffer.from(sec, "hex")).update(s).digest(enc);
const codeHash = (sec, code) => hmac(sec, normCode(code), "hex");
function issueToken(sec, id) {
  const payload = Buffer.from(JSON.stringify({ id, exp: Date.now() + TOKEN_DAYS * 864e5 })).toString("base64url");
  return payload + "." + hmac(sec, payload, "base64url");
}
function readToken(sec, token) {
  if (typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = hmac(sec, payload, "base64url");
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try { const j = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); return j.id && j.exp > Date.now() ? j : null; } catch { return null; }
}

// ---- shapes and validation ----
const rosterFallback = () => ({ people: [] });
const calendarFallback = () => ({ entries: [] });
const MAX_ENTRIES = 200;
const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T12:00:00Z"));
const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const sectionFallback = () => ({ required: DEFAULT_REQUIRED, requiredTrained: DEFAULT_REQUIRED_TRAINED, requiredTrainedEvents: DEFAULT_REQUIRED_TRAINED_EVENTS, slots: {} });
// Which default a night takes, the club night one or the events one, is read
// off the "m:" or "e:" on its id. That is the pages' job: the numbers are
// advisory and nothing here refuses a tick for going over them.
const pub = (p) => ({ id: p.id, name: p.name, sections: p.sections || [], trained: !!p.trained, lead: !!p.lead, secretary: !!p.secretary });
const isKey = (k) => typeof k === "string" && /^[a-z0-9-]{1,32}$/.test(k);
const isSlotId = (s) => typeof s === "string" && /^[me]:(\d{4}-\d{2}-\d{2}(:.{1,140})?|[a-f0-9]{8,32})$/.test(s);
const cleanName = (n) => String(n || "").trim().replace(/\s+/g, " ").slice(0, 60);
const cleanSections = (a) => Array.isArray(a) ? [...new Set(a.filter(isKey))] : [];
const num = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : NaN; };
// Blank has to stay blank. Number(null) and Number("") are both 0, so a field
// left empty would otherwise read as the number nought.
const optNum = (v) => (v === null || v === undefined || v === "") ? null : num(v);
async function body(req) { try { const b = await req.json(); return b && typeof b === "object" ? b : null; } catch { return null; } }
function makePerson(b, sec, code) {
  return { id: randomBytes(4).toString("hex"), name: cleanName(b.name), sections: cleanSections(b.sections),
    trained: !!b.trained, lead: !!b.lead, secretary: !!b.secretary, codeHash: codeHash(sec, code),
    createdAt: new Date().toISOString() };
}

export function createHandler(storeFactory) {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(req.url);
    const a = url.searchParams.get("a") || "";
    try {
      const store = storeFactory();
      const sec = await secret(store);

      // Unauthenticated entry points.
      if (req.method === "POST" && a === "bootstrap") {
        if (!process.env.ADMIN_PASSWORD) return fail(503, "No admin password is set for this site. Set ADMIN_PASSWORD in Netlify, scoped to Functions, then redeploy.");
        if (!adminOk(req)) return fail(401, "Wrong password.");
        const b = await body(req); const name = cleanName(b && b.name);
        if (!name) return fail(400, "A name is needed.");
        const code = newCode(); let person;
        await update(store, "roster", rosterFallback, (doc) => {
          person = doc.people.find((p) => p.name.toLowerCase() === name.toLowerCase());
          const sections = cleanSections(b && b.sections);
          if (person) { person.lead = true; person.secretary = true; person.codeHash = codeHash(sec, code); if (sections.length) person.sections = [...new Set([...(person.sections || []), ...sections])]; }
          else { person = makePerson({ name, sections, lead: true, secretary: true }, sec, code); doc.people.push(person); }
          return doc;
        });
        return json(200, { person: pub(person), code });
      }
      if (req.method === "POST" && a === "login") {
        const b = await body(req); const h = codeHash(sec, b && b.code);
        const { doc } = await readDoc(store, "roster", rosterFallback);
        const person = doc.people.find((p) => p.codeHash === h);
        if (!person || normCode(b.code).length < 8) { await new Promise((r) => setTimeout(r, 250)); return fail(401, "That code is not recognised."); }
        return json(200, { token: issueToken(sec, person.id), me: pub(person) });
      }

      // Everything else needs a valid token for a person still on the roster.
      const t = readToken(sec, req.headers.get("x-rota-token"));
      if (!t) return fail(401, "Please sign in.");
      const roster = await readDoc(store, "roster", rosterFallback);
      const me = roster.doc.people.find((p) => p.id === t.id);
      if (!me) return fail(401, "Please sign in.");
      const hasSecretary = roster.doc.people.some((p) => p.secretary);
      const canManage = !!me.secretary || (!hasSecretary && !!me.lead);

      if (req.method === "GET") {
        const keys = (url.searchParams.get("sections") || "").split(",").map((s) => s.trim()).filter(isKey);
        const sections = {};
        for (const k of keys) {
          const { doc } = await readDoc(store, "section/" + k, sectionFallback);
          sections[k] = { required: doc.required, requiredTrained: doc.requiredTrained ?? DEFAULT_REQUIRED_TRAINED,
            requiredTrainedEvents: doc.requiredTrainedEvents ?? DEFAULT_REQUIRED_TRAINED_EVENTS,
            slots: doc.slots, updatedAt: doc.updatedAt || null };
        }
        // Club leaders and the coordinator see everyone. Others see the people
        // who share a club with them, which is all coverage needs.
        const mine = new Set(me.sections || []);
        const visible = (me.lead || canManage) ? roster.doc.people : roster.doc.people.filter((p) => p.id === me.id || (p.sections || []).some((k) => mine.has(k)));
        const cal = await readDoc(store, "calendar", calendarFallback);
        return json(200, { me: pub(me), people: visible.map(pub), sections, calendar: { entries: cal.doc.entries || [], updatedAt: cal.doc.updatedAt || null } });
      }
      if (req.method !== "POST") return fail(405, "Method not allowed.");
      const b = await body(req);
      if (!b) return fail(400, "Body must be JSON.");

      if (a === "slot") {
        if (!isKey(b.section) || !isSlotId(b.id)) return fail(400, "Bad club or night.");
        const known = new Set(roster.doc.people.map((p) => p.id));
        const add = Array.isArray(b.add) ? b.add : [], remove = Array.isArray(b.remove) ? b.remove : [];
        if ([...add, ...remove].some((id) => !known.has(id))) return fail(400, "Unknown person.");
        // A night's numbers, and whether it is on at all, belong to the night
        // itself: they are set on the calendar and are not taken here.
        if ("need" in b || "needTrained" in b || "off" in b) return fail(403, "Whether a night is on, and how many it needs, are set on the calendar by the coordinator.");
        if (!me.lead && [...add, ...remove].some((id) => id !== me.id)) return fail(403, "You can only put yourself on a night.");
        // A night fills up and then closes: that is what makes it first come,
        // first served. Two things stop it deadlocking. A place is held for
        // someone trained while the night still needs one, so the last seat
        // cannot be taken by somebody who does not answer the rule; and if a
        // night somehow ends up full without one, a trained leader can still
        // get on it. A club leader is not held to any of this.
        const cal = await readDoc(store, "calendar", calendarFallback);
        const entry = (cal.doc.entries || []).find((e) => b.id === e.kind + ":" + e.id) || {};
        const trainedIds = new Set(roster.doc.people.filter((p) => p.trained).map((p) => p.id));
        let refused = null;
        const doc = await update(store, "section/" + b.section, sectionFallback, (d) => {
          const s = d.slots[b.id] = d.slots[b.id] || { who: [] };
          if (!me.lead && add.includes(me.id) && !s.who.includes(me.id)) {
            const need = entry.need > 0 ? entry.need : d.required;
            const defT = b.id.startsWith("e:") ? (d.requiredTrainedEvents ?? DEFAULT_REQUIRED_TRAINED_EVENTS) : (d.requiredTrained ?? DEFAULT_REQUIRED_TRAINED);
            const needT = Math.min(Number.isFinite(entry.needTrained) ? entry.needTrained : defT, need);
            const on = s.who.length, trained = s.who.filter((id) => trainedIds.has(id)).length;
            const held = Math.max(0, needT - trained);
            const ok = trainedIds.has(me.id) ? (on < need || held > 0) : (on < need - held);
            if (!ok) {
              refused = held > 0 && on < need
                ? "That night is full apart from a place held for someone with the training."
                : "That night is full. Ask the club leader if you need to be on it.";
              return false;
            }
          }
          s.who = [...new Set([...s.who.filter((id) => !remove.includes(id)), ...add])].filter((id) => known.has(id));
          return d;
        });
        if (refused) return fail(409, refused);
        return json(200, { section: doc });
      }

      // From here on it is the coordinator's: the numbers, the roster and the
      // calendar are all theirs.
      if (!canManage) return fail(403, "Only the club coordinator can change that.");

      if (a === "required") {
        if (!isKey(b.section)) return fail(400, "Bad club.");
        // Validate before the read-modify-write, so a bad number is a 400 and
        // not a throw out of the retry loop.
        const wantN = "required" in b ? num(b.required) : null;
        const wantT = "requiredTrained" in b ? num(b.requiredTrained) : null;
        const wantE = "requiredTrainedEvents" in b ? num(b.requiredTrainedEvents) : null;
        if (wantN !== null && !(wantN >= 1 && wantN <= 9)) return fail(400, "Leaders needed must be 1 to 9.");
        for (const v of [wantT, wantE]) if (v !== null && !(v >= 0 && v <= 9)) return fail(400, "Trained leaders needed must be 0 to 9.");
        const cur = await readDoc(store, "section/" + b.section, sectionFallback);
        const finalN = wantN ?? cur.doc.required;
        const finalT = wantT ?? (cur.doc.requiredTrained ?? DEFAULT_REQUIRED_TRAINED);
        const finalE = wantE ?? (cur.doc.requiredTrainedEvents ?? DEFAULT_REQUIRED_TRAINED_EVENTS);
        if (finalT > finalN || finalE > finalN) return fail(400, "You cannot need more trained leaders than leaders.");
        const doc = await update(store, "section/" + b.section, sectionFallback, (d) => {
          const required = wantN ?? d.required;
          const requiredTrained = wantT ?? (d.requiredTrained ?? DEFAULT_REQUIRED_TRAINED);
          const requiredTrainedEvents = wantE ?? (d.requiredTrainedEvents ?? DEFAULT_REQUIRED_TRAINED_EVENTS);
          if (requiredTrained > required || requiredTrainedEvents > required) return false;
          d.required = required; d.requiredTrained = requiredTrained; d.requiredTrainedEvents = requiredTrainedEvents;
          return d;
        });
        return json(200, { section: doc });
      }
      // The whole calendar is written at once. It is a short list, the page
      // holds it while it is being edited, and one write keeps the etag guard
      // meaningful: two coordinators editing at the same moment conflict and
      // retry rather than interleaving half of each other's changes.
      if (a === "calendar") {
        const rows = Array.isArray(b.entries) ? b.entries : null;
        if (!rows) return fail(400, "No calendar given.");
        if (rows.length > MAX_ENTRIES) return fail(400, `That is more than ${MAX_ENTRIES} nights.`);
        const entries = [];
        for (const row of rows) {
          if (!row || typeof row !== "object") return fail(400, "Every night needs a date and a name.");
          const kind = row.kind === "e" ? "e" : "m";
          if (!isDate(row.date)) return fail(400, "Every night needs a date, as 2026-10-09.");
          const title = clip(row.title, 80);
          if (!title) return fail(400, "Every night needs a name.");
          const endDate = isDate(row.endDate) && row.endDate > row.date ? row.endDate : null;
          const entry = { id: /^[a-f0-9]{8,32}$/.test(row.id || "") ? row.id : randomBytes(6).toString("hex"),
            kind, date: row.date, title, location: clip(row.location, 80), details: clip(row.details, 300) };
          if (endDate) entry.endDate = endDate;
          // Blank means whatever the club asks for. A number here is this one
          // night saying otherwise.
          const need = optNum(row.need), needTrained = optNum(row.needTrained);
          if (need != null && need >= 1 && need <= 9) entry.need = need;
          if (needTrained != null && needTrained >= 0 && needTrained <= 9) entry.needTrained = needTrained;
          if (entry.need != null && entry.needTrained > entry.need) entry.needTrained = entry.need;
          // Called off, but kept: deleting it would take everyone already down
          // for it with it, and next term it may well be back.
          if (row.off) entry.off = true;
          entries.push(entry);
        }
        if (new Set(entries.map((e) => e.id)).size !== entries.length) return fail(400, "The same night was sent twice.");
        entries.sort((x, y) => x.date.localeCompare(y.date) || x.title.localeCompare(y.title));
        const doc = await update(store, "calendar", calendarFallback, (d) => { d.entries = entries; return d; });
        return json(200, { calendar: { entries: doc.entries, updatedAt: doc.updatedAt } });
      }

      if (a === "person") {
        const name = cleanName(b.name); if (!name) return fail(400, "A name is needed.");
        const code = newCode(); let person;
        await update(store, "roster", rosterFallback, (d) => {
          if (d.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) return false;
          person = makePerson({ ...b, name }, sec, code);
          d.people.push(person); return d;
        });
        if (!person) return fail(409, "Someone with that name is already on the list.");
        return json(200, { person: pub(person), code });
      }

      // Bulk add, so a coordinator can paste a list in rather than typing it
      // out. Names already on the roster are skipped, not duplicated or
      // overwritten. Codes come back once, here, and are never stored.
      if (a === "people") {
        const rows = Array.isArray(b.people) ? b.people.slice(0, MAX_BULK) : null;
        if (!rows || !rows.length) return fail(400, "No names given.");
        const wanted = [];
        const seen = new Set();
        for (const row of rows) {
          const name = cleanName(row && row.name);
          if (!name || seen.has(name.toLowerCase())) continue;
          seen.add(name.toLowerCase());
          wanted.push({ row: { ...row, name, secretary: false }, code: newCode() });
        }
        if (!wanted.length) return fail(400, "No usable names given.");
        const added = [], skipped = [];
        await update(store, "roster", rosterFallback, (d) => {
          added.length = 0; skipped.length = 0;
          const have = new Set(d.people.map((p) => p.name.toLowerCase()));
          for (const w of wanted) {
            if (have.has(w.row.name.toLowerCase())) { skipped.push(w.row.name); continue; }
            const person = makePerson(w.row, sec, w.code);
            d.people.push(person); have.add(w.row.name.toLowerCase());
            added.push({ person: pub(person), code: w.code });
          }
          return added.length ? d : false;
        });
        return json(200, { added, skipped });
      }

      if (a === "person-update" || a === "person-remove" || a === "recode") {
        const target = roster.doc.people.find((p) => p.id === b.id);
        if (!target) return fail(404, "No such person.");
        // The roster must always have someone who can maintain it.
        const secretaries = roster.doc.people.filter((p) => p.secretary).length;
        const losingSecretary = target.secretary && (a === "person-remove" || (a === "person-update" && "secretary" in b && !b.secretary));
        if (losingSecretary && secretaries <= 1) return fail(409, "Keep at least one coordinator.");
        if (a === "recode") {
          const code = newCode();
          await update(store, "roster", rosterFallback, (d) => { const p = d.people.find((x) => x.id === b.id); if (!p) return false; p.codeHash = codeHash(sec, code); return d; });
          return json(200, { code });
        }
        if (a === "person-update") {
          let person;
          await update(store, "roster", rosterFallback, (d) => {
            person = d.people.find((x) => x.id === b.id); if (!person) return false;
            if ("name" in b) { const n = cleanName(b.name); if (n) person.name = n; }
            if ("sections" in b) person.sections = cleanSections(b.sections);
            if ("trained" in b) person.trained = !!b.trained;
            if ("lead" in b) person.lead = !!b.lead;
            if ("secretary" in b) person.secretary = !!b.secretary;
            return d;
          });
          return json(200, { person: pub(person) });
        }
        const doc = await update(store, "roster", rosterFallback, (d) => { d.people = d.people.filter((x) => x.id !== b.id); return d; });
        for (const k of cleanSections(b.sections)) {
          await update(store, "section/" + k, sectionFallback, (d) => { let hit = false; for (const s of Object.values(d.slots)) { const n = s.who.length; s.who = s.who.filter((id) => id !== b.id); if (s.who.length !== n) hit = true; } return hit ? d : false; });
        }
        return json(200, { people: doc.people.map(pub) });
      }
      return fail(400, "Unknown action.");
    } catch (e) {
      return fail(500, String(e.message || e));
    }
  };
}

// In-memory store with the same surface as a Netlify Blobs store, for the
// offline harness and the local preview. Etags change on every write, and the
// conditional options behave as the real client does.
export function memoryStore() {
  const m = new Map();
  return {
    _map: m,
    async getWithMetadata(key, opts = {}) {
      const e = m.get(key); if (!e) return null;
      return { data: opts.type === "json" ? JSON.parse(e.value) : e.value, etag: e.etag, metadata: {} };
    },
    async set(key, value, opts = {}) {
      const cur = m.get(key);
      if (opts.onlyIfNew && cur) return { modified: false };
      if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
      const etag = randomBytes(6).toString("hex");
      m.set(key, { value: String(value), etag });
      return { etag, modified: true };
    }
  };
}

export default createHandler(() => getStore(STORE));
