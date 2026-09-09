// Shared by rota.html and roster.html: sign-in token, API calls, and a few
// helpers. Plain globals on purpose; both pages are single files.
const API = "/.netlify/functions/foroige", TK = "foroige-token";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = s => new Date(s + "T12:00:00").toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });
let token = null; try { token = localStorage.getItem(TK); } catch {}
// A personal link carries the code in ?c=, so nobody has to type one. It is
// spent on the first load and taken straight back out of the address bar, so
// it is not left sitting in the tab for the next person to see.
const linkCode = new URLSearchParams(location.search).get("c");
function dropCodeFromUrl(){
  try { const u = new URL(location.href); if (u.searchParams.has("c")) { u.searchParams.delete("c"); history.replaceState(null, "", u.pathname + u.search + u.hash); } } catch {}
}
// Links to the pages beside this one, whether Netlify is serving them pretty
// (/rota) or as files (/rota.html).
function pageLink(page, query){
  const path = location.pathname.replace(/(rota|roster|events)(\.html)?$/, (m, name, ext) => page + (ext || ""));
  return location.origin + (path === location.pathname && !/\/(rota|roster|events)/.test(path) ? "/" + page : path) + (query || "");
}
// The link to send someone. Same code, nothing to remember.
const codeLink = code => pageLink("rota") + "?c=" + encodeURIComponent(code);
function setToken(t){ token = t; try { if (t) localStorage.setItem(TK, t); else localStorage.removeItem(TK); } catch {} }
let onUnauthorized = () => {};

async function api(method, q, body, extra = {}) {
  const h = { "Content-Type": "application/json", ...extra }; if (token) h["x-rota-token"] = token;
  const r = await fetch(API + q, { method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const j = await r.json().catch(() => ({ error: "The server gave an unexpected reply." }));
  if (r.status === 401 && token && q !== "?a=login") { setToken(null); onUnauthorized("Your sign-in has expired or been removed. Sign in again."); throw new Error(j.error || "Please sign in."); }
  if (!r.ok) throw new Error(j.error || ("Error " + r.status));
  return j;
}

// The club, its meeting night and its events come from rota-config.json beside
// these pages. Fetched by relative path so the folder can be moved or renamed.
const FALLBACK = { club: { name: "Foróige club" },
  training: { label: "Building training", short: "Building training" },
  settings: { sections: [{ key: "club", name: "Club night", day: "Wednesday" }] }, events: [],
  // The message the coordinator sends with a link. {name}, {link}, {from} and
  // {club} are filled in; the wording can be changed in rota-config.json.
  message: "Hi {name}, here is your link to the {club} rota for the term:\n\n{link}\n\nThis link is unique to you, so please keep it to yourself. Open it and you can put yourself down for the club nights and events you are free to volunteer at. It is first come, first served: once a night has the leaders it needs it closes, so grab the dates that suit you early. Your phone stays signed in, so keep this message in case you need the link again.\n\nThanks, {from}" };
let TRAIN = FALLBACK.training;
async function loadContent(){
  let c;
  try { const r = await fetch("rota-config.json", { cache: "no-store" }); c = await r.json(); if (!c || !c.settings || !Array.isArray(c.settings.sections) || !c.settings.sections.length) throw 0; }
  catch { c = FALLBACK; }
  c.club = c.club || FALLBACK.club;
  c.training = { ...FALLBACK.training, ...(c.training || {}) };
  c.training.short = c.training.short || c.training.label;
  c.events = Array.isArray(c.events) ? c.events : [];
  c.message = typeof c.message === "string" && c.message.trim() ? c.message : FALLBACK.message;
  TRAIN = c.training;
  document.querySelectorAll("[data-club-name]").forEach(el => { el.textContent = c.club.name; });
  document.querySelectorAll("[data-training-label]").forEach(el => { el.textContent = c.training.label; });
  document.querySelectorAll("[data-training-short]").forEach(el => { el.textContent = c.training.short; });
  if (c.club.name) document.title = document.title.replace(/Foróige club/, c.club.name);
  return c;
}
const trainedTag = p => p.trained ? `<span class="tag" title="${esc(TRAIN.label)}">${esc(TRAIN.short)}</span>` : "";
const roleText = me => me.secretary ? "coordinator" : "";
const byName = (a, b) => a.name.localeCompare(b.name, "en-IE");
// On the rota, the people who can open the building come first: a night is not
// covered without one of them, so they are the ones being looked for.
const byTrainedThenName = (a, b) => (!!b.trained - !!a.trained) || byName(a, b);

function showCode(name, code){
  $("codeBox").innerHTML = `<b>Link for ${esc(name)}</b><br><span class="link" id="codeText">${esc(codeLink(code))}</span><br><span class="small">Send it to them and they will not have to type anything. It stays beside their name on the roster, so it can be sent again any time.</span> <button class="btn" onclick="copyText($('codeText').textContent, this)">Copy the link</button> <button class="btn quiet" onclick="$('codeBox').hidden=true">Close</button>`;
  $("codeBox").hidden = false; $("codeBox").scrollIntoView({ block: "center" });
}
// Put text on the clipboard and say so on the button that did it, briefly.
async function copyText(text, btn){
  let done = false;
  try { await navigator.clipboard.writeText(text); done = true; } catch {}
  if (btn) { const was = btn.textContent; btn.textContent = done ? "Copied" : "Could not copy"; btn.disabled = true; setTimeout(() => { btn.textContent = was; btn.disabled = false; }, 1400); }
  return done;
}
// The message that goes with somebody's link, ready to paste into WhatsApp.
// The wording is the coordinator's own if she has set one, else the standard
// one from rota-config.json.
function messageFor(config, person, code, from, wording){
  const fill = { name: person.name, link: codeLink(code), from: from || "", club: (config.club || {}).name || "the club" };
  return String(wording || config.message || "").replace(/\{(name|link|from|club)\}/g, (m, k) => fill[k]);
}
// Where the whole thing starts: the public page. Signing out lands there.
const homeLink = () => pageLink("events");
// Sign in from the link, if there is one, before falling back to the gate.
async function signInFromLink(after){
  if (!linkCode) return false;
  try { const r = await api("POST", "?a=login", { code: linkCode }); setToken(r.token); dropCodeFromUrl(); await after(); return true; }
  catch { dropCodeFromUrl(); return false; }
}
async function signIn(code, msgId, after){
  $(msgId).textContent = ""; $(msgId).className = "msg";
  try { const r = await api("POST", "?a=login", { code }); setToken(r.token); await after(); }
  catch (e) { $(msgId).textContent = e.message; $(msgId).className = "msg err"; }
}
