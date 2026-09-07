#!/usr/bin/env node
// Offline harness for the Foroige rota function: drives the handler with an
// in-memory store and real Requests, so it covers codes and tokens,
// permissions, the training rule, bulk add, the last-coordinator guard,
// revocation, and the conditional-write retry. It never touches Netlify.
import { createHandler, memoryStore } from "../netlify/src/foroige.mjs";

const store = memoryStore();
const handler = createHandler(() => store);
const base = "https://x.test/.netlify/functions/foroige";
let pass = 0, fail = 0;
const ok = (name, got, want) => { const good = JSON.stringify(got) === JSON.stringify(want); good ? pass++ : fail++; console.log(`${good ? "PASS" : "FAIL"}  ${name}${good ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`); };
async function call(method, q, { token, admin, body: b } = {}) {
  const h = { "Content-Type": "application/json" }; if (token) h["x-rota-token"] = token; if (admin) h["x-admin-password"] = admin;
  const r = await handler(new Request(base + q, { method, headers: h, body: b ? JSON.stringify(b) : undefined }));
  const text = await r.text(); let j; try { j = JSON.parse(text); } catch { j = text; }
  return { status: r.status, j };
}

// No admin password set at all: bootstrap is refused, and says why.
delete process.env.ADMIN_PASSWORD;
let r = await call("POST", "?a=bootstrap", { admin: "anything", body: { name: "Coord" } });
ok("bootstrap with no ADMIN_PASSWORD set is 503", [r.status, /ADMIN_PASSWORD/.test(r.j.error)], [503, true]);
process.env.ADMIN_PASSWORD = "admin-for-test";

r = await call("OPTIONS", "");                              ok("OPTIONS is 204", r.status, 204);
r = await call("GET", "?sections=club");                    ok("GET without token is 401", r.status, 401);
r = await call("POST", "?a=bootstrap", { admin: "wrong", body: { name: "Coord" } }); ok("bootstrap with wrong password is 401", r.status, 401);
r = await call("POST", "?a=bootstrap", { admin: "admin-for-test", body: { name: "Coord", sections: ["club"] } });
ok("bootstrap creates a coordinator who is also a club leader, in the club", [r.status, r.j.person.secretary, r.j.person.lead, r.j.person.sections], [200, true, true, ["club"]]);
ok("the first coordinator is not assumed to be trained", r.j.person.trained, false);
const coordCode = r.j.code; ok("code has the expected shape", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(coordCode), true);
ok("secret was generated in the store", store._map.has("secret"), true);
r = await call("POST", "?a=login", { body: { code: "AAAA-AAAA" } }); ok("login with a bad code is 401", r.status, 401);
r = await call("POST", "?a=login", { body: { code: coordCode.toLowerCase().replace("-", " ") } });
ok("login tolerates case and separators", [r.status, r.j.me.secretary], [200, true]);
const coord = r.j.token, coordId = r.j.me.id;
r = await call("GET", "?sections=club", { token: coord });
ok("a club defaults to 3 leaders, 1 trained on a club night, none at an event",
  [r.status, r.j.sections.club.required, r.j.sections.club.requiredTrained, r.j.sections.club.requiredTrainedEvents], [200, 3, 1, 0]);
r = await call("GET", "?sections=club", { token: coord.slice(0, -2) + "zz" }); ok("tampered token is 401", r.status, 401);

// People, and the training flag.
r = await call("POST", "?a=person", { token: coord, body: { name: "Trained One", sections: ["club", "bad key!"], trained: true } });
ok("coordinator adds a trained leader; bad club keys dropped", [r.status, r.j.person.trained, r.j.person.sections], [200, true, ["club"]]);
const trainedCode = r.j.code, trainedId = r.j.person.id;
r = await call("POST", "?a=person", { token: coord, body: { name: "Helper One", sections: ["club"] } });
ok("someone added without the flag is not trained", r.j.person.trained, false);
const helperCode = r.j.code, helperId = r.j.person.id;
r = await call("POST", "?a=person", { token: coord, body: { name: "helper one", sections: [] } }); ok("duplicate name is 409", r.status, 409);

// Bulk add: skips names already there, marks the trained ones, returns codes.
r = await call("POST", "?a=people", { token: coord, body: { people: [
  { name: "Bulk Trained", sections: ["club"], trained: true },
  { name: "Bulk Plain", sections: ["club"] },
  { name: "Helper One", sections: ["club"] },
  { name: "  ", sections: ["club"] }
] } });
ok("bulk add returns codes for the new names only", [r.status, r.j.added.length, r.j.skipped], [200, 2, ["Helper One"]]);
ok("bulk add carries the training flag", r.j.added.map(a => a.person.trained), [true, false]);
ok("bulk codes are all different", new Set(r.j.added.map(a => a.code)).size, 2);
ok("bulk add never makes anyone a coordinator", r.j.added.every(a => a.person.secretary === false), true);
const bulkTrainedId = r.j.added[0].person.id;
r = await call("POST", "?a=people", { token: coord, body: { people: [{ name: "Bulk Plain" }] } });
ok("a bulk add of only known names adds nobody", [r.status, r.j.added.length, r.j.skipped], [200, 0, ["Bulk Plain"]]);
r = await call("POST", "?a=people", { token: coord, body: { people: [] } }); ok("an empty bulk add is 400", r.status, 400);
r = await call("POST", "?a=login", { body: { code: helperCode } }); const helper = r.j.token;
r = await call("POST", "?a=people", { token: helper, body: { people: [{ name: "Sneaky" }] } }); ok("a plain leader cannot bulk add", r.status, 403);

// Ticking, and the two thresholds.
const night = "m:2030-01-02";
r = await call("POST", "?a=slot", { token: helper, body: { section: "club", id: night, add: [helperId] } });
ok("a leader ticks themselves", [r.status, r.j.section.slots[night].who], [200, [helperId]]);
r = await call("POST", "?a=slot", { token: helper, body: { section: "club", id: night, add: [coordId] } });
ok("a leader cannot put someone else on", [r.status, r.j.error], [403, "You can only put yourself on a night."]);
r = await call("POST", "?a=slot", { token: helper, body: { section: "club", id: night, need: 4 } });
ok("a night's numbers are not taken here at all, not even from a leader", [r.status, r.j.error], [403, "Whether a night is on, and how many it needs, are set on the calendar by the coordinator."]);
r = await call("POST", "?a=slot", { token: coord, body: { section: "club", id: night, needTrained: 0 } });
ok("nor from the coordinator, who sets them on the calendar", r.status, 403);
r = await call("POST", "?a=person", { token: helper, body: { name: "X" } });                                 ok("nor add people", r.status, 403);
r = await call("POST", "?a=slot", { token: coord, body: { section: "club", id: night, add: [coordId, bulkTrainedId] } });
ok("the club leader ticks two more in", r.j.section.slots[night].who.length, 3);

r = await call("POST", "?a=required", { token: coord, body: { section: "club", required: 3, requiredTrained: 2 } });
ok("the coordinator raises the trained number", [r.status, r.j.section.requiredTrained], [200, 2]);
r = await call("POST", "?a=required", { token: coord, body: { section: "club", requiredTrained: 4 } });
ok("more trained leaders than leaders is refused", [r.status, r.j.error], [400, "You cannot need more trained leaders than leaders."]);
r = await call("POST", "?a=required", { token: coord, body: { section: "club", required: 0 } });   ok("zero leaders is refused", r.status, 400);
r = await call("POST", "?a=required", { token: coord, body: { section: "club", required: 12 } });  ok("more than nine leaders is refused", r.status, 400);
r = await call("POST", "?a=required", { token: coord, body: { section: "club", requiredTrained: -1 } }); ok("a negative trained number is refused", r.status, 400);
r = await call("POST", "?a=required", { token: coord, body: { section: "club", requiredTrained: 0 } });
ok("needing nobody trained is allowed, for a club with no rule", [r.status, r.j.section.requiredTrained, r.j.section.required], [200, 0, 3]);
r = await call("POST", "?a=required", { token: coord, body: { section: "club", requiredTrained: 1 } });
ok("and back to one, leaving the leaders number alone", [r.j.section.required, r.j.section.requiredTrained], [3, 1]);
r = await call("POST", "?a=required", { token: helper, body: { section: "club", required: 2 } });
ok("a plain leader cannot set the club's numbers", [r.status, r.j.error], [403, "Only the club coordinator can change that."]);

// A single night that is different: set on its calendar entry, not here.
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [
  { kind: "m", date: "2030-01-02", title: "Busy night", need: 5, needTrained: 2 },
  { kind: "m", date: "2030-01-09", title: "Ordinary night" },
  { kind: "e", date: "2030-02-01", title: "Halloween disco", needTrained: 1 }
] } });
ok("a night can be given its own numbers where it is edited", [r.status, r.j.calendar.entries[0].need, r.j.calendar.entries[0].needTrained], [200, 5, 2]);
ok("a night left alone carries no numbers, so it takes the club's", ["need" in r.j.calendar.entries[1], "needTrained" in r.j.calendar.entries[1]], [false, false]);
ok("an event can be told it does need one after all", r.j.calendar.entries[2].needTrained, 1);
ok("and nothing is called off to begin with", r.j.calendar.entries.some(e => e.off), false);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: r.j.calendar.entries.map((e, i) => i === 1 ? { ...e, off: true } : e) } });
ok("the coordinator calls one night off", [r.j.calendar.entries[1].off, "off" in r.j.calendar.entries[0]], [true, false]);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: r.j.calendar.entries.map(e => ({ ...e, off: false })) } });
ok("and puts it back on, which stores nothing rather than a false", r.j.calendar.entries.some(e => "off" in e), false);
const busy = r.j.calendar.entries[0];
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [{ ...busy, need: 1, needTrained: 3 }] } });
ok("asking for more trained than leaders on one night clamps down", [r.j.calendar.entries[0].need, r.j.calendar.entries[0].needTrained], [1, 1]);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [{ ...busy, need: 0, needTrained: 99 }] } });
ok("numbers out of range are dropped, so the night falls back to the club's", ["need" in r.j.calendar.entries[0], "needTrained" in r.j.calendar.entries[0]], [false, false]);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [{ ...busy, need: null, needTrained: null }] } });
ok("blank means the same thing, and is not read as the number nought", ["need" in r.j.calendar.entries[0], "needTrained" in r.j.calendar.entries[0]], [false, false]);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [{ ...busy, need: "", needTrained: "" }] } });
ok("an empty box is blank too", ["need" in r.j.calendar.entries[0], "needTrained" in r.j.calendar.entries[0]], [false, false]);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [{ ...busy, needTrained: 0 }] } });
ok("but nought typed in is a real answer: this one needs nobody trained", r.j.calendar.entries[0].needTrained, 0);
r = await call("POST", "?a=calendar", { token: helper, body: { entries: [] } });
ok("a plain leader cannot set a night's numbers either", r.status, 403);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [] } });
ok("the calendar clears again for the tests that follow", r.j.calendar.entries, []);

const event = "e:2030-02-01:Halloween disco";
r = await call("POST", "?a=slot", { token: coord, body: { section: "club", id: event, add: [trainedId] } });
ok("an event takes ticks", [r.status, r.j.section.slots[event].who], [200, [trainedId]]);
r = await call("POST", "?a=slot", { token: coord, body: { section: "club", id: "m:2030-01-09", off: true } });
ok("nor is calling a night off, not even by the coordinator", r.status, 403);
r = await call("POST", "?a=slot", { token: coord, body: { section: "club", id: event, add: ["nope"] } }); ok("unknown person id is 400", r.status, 400);
r = await call("POST", "?a=slot", { token: coord, body: { section: "club", id: "not a date" } });        ok("bad slot id is 400", r.status, 400);
r = await call("POST", "?a=slot", { token: coord, body: { section: "Club!", id: night } });               ok("bad club key is 400", r.status, 400);

// The page needs the training flag on every person to count a night, so it
// must survive a GET.
r = await call("GET", "?sections=club", { token: helper });
ok("everyone in the club is visible to a plain leader", r.j.people.length, 5);
ok("the trained flag comes back with each person", r.j.people.filter(p => p.trained).map(p => p.name).sort(), ["Bulk Trained", "Trained One"]);
ok("no code hashes leak in GET", JSON.stringify(r.j).includes("codeHash"), false);

// Conditional-write retry: make the next conditional set fail once, as it would if someone else saved first.
const realSet = store.set.bind(store); let failed = 0;
store.set = async (k, v, o) => { if (!failed && o && o.onlyIfMatch) { failed++; return { modified: false }; } return realSet(k, v, o); };
r = await call("POST", "?a=slot", { token: coord, body: { section: "club", id: night, remove: [coordId] } });
ok("a conflicting write is retried and lands", [failed, r.status, r.j.section.slots[night].who.includes(coordId)], [1, 200, false]);
store.set = realSet;

// The training rule is about the building, so the club keeps two numbers: one
// for a club night in it and one for an event away from it.
r = await call("POST", "?a=required", { token: coord, body: { section: "club", required: 3, requiredTrained: 1, requiredTrainedEvents: 0 } });
ok("the three numbers are set together", [r.j.section.required, r.j.section.requiredTrained, r.j.section.requiredTrainedEvents], [3, 1, 0]);
r = await call("POST", "?a=required", { token: coord, body: { section: "club", requiredTrainedEvents: 4 } });
ok("more trained at an event than leaders is refused", [r.status, r.j.error], [400, "You cannot need more trained leaders than leaders."]);
r = await call("POST", "?a=required", { token: coord, body: { section: "club", requiredTrainedEvents: 1 } });
ok("events can be told they need one, for a club that meets in its own building", r.j.section.requiredTrainedEvents, 1);
r = await call("POST", "?a=required", { token: coord, body: { section: "club", requiredTrainedEvents: 0 } });
ok("and back to nobody trained at an event", r.j.section.requiredTrainedEvents, 0);

// The calendar the coordinator keeps.
r = await call("GET", "?sections=club", { token: coord });
ok("an empty calendar is what makes the pages fall back to the setup file", r.j.calendar.entries, []);
r = await call("POST", "?a=calendar", { token: helper, body: { entries: [] } });
ok("a plain leader cannot change the calendar", r.status, 403);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [
  { kind: "e", date: "2030-05-01", title: "  Day trip  to Galway ", location: "Galway city", details: "Bus leaves at nine.", endDate: "2030-05-02" },
  { kind: "m", date: "2030-04-03", title: "Club night", details: "Bring runners." },
  { kind: "m", date: "2030-04-10", title: "Club night" }
] } });
ok("the coordinator saves a calendar, sorted by date", [r.status, r.j.calendar.entries.map(e => e.date)], [200, ["2030-04-03", "2030-04-10", "2030-05-01"]]);
ok("titles are tidied", r.j.calendar.entries[2].title, "Day trip to Galway");
ok("a description is kept", r.j.calendar.entries[0].details, "Bring runners.");
ok("an end date after the start is kept", r.j.calendar.entries[2].endDate, "2030-05-02");
ok("every entry gets an id", r.j.calendar.entries.every(e => /^[a-f0-9]{12}$/.test(e.id)), true);
const cal = r.j.calendar.entries, night3 = "m:" + cal[0].id, calTrip = "e:" + cal[2].id;
ok("club nights and events keep their kind", [cal[0].kind, cal[2].kind], ["m", "e"]);
r = await call("POST", "?a=slot", { token: coord, body: { section: "club", id: night3, add: [coordId] } });
ok("an entry's id works as a slot id", [r.status, r.j.section.slots[night3].who], [200, [coordId]]);
r = await call("POST", "?a=slot", { token: coord, body: { section: "club", id: calTrip, add: [trainedId] } });
ok("and an event's id does too", r.j.section.slots[calTrip].who, [trainedId]);
// Renaming and moving a night must not lose the people already down for it.
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [
  { ...cal[0], date: "2030-04-04", title: "Club night, later start" }, cal[1], cal[2]
] } });
ok("an entry keeps its id when it is renamed and moved", r.j.calendar.entries.find(e => e.id === cal[0].id).date, "2030-04-04");
r = await call("GET", "?sections=club", { token: coord });
ok("so the people already down for it are still on it", r.j.sections.club.slots[night3].who, [coordId]);
ok("and the calendar comes back on a GET", r.j.calendar.entries.length, 3);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [{ kind: "m", date: "not a date", title: "X" }] } });
ok("a bad date is refused", [r.status, /date/.test(r.j.error)], [400, true]);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [{ kind: "m", date: "2030-04-03", title: "   " }] } });
ok("a nameless night is refused", r.status, 400);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [{ kind: "m", date: "2030-04-03", title: "X", endDate: "2030-04-01" }] } });
ok("an end date before the start is dropped, not stored", "endDate" in r.j.calendar.entries[0], false);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [{ kind: "m", date: "2030-04-03", title: "X", id: cal[0].id }, { kind: "e", date: "2030-04-05", title: "Y", id: cal[0].id }] } });
ok("the same id twice is refused", r.status, 400);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: Array.from({ length: 201 }, (_, i) => ({ kind: "m", date: "2030-04-03", title: "N" + i })) } });
ok("more than two hundred nights is refused", r.status, 400);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: "nope" } });
ok("a calendar that is not a list is refused", r.status, 400);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [{ kind: "m", date: "2030-04-03", title: "X", details: "d".repeat(400) }] } });
ok("an over-long description is cut, not refused", r.j.calendar.entries[0].details.length, 300);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: cal } });
ok("and the calendar can be put back as it was", r.j.calendar.entries.map(e => e.id), cal.map(e => e.id));

// First come, first served: a night fills up and then closes.
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [{ kind: "m", date: "2030-06-07", title: "Full night" }] } });
const fullId = "m:" + r.j.calendar.entries[0].id;
r = await call("POST", "?a=required", { token: coord, body: { section: "club", required: 3, requiredTrained: 1 } });
// Two untrained on it, one place left, and that place is held for the training.
r = await call("POST", "?a=person", { token: coord, body: { name: "Plain A", sections: ["club"] } }); const plainA = r.j.person.id, plainACode = r.j.code;
r = await call("POST", "?a=person", { token: coord, body: { name: "Plain B", sections: ["club"] } }); const plainBCode = r.j.code;
r = await call("POST", "?a=person", { token: coord, body: { name: "Plain C", sections: ["club"] } }); const plainCCode = r.j.code;
r = await call("POST", "?a=person", { token: coord, body: { name: "Trained D", sections: ["club"], trained: true } }); const trainedDCode = r.j.code;
const tok = async (code) => (await call("POST", "?a=login", { body: { code } })).j.token;
const [tA, tB, tC, tD] = await Promise.all([tok(plainACode), tok(plainBCode), tok(plainCCode), tok(trainedDCode)]);
r = await call("POST", "?a=slot", { token: tA, body: { section: "club", id: fullId, add: [plainA] } });
ok("the first untrained leader gets on", r.j.section.slots[fullId].who.length, 1);
r = await call("POST", "?a=slot", { token: tB, body: { section: "club", id: fullId, add: [(await call("GET", "?sections=club", { token: tB })).j.me.id] } });
ok("and the second", r.j.section.slots[fullId].who.length, 2);
const meC = (await call("GET", "?sections=club", { token: tC })).j.me.id;
r = await call("POST", "?a=slot", { token: tC, body: { section: "club", id: fullId, add: [meC] } });
ok("but the third untrained one is refused: the last place is held", [r.status, r.j.error], [409, "That night is full apart from a place held for someone with the training."]);
const meD = (await call("GET", "?sections=club", { token: tD })).j.me.id;
r = await call("POST", "?a=slot", { token: tD, body: { section: "club", id: fullId, add: [meD] } });
ok("the trained one takes it", [r.status, r.j.section.slots[fullId].who.length], [200, 3]);
r = await call("POST", "?a=slot", { token: tC, body: { section: "club", id: fullId, add: [meC] } });
ok("now it is simply full", [r.status, r.j.error], [409, "That night is full. Ask the club leader if you need to be on it."]);
r = await call("POST", "?a=slot", { token: tA, body: { section: "club", id: fullId, remove: [plainA] } });
ok("anyone can still take themselves off a full night", r.j.section.slots[fullId].who.length, 2);
r = await call("POST", "?a=slot", { token: tC, body: { section: "club", id: fullId, add: [meC] } });
ok("which opens the place up again, first come first served", [r.status, r.j.section.slots[fullId].who.length], [200, 3]);
r = await call("POST", "?a=slot", { token: coord, body: { section: "club", id: fullId, add: [coordId] } });
ok("a club leader is not held to the numbers and can go over", r.j.section.slots[fullId].who.length, 4);
// A night that has gone full with nobody trained must not deadlock.
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [{ kind: "m", date: "2030-06-14", title: "Stuck night" }] } });
const stuck = "m:" + r.j.calendar.entries.find(e => e.title === "Stuck night").id;
r = await call("POST", "?a=slot", { token: coord, body: { section: "club", id: stuck, add: [plainA, meC, coordId] } });
ok("three untrained on it, put there by the club leader", r.j.section.slots[stuck].who.length, 3);
r = await call("POST", "?a=slot", { token: tB, body: { section: "club", id: stuck, add: [(await call("GET", "?sections=club", { token: tB })).j.me.id] } });
ok("another untrained one is refused", r.status, 409);
r = await call("POST", "?a=slot", { token: tD, body: { section: "club", id: stuck, add: [meD] } });
ok("but a trained one can still get on it, so it is never stuck", [r.status, r.j.section.slots[stuck].who.length], [200, 4]);
r = await call("POST", "?a=calendar", { token: coord, body: { entries: [] } });

// Codes, roles and removal.
r = await call("POST", "?a=recode", { token: coord, body: { id: helperId } }); const newCode = r.j.code;
ok("recode returns a fresh code", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(newCode) && newCode !== helperCode, true);
r = await call("POST", "?a=login", { body: { code: helperCode } }); ok("old code no longer works", r.status, 401);
r = await call("POST", "?a=login", { body: { code: newCode } });    ok("new code works", r.status, 200);
const helper2 = r.j.token;
r = await call("POST", "?a=person-update", { token: coord, body: { id: trainedId, trained: false } });
ok("the coordinator can take the training flag off someone", r.j.person.trained, false);
r = await call("POST", "?a=person-update", { token: coord, body: { id: trainedId, trained: true, lead: true } });
ok("and put it back, with club leader too", [r.j.person.trained, r.j.person.lead], [true, true]);
r = await call("POST", "?a=person-update", { token: helper2, body: { id: trainedId, trained: false } }); ok("a plain leader cannot change anyone's training", r.status, 403);
r = await call("POST", "?a=person-update", { token: coord, body: { id: coordId, secretary: false } }); ok("cannot demote the only coordinator", r.status, 409);
r = await call("POST", "?a=person-remove", { token: coord, body: { id: coordId, sections: [] } });     ok("cannot remove the only coordinator", r.status, 409);
r = await call("POST", "?a=person-update", { token: coord, body: { id: trainedId, secretary: true } }); ok("a second coordinator can be made", r.j.person.secretary, true);
r = await call("POST", "?a=person-update", { token: coord, body: { id: coordId, secretary: false } });  ok("now the first can step down", r.status, 200);
r = await call("POST", "?a=person", { token: coord, body: { name: "Y" } });                             ok("and loses roster powers at once", r.status, 403);
// A roster with club leaders but no coordinator: leads keep roster powers.
{ const raw = JSON.parse(store._map.get("roster").value); raw.people.forEach(p => { p.secretary = false; p.lead = true; }); store._map.set("roster", { value: JSON.stringify(raw), etag: "legacy" });
  r = await call("POST", "?a=person", { token: coord, body: { name: "Legacy Add" } }); ok("with no coordinator, a club leader can still manage the roster", r.status, 200);
  const raw2 = JSON.parse(store._map.get("roster").value); raw2.people = raw2.people.filter(p => p.name !== "Legacy Add"); raw2.people.find(p => p.id === trainedId).secretary = true; store._map.set("roster", { value: JSON.stringify(raw2), etag: "legacy2" }); }
r = await call("POST", "?a=login", { body: { code: trainedCode } }); const trained = r.j.token;
r = await call("POST", "?a=person-remove", { token: trained, body: { id: coordId, sections: ["club"] } });
ok("removing someone takes them off the roster", [r.status, r.j.people.some(p => p.id === coordId)], [200, false]);
r = await call("GET", "?sections=club", { token: coord }); ok("a removed person's token is revoked", r.status, 401);
r = await call("GET", "?sections=club", { token: trained });
ok("and their ticks are gone from the night", r.j.sections.club.slots[night].who.includes(coordId), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
