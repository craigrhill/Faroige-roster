// Shared by rota.html and roster.html: sign-in token, API calls, and a few
// helpers. Plain globals on purpose; both pages are single files.
const API = "/.netlify/functions/foroige", TK = "foroige-token";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = s => new Date(s + "T12:00:00").toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });
let token = null; try { token = localStorage.getItem(TK); } catch {}
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
const FALLBACK = { club: { name: "Foroige club" },
  training: { label: "Building training", short: "Building training" },
  settings: { sections: [{ key: "club", name: "Club night", day: "Wednesday" }] }, events: [] };
let TRAIN = FALLBACK.training;
async function loadContent(){
  let c;
  try { const r = await fetch("rota-config.json", { cache: "no-store" }); c = await r.json(); if (!c || !c.settings || !Array.isArray(c.settings.sections) || !c.settings.sections.length) throw 0; }
  catch { c = FALLBACK; }
  c.club = c.club || FALLBACK.club;
  c.training = { ...FALLBACK.training, ...(c.training || {}) };
  c.training.short = c.training.short || c.training.label;
  c.events = Array.isArray(c.events) ? c.events : [];
  TRAIN = c.training;
  document.querySelectorAll("[data-club-name]").forEach(el => { el.textContent = c.club.name; });
  document.querySelectorAll("[data-training-label]").forEach(el => { el.textContent = c.training.label; });
  document.querySelectorAll("[data-training-short]").forEach(el => { el.textContent = c.training.short; });
  if (c.club.name) document.title = document.title.replace("Foroige club", c.club.name);
  return c;
}
const trainedTag = p => p.trained ? `<span class="tag" title="${esc(TRAIN.label)}">${esc(TRAIN.short)}</span>` : "";
const roleText = me => [me.secretary && "coordinator", me.lead && "club leader"].filter(Boolean).join(", ");
const byName = (a, b) => a.name.localeCompare(b.name, "en-IE");

function showCode(name, code){
  $("codeBox").innerHTML = `<b>Code for ${esc(name)}</b><br><span class="code" id="codeText">${esc(code)}</span><br><span class="small">Send it to them now. It is shown only once; use New code if it is lost.</span> <button class="btn" onclick="copyCode()">Copy</button> <button class="btn quiet" onclick="$('codeBox').hidden=true">Close</button>`;
  $("codeBox").hidden = false; $("codeBox").scrollIntoView({ block: "center" });
}
async function copyCode(){ try { await navigator.clipboard.writeText($("codeText").textContent); } catch {} }
async function signIn(code, msgId, after){
  $(msgId).textContent = ""; $(msgId).className = "msg";
  try { const r = await api("POST", "?a=login", { code }); setToken(r.token); await after(); }
  catch (e) { $(msgId).textContent = e.message; $(msgId).className = "msg err"; }
}
