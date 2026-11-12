// MS Kompasset – appen. Skærme og flows følger den godkendte prototype.

import { Store } from "./store.js";
import { ACT, DRAIN, GAIN_START, LV, MOODS, CATS, PROT, BASE_FOODS } from "../supabase/functions/_shared/catalog.js";
import {
  EXERCISES, withDefaults, withMemberDefaults, holidayName, isRestDay, fixedPausesFor, trainingFor, addDays, weekday, tdot,
} from "../supabase/functions/_shared/calendar.js";
import { foodStats, foodWindow, trainStats, predictMinutes, energyGuess, insights, lastEnergy, dur, hm, dayKeyLocal, nowHHMM, GOAL } from "./logic.js";
import { registerSW, pushStatus, enablePush, refreshSubscription, disablePush, isStandalone } from "./push.js";

const CFG = window.MSK_CONFIG || {};
const params = new URLSearchParams(location.search);
const DEMO = params.has("demo") || !CFG.supabaseUrl;
const db = DEMO ? null : window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
const MIN = 60000;
const $ = (s, r = document) => r.querySelector(s);

const store = new Store({ db, demo: DEMO, onChange: () => scheduleRender(), onSync: setSync });

// ============================================================
// Ikoner og små hjælpere
// ============================================================

const I = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l7-7"/>',
  dumb: '<path d="M6 6v12M18 6v12M3 9v6M21 9v6M6 12h12"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M9 12h6M9 16h6M9 8h3"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  veg: '<path d="M14 4c-5 3-9 9-10 16 7-1 13-5 16-10"/><path d="M14 4l2 2M18 8l2 2M15 3l1 3 3 1"/>',
  fruit: '<path d="M12 7c-4-2-8 1-8 6s3 8 5 8c1.5 0 2-.6 3-.6s1.5.6 3 .6c2 0 5-3 5-8s-4-8-8-6z"/><path d="M12 7c0-2 1-4 3-4"/>',
  leg: '<ellipse cx="8.5" cy="12" rx="4" ry="5.5" transform="rotate(-20 8.5 12)"/><ellipse cx="16" cy="12" rx="4" ry="5.5" transform="rotate(20 16 12)"/>',
  nut: '<path d="M12 3c4 0 7 4 7 9s-3 9-7 9-7-4-7-9 3-9 7-9z"/><path d="M12 6v12"/>',
  grain: '<path d="M12 21V9"/><path d="M12 9c-3 0-4-2-4-5 3 0 4 2 4 5zM12 9c3 0 4-2 4-5-3 0-4 2-4 5zM12 14c-3 0-4-2-4-4 3 0 4 1 4 4zM12 14c3 0 4-2 4-4-3 0-4 1-4 4z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
};
const ic = (n, s = 20, w = 1.8) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iso = (t) => new Date(t).toISOString();
const WD = ["søn", "man", "tir", "ons", "tor", "fre", "lør"];
const WDL = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
const MON = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const today = () => dayKeyLocal();
const dk = (off) => addDays(today(), -off);
const dnum = (key) => +key.slice(8);
const mnum = (key) => +key.slice(5, 7);
const offOf = (key) => Math.round((Date.parse(today() + "T12:00:00") - Date.parse(key + "T12:00:00")) / 864e5);
function dayLabel(key) {
  const o = offOf(key);
  if (o === 0) return "I dag";
  if (o === 1) return "I går";
  const n = WDL[weekday(key)];
  return n[0].toUpperCase() + n.slice(1);
}
const dateLong = (key) => `${WDL[weekday(key)]} ${dnum(key)}. ${MON[mnum(key) - 1]}`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const later = (m) => hm(Date.now() + m * MIN);
const lvColor = (v) => `var(--e${v})`;
const PILL = { ok: "På planen", warn: "Hold øje", bad: "Under planen" };
const pill = (st) => `<span class="pill ${st}"><i></i>${PILL[st]}</span>`;

// ============================================================
// Data-genveje
// ============================================================

const D = () => store.data;
const isP = () => store.isPatient;
const S = () => withDefaults(D().household?.settings);
const MS = () => withMemberDefaults(D().me?.settings);
const active = () => D().activities.find((a) => !a.ended_at) || null;
const actsOn = (key) => D().activities
  .filter((a) => a.ended_at && dayKeyLocal(new Date(a.started_at)) === key)
  .sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
const reminder = (kind, day = today()) => D().reminders.find((r) => r.kind === kind && r.day === day);
const member = (id) => D().members.find((m) => m.user_id === id);
const initial = (id) => esc((member(id)?.display_name || "?")[0].toUpperCase());
const patientName = () => D().members.find((m) => m.role === "patient")?.display_name || "Ditte";
const FOODS = () => {
  const f = { ...BASE_FOODS };
  for (const c of D().custom_foods) f[c.name] = c.category;
  return f;
};

function doneReminder(kind, day = today()) {
  const r = reminder(kind, day);
  store.upsert("reminders", { kind, day, status: "done", next_at: null, sent_count: r?.sent_count || 0 });
}
function snoozeReminder(kind, minutes, day = today()) {
  const r = reminder(kind, day);
  store.upsert("reminders", { kind, day, status: "open", next_at: iso(Date.now() + minutes * MIN), sent_count: Math.max(1, r?.sent_count || 0) });
}

// ============================================================
// UI-tilstand og rendering
// ============================================================

let UI = { view: "home", sel: null, q: "", browse: "veg", period: 14, analysis: null, foodDay: 0 };
const V = {};

let renderQueued = false;
let renderDeferred = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    // Skriver man i et felt, venter vi, så teksten ikke forsvinder midt i en sætning.
    const a = document.activeElement;
    if (a && $("#view")?.contains(a) && /INPUT|TEXTAREA/.test(a.tagName)) {
      renderDeferred = true;
      return;
    }
    render(true);
  });
}
document.addEventListener("focusout", () => {
  if (renderDeferred) {
    renderDeferred = false;
    setTimeout(() => render(true), 0);
  }
});

const NAV = [["home", "Hjem", "home"], ["energy", "Aktivitet", "bolt"], ["food", "Kost", "leaf"], ["training", "Træning", "dumb"], ["notes", "Noter", "note"]];

function render(keepScroll) {
  if (!D().me || $("#app").hidden) return;
  if (UI.view === "notes" && !isP()) UI.view = "home";
  $("#view").innerHTML = V[UI.view]();
  $("#nav").innerHTML = NAV.filter((n) => isP() || n[0] !== "notes")
    .map(([k, l, i]) => `<button class="${UI.view === k ? "sel" : ""}" data-go="${k}" ${UI.view === k ? 'aria-current="page"' : ""}><span class="ni">${ic(i, 20)}</span>${l}</button>`).join("");
  if (!keepScroll) window.scrollTo(0, 0);
}
function go(v) {
  UI.view = v;
  UI.q = "";
  if (v !== "notes") UI.analysis = null;
  render();
}

let tt;
function toast(m) {
  const t = $("#toast");
  t.textContent = m;
  t.classList.add("show");
  clearTimeout(tt);
  tt = setTimeout(() => t.classList.remove("show"), 2800);
}
let sheetOpen = false;
function openSheet(html) {
  const s = $("#sheet");
  s.innerHTML = '<div class="grab"></div>' + html;
  s.classList.add("show");
  $("#scrim").classList.add("show");
  s.scrollTop = 0;
  sheetOpen = true;
}
function closeSheet() {
  $("#sheet").classList.remove("show");
  $("#scrim").classList.remove("show");
  sheetOpen = false;
}

function setSync(state) {
  const el = $("#sync");
  if (!el) return;
  el.className = "sync " + state;
  el.textContent = state === "error" ? "⚠ Ikke gemt online" : state === "offline" ? "Offline" : "";
}

// Lyd (kun når appen er åben – notifikationer bruger telefonens egen lyd)
function chime() {
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    const c = chime.c || (chime.c = new C());
    if (c.state === "suspended") c.resume();
    [[659.25, 0], [880, 0.22], [1046.5, 0.44]].forEach(([f, t]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const s = c.currentTime + t;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.25, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, s + 1.2);
      o.connect(g).connect(c.destination);
      o.start(s);
      o.stop(s + 1.3);
    });
  } catch {}
}

// ============================================================
// Forside
// ============================================================

function fstats() {
  return foodStats(D().food_entries, D().protein_days, today());
}
function tstats() {
  return trainStats(D().household?.settings, D().training_log, today());
}
function eguess() {
  return energyGuess(active(), D().activities, D().hint_events, today());
}

V.home = () => {
  const h = new Date().getHours();
  const g = h < 10 ? "Godmorgen" : h < 17 ? "God eftermiddag" : "Godaften";
  const f = fstats(), t = tstats(), e = eguess();
  const a = active();
  let html = `<div class="hello"><h1>${g}, ${esc(D().me.display_name)}</h1><p>${cap(dateLong(today()))}</p></div>`;
  if (isP() && pendingFixed()) html += fixedCard();
  if (a) {
    const A = ACT[a.type] || { l: a.type };
    html += isP()
      ? `<button class="active-banner" data-go="energy"><span class="pulse"></span><span style="flex:1"><b>${A.l}</b> er i gang<br><span class="small elapsed" data-start="${Date.parse(a.started_at)}">${dur(Date.now() - Date.parse(a.started_at))}</span> · tryk for at stoppe</span>${ic("chev")}</button>`
      : `<div class="card flat"><div class="row"><span class="av">${esc(patientName()[0])}</span><span class="small">${esc(patientName())} er i gang med <b>${A.l.toLowerCase()}</b> (<span class="elapsed" data-start="${Date.parse(a.started_at)}">${dur(Date.now() - Date.parse(a.started_at))}</span>)</span></div></div>`;
  }
  html += `<button class="card status-card" data-go="energy"><div class="head"><span class="ic">${ic("bolt")}</span><h2>Energi</h2>${ic("chev")}</div>
    <div><div class="eyebrow">${isP() ? "Mit gæt på din energi lige nu" : `Gæt på ${esc(patientName())}s energi lige nu`}</div><div class="big" style="margin-top:4px">${e.t}</div></div><div class="small muted">${e.s}</div></button>`;
  html += `<button class="card status-card" data-go="food"><div class="head"><span class="ic">${ic("leaf")}</span><h2>Sundhed og kost</h2>${pill(f.st)}</div>
    <div class="row between"><div><span class="big">${f.total}</span><span class="muted"> / ${GOAL} forskellige</span></div><span class="small muted">sidste 7 dage</span></div>
    <div class="meter"><span style="width:${Math.min(100, (f.total / GOAL) * 100)}%"></span></div>
    <div class="small muted">Heraf ${f.by.leg} bælgfrugter og ${f.by.nut} nødder/kerner${f.drop.length ? ` · <b style="color:var(--ink)">${f.drop.length} falder ud i morgen</b>` : ""}</div></button>`;
  html += `<button class="card status-card" data-go="training"><div class="head"><span class="ic">${ic("dumb")}</span><h2>Træning</h2>${pill(t.st)}</div>
    <div class="row between"><div><span class="big">${t.pct} %</span><span class="muted"> af planen</span></div><span class="small muted">${t.done} af ${t.planned} gange · 7 dage</span></div></button>`;
  if (isP()) html += `<button class="linkrow" data-go="notes">${ic("note")}<span class="t">Notater og bekymringer</span><span class="small muted">${getDraft() ? "Kladde gemt" : ""}</span>${ic("chev")}</button>`;
  else html += `<button class="btn wide" data-go="food">${ic("leaf")} Registrér dagens mad</button>`;
  return html;
};

// ============================================================
// Aktivitet og energi
// ============================================================

function scaleHTML(ctx) {
  return `<div class="scale">${[5, 4, 3, 2, 1].map((v) => `<button data-act="energy" data-v="${v}" data-ctx="${ctx}"><span class="dot" style="background:${lvColor(v)}">${v}</span>${LV[v]}</button>`).join("")}</div>`;
}

function timelineHTML(pickMode, picked) {
  const list = actsOn(today());
  const a = active();
  if (!list.length && !a) return '<p class="empty">Ingen aktiviteter registreret i dag.</p>';
  let h = '<div class="timeline">';
  for (const x of list) {
    const A = ACT[x.type] || { l: x.type, k: "drain" };
    const cls = pickMode ? " pick" + (picked === x.id ? " picked" : "") : "";
    const tag = pickMode ? "button" : "div";
    h += `<${tag} class="tl${cls}" ${pickMode ? `data-act="pickTl" data-id="${x.id}"` : ""}><span class="time">${hm(x.started_at)}</span><span class="rail"><span class="${A.k === "gain" ? "gain" : ""}"></span></span>
      <span class="body"><span class="nm">${A.l}</span><span class="dur">${dur(Date.parse(x.ended_at) - Date.parse(x.started_at))}</span>${x.energy ? `<span class="echip" style="background:${lvColor(x.energy)}">${LV[x.energy]}</span>` : ""}</span></${tag}>`;
  }
  if (a && !pickMode) {
    const A = ACT[a.type] || { l: a.type };
    h += `<div class="tl"><span class="time">${hm(a.started_at)}</span><span class="rail"><span class="${A.k === "gain" ? "gain" : ""}" style="outline:3px solid var(--olive-soft)"></span></span><span class="body"><span class="nm">${A.l}</span><span class="dur">i gang · <span class="elapsed" data-start="${Date.parse(a.started_at)}">${dur(Date.now() - Date.parse(a.started_at))}</span></span></span></div>`;
  }
  return h + "</div>";
}

function insightHTML() {
  const ins = insights(D().activities, D().hint_events);
  const you = isP() ? "du" : esc(patientName());
  if (!ins.enough) {
    return `<div class="insight"><div class="eyebrow" style="color:var(--ink)">Det har appen lært indtil nu</div>
      <div>Appen lærer ${isP() ? "din" : esc(patientName()) + "s"} rytme at kende ud fra aktiviteterne og energiniveauerne. Efter et par dages registreringer kommer de første mønstre her.</div>
      <div class="small">${ins.days} ${ins.days === 1 ? "dag" : "dage"} med data indtil nu.</div></div>`;
  }
  const parts = [];
  if (ins.types.length) parts.push(`Ud fra ${ins.days} dages data bliver ${you} typisk træt efter ca. ${ins.types.map((t) => `<b>${dur(t.min * MIN)} ${t.l.toLowerCase()}</b>`).join(" og efter ")}.`);
  else parts.push(`Ud fra ${ins.days} dages data er der endnu ikke et tydeligt mønster for, hvornår ${you} bliver træt.`);
  if (ins.low) parts.push(`Kl. ${ins.low.from}–${ins.low.to} er det mest sårbare tidsrum.`);
  const hs = ins.hints;
  return `<div class="insight"><div class="eyebrow" style="color:var(--ink)">Det har appen lært indtil nu</div><div>${parts.join(" ")}</div>
    ${hs.n ? `<div class="small">Hjernepause-forslag ramte rigtigt ${hs.hit} af ${hs.n} gange den sidste uge.${hs.late ? ` ${hs.late} ${hs.late === 1 ? "gang" : "gange"} kom de for sent.` : ""}</div>` : ""}</div>`;
}

V.energy = () => {
  let h = `<div class="page-title"><h1>Aktivitet</h1></div>`;
  const a = active();
  if (isP()) {
    if (pendingFixed()) h += fixedCard();
    if (a) {
      const A = ACT[a.type] || { l: a.type };
      h += `<div class="card"><div class="row between"><span class="eyebrow">I gang</span><span class="small muted">startet kl. ${hm(a.started_at)}</span></div>
        <div><div class="big">${A.l}</div><div class="muted elapsed" data-start="${Date.parse(a.started_at)}">${dur(Date.now() - Date.parse(a.started_at))}</div></div>
        <div class="q" style="font-weight:600">Stop aktiviteten: Hvordan er din energi lige nu?</div>${scaleHTML("stop")}
        <p class="small muted" style="margin:0">Dit valg gemmes med det samme.</p></div>`;
    } else {
      const tile = (k) => `<button class="tile ${ACT[k].k === "gain" ? "gain" : ""} ${UI.sel === k ? "sel" : ""}" data-act="selAct" data-k="${k}">${ACT[k].l}</button>`;
      h += `<div class="card"><div class="eyebrow">Start en aktivitet</div>
        <div class="small muted">Tager energi</div><div class="tiles">${DRAIN.map(tile).join("")}</div>
        <div class="small muted">Giver energi</div><div class="tiles">${GAIN_START.map(tile).join("")}</div>
        <button class="btn wide" data-act="startAct" ${UI.sel ? "" : "disabled"}>${UI.sel ? "Start " + ACT[UI.sel].l.toLowerCase() : "Vælg en aktivitet"}</button></div>`;
    }
  } else {
    const e = eguess();
    h += `<div class="card"><div class="eyebrow">Gæt på ${esc(patientName())}s energi lige nu</div><div class="big">${e.t}</div><div class="small muted">${e.s}</div></div><p class="info">Kun ${esc(patientName())} starter og stopper aktiviteter. Du kan følge med her.</p>`;
  }
  h += `<div class="card"><div class="section-title"><h2>I dag</h2>${isP() ? `<button class="linkbtn" data-act="openEval">Gennemgå dagen</button>` : ""}</div>${timelineHTML(false)}</div>`;
  h += insightHTML();
  return h;
};

function startActivity(type, origin = "manual") {
  const now = Date.now();
  const A = ACT[type];
  const last = lastEnergy(D().activities);
  const lastToday = last && dayKeyLocal(new Date(last.ended_at)) === today() ? last.energy : 4;
  const row = {
    type, origin, started_at: iso(now), ended_at: null, energy: null,
    next_check_at: iso(now + (A.check || 60) * MIN),
    next_hint_at: A.k === "drain" && S().hints
      ? iso(now + predictMinutes(type, D().activities, D().hint_events, lastToday, now) * MIN) : null,
  };
  store.upsert("activities", row);
  UI.sel = null;
}

function stopActivity(v, endT) {
  const a = active();
  if (!a) return null;
  const end = endT || Date.now();
  store.upsert("activities", { ...a, ended_at: iso(Math.max(end, Date.parse(a.started_at))), energy: v, next_check_at: null, next_hint_at: null });
  return a;
}

function recordHint(activity, answer, energyAfter = null) {
  const open = D().hint_events.filter((h) => h.activity_id === activity.id && !h.answer)
    .sort((x, y) => (x.asked_at < y.asked_at ? 1 : -1))[0];
  const base = open || {
    activity_id: activity.id, activity_type: activity.type, asked_at: iso(Date.now()),
    minutes_in: Math.round((Date.now() - Date.parse(activity.started_at)) / MIN),
  };
  store.upsert("hint_events", { ...base, answer, energy_after: energyAfter });
}

// ---------- Flows ----------

const F = {};

function forgotFlow() {
  const a = active();
  if (!a) return;
  const A = ACT[a.type] || { l: a.type };
  openSheet(`<h2>Er du stadig i gang?</h2><p class="q" style="margin:0">Du har haft <b>${A.l.toLowerCase()}</b> i gang i ${dur(Date.now() - Date.parse(a.started_at))}.</p>
    <div class="btnrow"><button class="btn" data-act="stillGoing">Ja, stadig i gang</button><button class="btn ghost" data-act="forgot">Jeg glemte at stoppe</button></div>`);
}
function forgotDuration() {
  const a = active();
  if (!a) return closeSheet();
  const max = Math.max(15, Math.round((Date.now() - Date.parse(a.started_at)) / MIN));
  F.mins = Math.min(F.mins || 45, max);
  openSheet(`<h2>Hvor længe var du i gang?</h2><p class="muted" style="margin:0">${ACT[a.type]?.l || a.type}, startet kl. ${hm(a.started_at)}</p>
    <div class="stepper"><button data-act="fmins" data-d="-15" aria-label="15 min mindre">−</button><b>${dur(F.mins * MIN)}</b><button data-act="fmins" data-d="15" aria-label="15 min mere">+</button></div>
    <div class="q" style="font-weight:600">Hvordan var din energi, da du stoppede?</div>${scaleHTML("forgot")}`);
}
function pauseFlow() {
  const a = active();
  if (!a || ACT[a.type]?.k !== "drain") return;
  openSheet(`<h2>Tid til en hjernepause?</h2><p class="q" style="margin:0">Jeg tror det er tid til en hjernepause. Er du enig?</p>
    <div class="btnrow"><button class="btn" data-act="pauseYes">Ja</button><button class="btn ghost" data-act="pauseNo">Nej, ikke endnu</button></div>`);
}
function brainFlow() {
  const a = active();
  if (!a || a.type !== "pause") return;
  openSheet(`<h2>Er du færdig med din hjernepause?</h2><p class="q" style="margin:0">Du har holdt pause i ${dur(Date.now() - Date.parse(a.started_at))}.</p>
    <div class="btnrow"><button class="btn" data-act="brainYes">Ja, jeg er færdig</button><button class="btn ghost" data-act="brainNo">Nej, lidt mere</button></div>`);
}
function evalFlow() {
  F.ev ||= { step: 1 };
  const e = F.ev;
  const post = `<button class="btn ghost wide" data-act="evalLater">Udskyd en time</button>`;
  if (e.step === 1) {
    openSheet(`<span class="eyebrow">Trin 1 af 3</span><h2>Hvordan har dagen været?</h2>
      <div class="scale">${Object.entries(MOODS).map(([k, m]) => `<button data-act="evalMood" data-k="${k}"><span class="dot" style="background:${lvColor(m.c)}"></span>${m.l}</button>`).join("")}</div>${post}`);
  } else if (e.step === 2) {
    openSheet(`<span class="eyebrow">Trin 2 af 3</span><h2>Hvornår havde du <u>mindst</u> energi?</h2><p class="muted" style="margin:0">Tryk på et tidspunkt i dagen.</p>${timelineHTML(true, e.low)}${post}`);
  } else {
    openSheet(`<span class="eyebrow">Trin 3 af 3</span><h2>Hvornår havde du <u>mest</u> energi?</h2><p class="muted" style="margin:0">Tryk på et tidspunkt i dagen.</p>${timelineHTML(true, e.high)}${post}`);
  }
}
function saveEval() {
  const e = F.ev;
  store.upsert("day_reviews", { day: today(), mood: e.mood, low_activity_id: e.low || null, high_activity_id: e.high || null });
  doneReminder("day_review");
  F.ev = null;
  closeSheet();
  toast("Tak! Dagen er gemt.");
  go("home");
}
function trainFlow() {
  let ks = trainingFor(today(), D().household?.settings);
  if (!ks.length) {
    toast("Der er ingen træning planlagt i dag.");
    return;
  }
  const log = D().training_log.filter((l) => l.day === today());
  F.tr = { ks, ans: Object.fromEntries(log.map((l) => [l.exercise, l.done])) };
  F.trDraw = () => openSheet(`<h2>Har du trænet i dag?</h2><p class="muted" style="margin:0">I dag står der: ${ks.map((k) => EXERCISES[k].toLowerCase()).join(" og ")}.</p>
    ${ks.map((k) => `<div class="ex"><span class="nm">${EXERCISES[k]}</span><div class="row"><button class="toggle-done ${F.tr.ans[k] === true ? "on" : ""}" data-act="trAns" data-k="${k}" data-v="1">Ja</button><button class="toggle-done ${F.tr.ans[k] === false ? "on" : ""}" style="${F.tr.ans[k] === false ? "background:var(--bad);border-color:var(--bad)" : ""}" data-act="trAns" data-k="${k}" data-v="0">Nej</button></div></div>`).join("")}
    <button class="btn wide" data-act="trSave" ${ks.every((k) => k in F.tr.ans) ? "" : "disabled"}>Gem</button><button class="btn ghost wide" data-act="trLater">Spørg mig igen om en time</button>`);
  F.trDraw();
}
function worryFlow() {
  openSheet(`<h2>Dagens bekymringer</h2><p class="q" style="margin:0">Er der noget, der fylder i dag, som du vil skrive ned?</p>
    <button class="btn wide" data-act="worryWrite">Skriv notat</button>
    <div class="btnrow"><button class="btn ghost" data-act="worryLater">Udskyd en time</button><button class="btn ghost" data-act="noNote">Intet i dag</button></div>`);
}

// ---------- Faste pauser ----------

/** Den ældste faste pause i dag, som er passeret og ikke startet. */
function pendingFixed() {
  if (!isP() || !D().household) return null;
  const t0 = today(), now = nowHHMM();
  for (const t of fixedPausesFor(t0, D().household.settings)) {
    if (t > now) continue;
    const kind = `fixed:${t}`;
    const r = reminder(kind, t0);
    if (r?.status === "done") continue;
    const [hh, mm] = t.split(":").map(Number);
    const at = new Date();
    at.setHours(hh, mm, 0, 0);
    if (!r && Date.now() - at > 3 * 60 * MIN) continue; // for gammel
    return { t, kind, r };
  }
  return null;
}
function fixedCard() {
  const p = pendingFixed();
  return `<div class="card" style="background:var(--olive-soft)"><div class="row between"><span class="eyebrow" style="color:var(--ink)">Fast pause kl. ${tdot(p.t)}</span><span class="small">venter</span></div>
    <div style="font-weight:600">Det er tid til din faste pause.</div><div class="btnrow"><button class="btn" data-act="fixedStart">Start fast pause</button><button class="btn ghost" data-act="fixedLater">Udskyd 15 min</button></div></div>`;
}
function fixedFlow() {
  const p = pendingFixed();
  if (!p) return;
  openSheet(`<h2>Tid til fast pause</h2><p class="q" style="margin:0">Kl. ${tdot(p.t)} er det tid til din faste pause.</p>
    <button class="btn wide" data-act="fixedStart">Start fast pause</button><button class="btn ghost wide" data-act="fixedLater">Udskyd 15 min</button>
    <p class="small muted" style="margin:0">Vil du springe den over, så start pausen og stop den igen.</p>`);
}
function startFixed() {
  // Alle faste pauser, der er passeret i dag, er nu klaret.
  const now = nowHHMM();
  for (const t of fixedPausesFor(today(), D().household.settings)) {
    if (t <= now && reminder(`fixed:${t}`)?.status !== "done") doneReminder(`fixed:${t}`);
  }
  startActivity("fast", "fixed");
  closeSheet();
  toast("Fast pause startet. God pause!");
  go("home");
}

// ============================================================
// Kost
// ============================================================

function searchResults() {
  const q = UI.q.trim().toLowerCase();
  if (!q) return "";
  const foods = FOODS();
  const day = new Set(D().food_entries.filter((e) => e.day === dk(UI.foodDay)).map((e) => e.item));
  const all = Object.keys(foods);
  const r = [...all.filter((n) => n.toLowerCase().startsWith(q)), ...all.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q))].slice(0, 7);
  const exact = all.some((n) => n.toLowerCase() === q);
  let h = `<div class="results">${r.map((n) => `<button data-act="addFood" data-n="${esc(n)}"><span class="cdot" style="width:10px;height:10px;border-radius:50%;background:${CATCOL[foods[n]]}"></span><b>${esc(n)}</b>${day.has(n) ? '<span class="small muted">(allerede tilføjet)</span>' : ""}<span class="c">${CATS[foods[n]].l}</span></button>`).join("")}`;
  if (!exact) h += `<button data-act="newFood"><span class="muted">＋ Tilføj “${esc(UI.q.trim())}” som ny råvare</span></button>`;
  return h + "</div>";
}
const CATCOL = { veg: "var(--ok)", fruit: "var(--e2)", leg: "var(--warn)", nut: "#8B6B4A", grain: "var(--sage)" };

function chartSVG(trend) {
  const W = 320, H = 150, pl = 26, pr = 10, pt = 14, pb = 24;
  const max = Math.ceil(Math.max(40, ...trend.map((t) => t.v)) / 10) * 10;
  const x = (i) => pl + (i * (W - pl - pr)) / 6, y = (v) => pt + (H - pt - pb) * (1 - v / max);
  const pts = trend.map((t, i) => [x(i), y(t.v)]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = line + ` L${x(6)} ${y(0)} L${x(0)} ${y(0)} Z`;
  let g = "";
  for (let v = 0; v <= max; v += 10) {
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  const labels = trend.map((t, i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${offOf(t.day) === 0 ? "i dag" : WD[weekday(t.day)]}</text>`).join("");
  const last = pts[6];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Antal forskellige råvarer pr. rullende 7 dage">${g}
    <line x1="${pl}" x2="${W - pr}" y1="${y(GOAL)}" y2="${y(GOAL)}" stroke="var(--ok)" stroke-width="1.5" stroke-dasharray="4 4"/><text x="${W - pr}" y="${y(GOAL) - 5}" text-anchor="end" style="fill:var(--ok)">mål ${GOAL}</text>
    <path d="${area}" fill="var(--primary)" opacity=".12"/><path d="${line}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round"/>
    ${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="var(--surface)" stroke="var(--primary)" stroke-width="2"/>`).join("")}
    <circle cx="${last[0]}" cy="${last[1]}" r="5.5" fill="var(--primary)"/>${labels}</svg>`;
}

V.food = () => {
  const f = fstats();
  const foods = FOODS();
  const key = dk(UI.foodDay);
  const day = D().food_entries.filter((e) => e.day === key).sort((a, b) => (a.created_at || a.updated_at || "") < (b.created_at || b.updated_at || "") ? -1 : 1);
  const inDay = new Set(day.map((e) => e.item));
  const cnt = {};
  for (const e of D().food_entries) if (offOf(e.day) <= 13) cnt[e.item] = (cnt[e.item] || 0) + 1;
  const freq = Object.keys(cnt).filter((n) => foods[n] && !inDay.has(n)).sort((a, b) => cnt[b] - cnt[a]).slice(0, 10);
  const p = D().protein_days.find((x) => x.day === key) || { fish: 0, meat: 0, poultry: 0 };
  let h = `<div class="page-title"><h1>Sundhed og kost</h1></div>`;
  h += `<div class="card"><div class="row between"><span class="eyebrow">Sidste 7 dage</span>${pill(f.st)}</div>
    <div><span class="big">${f.total}</span> <span class="muted">forskellige sunde råvarer af målet på ${GOAL}</span></div>
    <div class="meter"><span style="width:${Math.min(100, (f.total / GOAL) * 100)}%"></span><span class="goal" style="left:calc(100% - 1px)"></span></div>
    <div class="small muted">Heraf:</div>
    <div class="cats">${Object.entries(CATS).map(([k, c]) => `<div class="cat ${c.key ? "key" : ""}" style="color:${CATCOL[k]}">${ic(c.i, 22)}<b style="color:var(--ink)">${f.by[k]}</b><small>${c.s}</small></div>`).join("")}</div>
    <div class="small muted">Bælgfrugter og nødder/kerner er fremhævet, fordi de er særligt vigtige.</div></div>`;
  h += `<div class="card" id="reg"><div class="section-title"><h2>Registrér</h2><span class="small muted">kun type, ikke mængde</span></div>
    <div class="days">${[0, 1, 2, 3, 4, 5, 6].map((o) => { const k = dk(o); return `<button class="${UI.foodDay === o ? "sel" : ""}" data-act="foodDay" data-o="${o}">${o === 0 ? "I dag" : o === 1 ? "I går" : WD[weekday(k)]}<small>${dnum(k)}/${mnum(k)}</small></button>`; }).join("")}</div>
    <div class="search">${ic("search", 20)}<input id="foodQ" type="search" autocomplete="off" autocapitalize="sentences" placeholder="Skriv få bogstaver, fx “kik”" value="${esc(UI.q)}" aria-label="Søg råvare"></div>
    <div id="foodRes">${searchResults()}</div>
    ${freq.length ? `<div class="small muted">Ofte brugt · tryk for at tilføje</div>
    <div class="chips">${freq.map((n) => `<button class="chip" data-act="addFood" data-n="${esc(n)}"><span class="cdot" style="background:${CATCOL[foods[n]]}"></span>${esc(n)}</button>`).join("")}</div>` : ""}
    <div class="tabs-s">${Object.entries(CATS).map(([k, c]) => `<button class="${UI.browse === k ? "sel" : ""}" data-act="browse" data-k="${k}">${c.l}</button>`).join("")}</div>
    <div class="chips browse">${Object.keys(foods).filter((n) => foods[n] === UI.browse).sort((a, b) => a.localeCompare(b, "da")).map((n) => `<button class="chip ${inDay.has(n) ? "on" : ""}" data-act="${inDay.has(n) ? "rmFood" : "addFood"}" data-n="${esc(n)}">${esc(n)}</button>`).join("")}</div>
    <div class="eyebrow" style="margin-top:4px">${dayLabel(key)} · ${day.length} registreret</div>
    <div class="chips">${day.length ? day.map((e) => `<button class="chip on" data-act="rmFood" data-n="${esc(e.item)}" title="Fjern"><span class="by" title="Registreret af ${esc(member(e.created_by)?.display_name || "")}">${initial(e.created_by)}</span>${esc(e.item)}<span class="x">✕</span></button>`).join("") : '<span class="empty">Intet registreret endnu.</span>'}</div>
    <div class="eyebrow" style="margin-top:4px">Protein ${dayLabel(key).toLowerCase()}</div>
    <div class="prot">${Object.entries(PROT).map(([k, l]) => `<div class="p"><span class="small" style="font-weight:600">${l}</span><div class="ctl"><button data-act="prot" data-k="${k}" data-d="-1" aria-label="Færre ${l}">−</button><b>${p[k] || 0}</b><button data-act="prot" data-k="${k}" data-d="1" aria-label="Flere ${l}">+</button></div></div>`).join("")}</div>
    <button class="btn wide" data-go="home">Færdig</button></div>`;
  const first = f.trend[0].v, lastv = f.trend[6].v;
  h += `<div class="card"><div class="section-title"><h2>Udvikling</h2><span class="small muted">rullende 7 dage</span></div>${chartSVG(f.trend)}`;
  if (f.falling || f.drop.length) {
    const dl = f.dropByCat.leg, dn = f.dropByCat.nut;
    h += `<div class="warnbox">${ic("warn", 18)}<div>${f.falling ? `Variationen er faldet fra ${first} til ${lastv} på en uge. ` : ""}
      ${f.drop.length ? `<b>I morgen falder ${f.drop.length} råvare${f.drop.length > 1 ? "r" : ""} ud</b>${dl || dn ? `, heraf ${[dl ? dl + " bælgfrugt" + (dl > 1 ? "er" : "") : "", dn ? dn + " nødder/kerner" : ""].filter(Boolean).join(" og ")}` : ""}: ${esc(f.drop.join(", ").toLowerCase())}. Spis dem igen eller find nye.` : ""}</div></div>`;
  }
  h += `</div>`;
  h += `<div class="card"><div class="section-title"><h2>Protein</h2><span class="small muted">antal gange, 7 dage</span></div>
    <div class="cats" style="grid-template-columns:repeat(3,minmax(0,1fr))">${Object.entries(PROT).map(([k, l]) => `<div class="cat"><b>${f.prot[k]}</b><small>${l}</small></div>`).join("")}</div></div>`;
  return h;
};

function addFood(name) {
  const cat = FOODS()[name];
  if (!cat) return;
  const key = dk(UI.foodDay);
  if (D().food_entries.some((e) => e.day === key && e.item === name)) return;
  const before = foodWindow(D().food_entries, today()).has(name);
  store.upsert("food_entries", { day: key, item: name, category: cat, created_by: store.user?.id });
  toast(before ? `${name} tilføjet (tæller allerede med i ugen)` : `${name} tilføjet · ny råvare i ugen!`);
}

// ============================================================
// Træning
// ============================================================

V.training = () => {
  const t = tstats();
  const key = today();
  const todays = trainingFor(key, D().household?.settings);
  const log = Object.fromEntries(D().training_log.filter((l) => l.day === key).map((l) => [l.exercise, l.done]));
  let h = `<div class="page-title"><h1>Træning</h1></div>`;
  h += `<div class="card"><div class="row between"><span class="eyebrow">I dag · ${WDL[weekday(key)]}</span></div>`;
  if (!todays.length) h += `<p class="empty" style="margin:0">Ingen træning planlagt i dag.</p>`;
  else h += todays.map((k) => `<div class="ex"><span class="nm">${EXERCISES[k]}</span>${isP()
    ? `<button class="toggle-done ${log[k] ? "on" : "wait"}" data-act="trainToggle" data-k="${k}">${log[k] ? "Gjort ✓" : "Afventer · tryk når gjort"}</button>`
    : `<span class="toggle-done ${log[k] ? "on" : "wait"}">${log[k] ? "Gjort ✓" : "Afventer"}</span>`}</div>`).join("");
  h += `</div>`;
  const days = [6, 5, 4, 3, 2, 1, 0];
  h += `<div class="card"><div class="row between"><span class="eyebrow">Sidste 7 dage</span>${pill(t.st)}</div>
    <div><span class="big">${t.pct} %</span> <span class="muted">${t.done} af ${t.planned} planlagte gange</span></div>
    <div class="grid7"><span></span>${days.map((o) => `<span class="h">${o === 0 ? "i dag" : WD[weekday(dk(o))]}</span>`).join("")}
    ${Object.keys(EXERCISES).map((k) => `<span class="small" style="font-weight:600">${EXERCISES[k]}</span>${t.grid[k].map((c) => `<span class="c"><span class="${c.state}"></span></span>`).join("")}`).join("")}</div>
    <div class="legend"><span><i style="background:var(--ok)"></i>Gjort</span><span><i style="border:2px solid var(--bad)"></i>Sprunget over</span><span><i style="background:var(--line)"></i>Afventer (i dag)</span></div>
    <div class="small muted">Over 80 % er grøn, over 50 % er gul, under er rød.</div></div>`;
  if (isP()) h += `<button class="linkrow" data-go="settings">${ic("dumb")}<span class="t">Ret træningsplan og påmindelse</span>${ic("chev")}</button>`;
  else h += `<p class="info">Du får ikke påmindelser om træning. Kun ${esc(patientName())} markerer træning som gjort.</p>`;
  return h;
};

function checkTrainingDone() {
  const ks = trainingFor(today(), D().household?.settings);
  const answered = new Set(D().training_log.filter((l) => l.day === today()).map((l) => l.exercise));
  if (ks.length && ks.every((k) => answered.has(k)) && reminder("training")?.status !== "done") doneReminder("training");
}

// ============================================================
// Notater og bekymringer
// ============================================================

const draftKey = () => `msk.draft.${store.user?.id || "demo"}`;
function getDraft() {
  try {
    return localStorage.getItem(draftKey()) || "";
  } catch {
    return "";
  }
}
function setDraft(v) {
  try {
    if (v) localStorage.setItem(draftKey(), v);
    else localStorage.removeItem(draftKey());
  } catch {}
}

V.notes = () => {
  const draft = getDraft();
  let h = `<div class="page-title"><h1>Notater og bekymringer</h1></div>`;
  h += `<div class="card"><div class="row between"><span class="eyebrow">Dagens notat · ${dateLong(today())}</span><span class="small muted" id="draftState">${draft ? "Kladde gemt" : ""}</span></div>
    <textarea id="draft" placeholder="Hvad går dig på i dag?">${esc(draft)}</textarea>
    <div class="btnrow"><button class="btn" data-act="saveNote">Gem notat</button><button class="btn ghost" data-act="noNote">Intet i dag</button></div>
    <p class="small muted" style="margin:0">Teksten bliver gemt mens du skriver, også hvis du går til forsiden.</p></div>`;
  h += `<div class="card"><div class="section-title"><h2>Analyse af bekymringer</h2></div>
    <div class="small muted">Hvor langt tilbage skal jeg kigge?</div>
    <div class="seg">${[[7, "1 uge"], [14, "2 uger"], [30, "1 måned"], [90, "3 mdr."]].map(([v, l]) => `<button class="${UI.period === v ? "sel" : ""}" data-act="period" data-v="${v}">${l}</button>`).join("")}</div>
    <button class="btn wide soft" data-act="analyse">Lav analyse</button><div id="anal">${UI.analysis || ""}</div></div>`;
  const list = [...D().notes].sort((a, b) => (a.day < b.day ? 1 : -1));
  h += `<div class="card"><div class="section-title"><h2>Tidligere notater</h2><span class="small muted">${list.length}</span></div><div>${list.length ? list.map((n) => {
    const o = offOf(n.day);
    return `<div class="note"><span class="d">${dayLabel(n.day)}${o > 1 ? " " + dnum(n.day) + ". " + MON[mnum(n.day) - 1] : ""}</span>${n.nothing ? '<p class="muted">Intet at skrive denne dag.</p>' : `<p>${esc(n.body).replace(/\n/g, "<br>")}</p>`}</div>`;
  }).join("") : '<p class="empty">Ingen notater endnu.</p>'}</div></div>`;
  return h;
};

function saveNote(body, nothing = false) {
  const existing = D().notes.find((n) => n.day === today());
  let text = body;
  // Skriver hun flere gange samme dag, lægges teksten til dagens notat.
  if (!nothing && existing && !existing.nothing && existing.body && !existing.body.includes(body)) text = existing.body + "\n\n" + body;
  store.upsert("notes", { day: today(), body: nothing ? "" : text, nothing });
  doneReminder("worry");
}

async function runAnalysis() {
  const box = $("#anal");
  box.innerHTML = '<p class="empty">Læser dine notater …</p>';
  try {
    let r;
    if (DEMO) {
      await new Promise((ok) => setTimeout(ok, 600));
      r = demoAnalysis(UI.period);
    } else {
      const { data, error } = await db.functions.invoke("analyze-notes", { body: { days: UI.period, today: today() } });
      if (error) {
        let msg = "Analysen fejlede. Prøv igen om lidt.";
        try {
          msg = (await error.context.json()).error || msg;
        } catch {}
        throw new Error(msg);
      }
      r = data;
    }
    UI.analysis = analysisHTML(r);
  } catch (err) {
    UI.analysis = `<p class="ana-err">${esc(err.message)}</p>`;
  }
  render(true);
}

function analysisHTML(r) {
  if (!r.count) return `<p class="empty">Ingen notater i perioden.</p>`;
  const li = (arr) => `<ul>${arr.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  return `<div class="analysis insight"><div class="eyebrow" style="color:var(--ink)">Opsummering · ${r.count} notater</div>
    <p style="margin:0">${esc(r.summary)}</p>
    ${r.recurring?.length ? `<h3>Går igen</h3>${li(r.recurring.map((t) => `<b>${esc(t.topic)}</b> (${t.times} ${t.times === 1 ? "gang" : "gange"}). ${esc(t.detail)}`))}` : ""}
    ${r.biggest?.length ? `<h3>Fylder mest lige nu</h3>${li(r.biggest.map(esc))}` : ""}
    ${r.resolved?.length ? `<h3>Ikke længere en bekymring</h3>${li(r.resolved.map(esc))}` : ""}
    <p class="small muted" style="margin:0">Lavet af Claude ud fra dine egne notater. Kun du kan se dem.</p></div>`;
}

// ============================================================
// Indstillinger
// ============================================================

let pushState = "…";
async function refreshPushState() {
  pushState = DEMO ? "demo" : await pushStatus(CFG.vapidPublicKey);
  if (UI.view === "settings") render(true);
}

function pushCard() {
  const msg = {
    on: `<p class="small muted" style="margin:0">Notifikationer er slået til på denne telefon. De vises også på Apple Watch, når iPhonen er låst.</p>
      <div class="btnrow"><button class="btn soft" data-act="testPush">Send en test</button><button class="btn ghost" data-act="pushOff">Slå fra</button></div>`,
    off: `<p class="small muted" style="margin:0">Slå notifikationer til, så appen kan minde dig om pauser og spørge, hvordan det går.</p><button class="btn wide" data-act="pushOn">${ic("bell", 18)} Slå notifikationer til</button>`,
    denied: `<p class="small" style="margin:0">Notifikationer er blokeret. Åbn iPhonens <b>Indstillinger → Notifikationer → MS Kompasset</b> og tillad dem.</p>`,
    "needs-install": `<p class="small" style="margin:0">På iPhone virker notifikationer kun, når appen er lagt på hjemmeskærmen: tryk på <b>Del</b> i Safari og vælg <b>Føj til hjemmeskærm</b>. Åbn derefter appen derfra.</p>`,
    unsupported: `<p class="small" style="margin:0">Denne browser understøtter ikke notifikationer. Brug Safari på iPhone (iOS 16.4 eller nyere).</p>`,
    "not-configured": `<p class="small" style="margin:0">Notifikationer er ikke sat op endnu (VAPID-nøgle mangler i config.js).</p>`,
    demo: `<p class="small muted" style="margin:0">Demo: notifikationer er slået fra.</p>`,
    "…": "",
  }[pushState] || "";
  return `<div class="card"><div class="eyebrow">Notifikationer på denne telefon</div>${msg}</div>`;
}

V.settings = () => {
  const s = S();
  const ord = [1, 2, 3, 4, 5, 6, 0];
  let h = `<div class="page-title"><h1>Indstillinger</h1></div>`;
  if (DEMO) {
    h += `<div class="card"><div class="eyebrow">Demo · hvem bruger appen?</div><div class="seg"><button class="${isP() ? "sel" : ""}" data-act="demoUser" data-u="patient">${esc(patientName())}</button><button class="${!isP() ? "sel" : ""}" data-act="demoUser" data-u="supporter">Peter</button></div>
      <p class="small muted" style="margin:0">Demo med testdata. Intet gemmes online.</p><button class="btn ghost" data-act="demoReset">Nulstil testdata</button></div>`;
  }
  h += pushCard();
  if (isP()) {
    h += `<div class="card"><div class="eyebrow">Træningsplan</div>${Object.keys(EXERCISES).map((k) => `<div><div style="font-weight:600;margin-bottom:6px">${EXERCISES[k]}</div><div class="wd">${ord.map((d) => `<button class="${(s.trainingPlan[k] || []).includes(d) ? "on" : ""}" data-act="planDay" data-k="${k}" data-d="${d}" aria-label="${WDL[d]}">${WD[d][0].toUpperCase()}</button>`).join("")}</div></div>`).join("")}</div>`;
    const hol = holidayName(today());
    const fx = (g, k, lab, id, def) => `<div style="display:flex;flex-direction:column;gap:8px"><div style="font-weight:600">${lab}</div>
      <div class="chips">${s[k].length ? [...s[k]].sort().map((t) => `<button class="chip on" data-act="rmFixed" data-g="${k}" data-t="${t}" aria-label="Fjern ${tdot(t)}">kl. ${tdot(t)}<span class="x">✕</span></button>`).join("") : '<span class="empty">Ingen faste pauser</span>'}</div>
      <div class="row"><input type="time" id="${id}" value="${def}" style="padding:8px 10px;border-radius:10px;border:1px solid var(--line);background:var(--bg)" aria-label="Nyt tidspunkt"><button class="btn soft" style="min-height:40px;padding:8px 14px" data-act="addFixed" data-g="${k}" data-i="${id}">Tilføj</button></div></div>`;
    h += `<div class="card"><div class="eyebrow">Faste pauser</div>
      ${fx("week", "fixedWeek", "Hverdage (mandag til fredag)", "addWeek", "10:00")}
      ${fx("weekend", "fixedWeekend", "Weekend og helligdage", "addWeekend", "11:00")}
      <p class="small muted" style="margin:0">I dag er ${hol ? hol.toLowerCase() + " (fridag)" : isRestDay(today()) ? "weekend" : "en hverdag"}. Juleaften, nytårsaften og grundlovsdag tæller som weekend. Appen giver besked på tidspunktet. Udskyder du, minder den dig hvert kvarter, indtil du starter pausen. Tryk på et tidspunkt for at fjerne det.</p></div>`;
    h += `<div class="card"><div class="eyebrow">Påmindelser</div>
      <div class="set-row"><label for="tTrain">Har du trænet i dag?</label><input type="time" id="tTrain" data-set="trainTime" value="${s.trainTime}"></div>
      <div class="set-row"><label for="tDay">Hvordan er dagen gået?</label><input type="time" id="tDay" data-set="dayTime" value="${s.dayTime}"></div>
      <div class="set-row"><label for="tWorry">Dagens bekymringer</label><input type="time" id="tWorry" data-set="worryTime" value="${s.worryTime}"></div>
      <div class="set-row"><span>Forslag om hjernepause</span><button class="sw ${s.hints ? "on" : ""}" data-act="sw" data-k="hints" aria-label="Forslag om hjernepause" aria-pressed="${s.hints}"></button></div>
      <p class="small muted" style="margin:0">Flere træninger samme dag samles i én påmindelse.</p></div>`;
  } else {
    const ms = MS();
    h += `<div class="card"><div class="eyebrow">Påmindelser for dig</div>
      <div class="set-row"><span>Registrér aftensmad</span><button class="sw ${ms.foodReminder ? "on" : ""}" data-act="msw" data-k="foodReminder" aria-label="Påmindelse om aftensmad" aria-pressed="${ms.foodReminder}"></button></div>
      <div class="set-row"><label for="tPF">Tidspunkt</label><input type="time" id="tPF" data-mset="foodTime" value="${ms.foodTime}"></div>
      <p class="small muted" style="margin:0">Du får ikke påmindelser om træning og pauser. Dem får kun ${esc(patientName())}.</p></div>`;
  }
  const others = D().members.filter((m) => m.user_id !== D().me.user_id);
  h += `<div class="card"><div class="eyebrow">Jeres fælles hjem</div>
    <div class="small">${D().members.map((m) => `${esc(m.display_name)} (${m.role === "patient" ? "har MS" : "støtte"})`).join(" · ")}</div>
    ${others.length ? "" : `<p class="small muted" style="margin:0">Den anden skal oprette sin egen konto og skrive denne kode første gang, så deler I data:</p>`}
    <div class="code">${esc(D().household?.invite_code || "")}</div></div>`;
  if (!DEMO) {
    h += `<div class="card"><div class="eyebrow">Konto</div><p class="small muted" style="margin:0">Logget ind som <b>${esc(store.user?.email || "")}</b></p>
      <form id="pwForm" class="stack" style="display:flex;flex-direction:column;gap:8px" autocomplete="on">
        <input type="email" name="username" value="${esc(store.user?.email || "")}" autocomplete="username" hidden>
        <label class="field">Ny adgangskode<input type="password" name="password" minlength="8" required autocomplete="new-password"></label>
        <button class="btn soft" type="submit">Skift adgangskode</button><p id="pwMsg" class="msg"></p></form>
      <button class="btn danger" data-act="logout">Log ud</button></div>`;
  }
  return h;
};

// ============================================================
// Klik og input
// ============================================================

document.addEventListener("click", async (ev) => {
  const g = ev.target.closest("[data-go]");
  if (g) {
    closeSheet();
    go(g.dataset.go);
    return;
  }
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const d = b.dataset;
  const a = active();
  switch (d.act) {
    case "closeSheet": closeSheet(); break;
    case "selAct": UI.sel = d.k; render(true); break;
    case "startAct":
      if (!UI.sel || active()) return;
      toast(`${ACT[UI.sel].l} er startet`);
      startActivity(UI.sel);
      go("home");
      break;
    case "energy": {
      const v = +d.v;
      if (!a) {
        closeSheet();
        break;
      }
      const A = ACT[a.type] || { l: a.type };
      if (d.ctx === "stop") {
        closeSheet();
        stopActivity(v);
        toast(`Gemt: ${A.l} · ${LV[v].toLowerCase()}`);
        go("energy");
      } else if (d.ctx === "forgot") {
        const m = F.mins;
        stopActivity(v, Date.parse(a.started_at) + m * MIN);
        F.mins = null;
        closeSheet();
        toast(`Gemt: ${A.l} · ${dur(m * MIN)} · ${LV[v].toLowerCase()}`);
        go("energy");
      } else if (d.ctx === "fixed") {
        stopActivity(v);
        startFixed();
      } else if (d.ctx === "hint") {
        recordHint(a, "yes", v);
        stopActivity(v);
        closeSheet();
        toast(v === 1 ? "Noteret. Spørgsmålet kom for sent, så jeg spørger tidligere næste gang." : "Gemt. God pause!");
        startActivity("pause", "hint");
        go("home");
      }
      break;
    }
    case "fixedOpen": fixedFlow(); break;
    case "fixedStart":
      if (a && a.type !== "fast") openSheet(`<h2>Hvordan er din energi nu?</h2><p class="muted" style="margin:0">${ACT[a.type]?.l || a.type} stoppes, og din faste pause startes.</p>${scaleHTML("fixed")}`);
      else if (a?.type === "fast") {
        startFixedDoneOnly();
      } else startFixed();
      break;
    case "fixedLater": {
      const p = pendingFixed();
      closeSheet();
      if (p) snoozeReminder(p.kind, 15);
      toast(`Jeg minder dig igen kl. ${later(15)}.`);
      render(true);
      break;
    }
    case "addFixed": {
      const inp = document.getElementById(d.i);
      const v = inp?.value;
      const cur = S()[d.g];
      if (v && !cur.includes(v)) {
        store.setHouseholdSettings({ [d.g]: [...cur, v].sort() });
        toast(`Fast pause kl. ${tdot(v)} tilføjet`);
      }
      break;
    }
    case "rmFixed": store.setHouseholdSettings({ [d.g]: S()[d.g].filter((t) => t !== d.t) }); break;
    case "brainYes": openSheet(`<h2>Hvordan har du det nu?</h2><p class="muted" style="margin:0">Hjernepausen stoppes.</p>${scaleHTML("stop")}`); break;
    case "brainNo":
      closeSheet();
      if (a) store.upsert("activities", { ...a, next_check_at: iso(Date.now() + 5 * MIN) });
      toast(`Nyd pausen. Jeg spørger igen kl. ${later(5)}.`);
      break;
    case "stillGoing":
      closeSheet();
      if (a) store.upsert("activities", { ...a, next_check_at: iso(Date.now() + 60 * MIN) });
      toast(`Fint. Jeg spørger igen kl. ${later(60)}.`);
      break;
    case "forgot": F.mins = 45; forgotDuration(); break;
    case "fmins": {
      if (!a) break;
      const max = Math.max(15, Math.round((Date.now() - Date.parse(a.started_at)) / MIN));
      F.mins = Math.max(15, Math.min(max, F.mins + +d.d));
      forgotDuration();
      break;
    }
    case "pauseYes":
      if (!a) return closeSheet();
      openSheet(`<h2>Hvordan har du det nu?</h2><p class="muted" style="margin:0">${ACT[a.type]?.l || a.type} stoppes, og en hjernepause startes.</p>${scaleHTML("hint")}`);
      break;
    case "pauseNo":
      closeSheet();
      if (a) {
        recordHint(a, "no");
        store.upsert("activities", { ...active(), next_hint_at: iso(Date.now() + 15 * MIN) });
      }
      toast(`Okay. Jeg spørger igen kl. ${later(15)}.`);
      break;
    case "openEval": F.ev = null; evalFlow(); break;
    case "evalMood":
      F.ev.mood = d.k;
      if (!actsOn(today()).length) return saveEval();
      F.ev.step = 2;
      evalFlow();
      break;
    case "pickTl":
      if (F.ev.step === 2) {
        F.ev.low = d.id;
        evalFlow();
        setTimeout(() => { F.ev.step = 3; evalFlow(); }, 350);
      } else {
        F.ev.high = d.id;
        evalFlow();
        setTimeout(saveEval, 400);
      }
      break;
    case "evalLater":
      closeSheet();
      F.ev = null;
      snoozeReminder("day_review", 60);
      toast(`Jeg spørger igen kl. ${later(60)}.`);
      break;
    case "trAns": F.tr.ans[d.k] = d.v === "1"; F.trDraw(); break;
    case "trSave":
      for (const [ex, done] of Object.entries(F.tr.ans)) store.upsert("training_log", { day: today(), exercise: ex, done });
      doneReminder("training");
      closeSheet();
      toast("Træning gemt");
      go("home");
      break;
    case "trLater":
      closeSheet();
      snoozeReminder("training", 60);
      toast(`Jeg spørger igen kl. ${later(60)}.`);
      break;
    case "trainToggle": {
      const cur = D().training_log.find((l) => l.day === today() && l.exercise === d.k);
      if (cur?.done) store.remove("training_log", cur);
      else store.upsert("training_log", { day: today(), exercise: d.k, done: true });
      checkTrainingDone();
      break;
    }
    case "worryWrite":
      closeSheet();
      go("notes");
      setTimeout(() => $("#draft")?.focus(), 300);
      break;
    case "worryLater":
      closeSheet();
      snoozeReminder("worry", 60);
      toast(`Jeg spørger igen kl. ${later(60)}.`);
      break;
    case "noNote":
      closeSheet();
      if (!D().notes.some((n) => n.day === today() && !n.nothing)) saveNote("", true);
      else doneReminder("worry");
      toast("Noteret: intet at skrive i dag");
      go("home");
      break;
    case "saveNote": {
      const t = getDraft().trim();
      if (!t) return toast("Skriv lidt tekst først");
      saveNote(t);
      setDraft("");
      toast("Notat gemt");
      go("home");
      break;
    }
    case "period": UI.period = +d.v; UI.analysis = null; render(true); break;
    case "analyse": runAnalysis(); break;
    case "foodDay": UI.foodDay = +d.o; render(true); break;
    case "browse": UI.browse = d.k; render(true); break;
    case "addFood": {
      const fromSearch = !!b.closest("#foodRes");
      addFood(d.n);
      UI.q = "";
      render(true);
      if (fromSearch) $("#foodQ")?.focus();
      break;
    }
    case "newFood": {
      const name = UI.q.trim().replace(/\s+/g, " ");
      if (!name) break;
      F.newFood = name[0].toUpperCase() + name.slice(1);
      openSheet(`<h2>Ny råvare</h2><p class="q" style="margin:0">Hvilken gruppe hører <b>${esc(F.newFood)}</b> til?</p>
        <div class="scale">${Object.entries(CATS).map(([k, c]) => `<button data-act="newFoodCat" data-k="${k}"><span class="dot" style="background:${CATCOL[k]}"></span>${c.l}</button>`).join("")}</div>`);
      break;
    }
    case "newFoodCat":
      store.upsert("custom_foods", { name: F.newFood, category: d.k });
      closeSheet();
      addFood(F.newFood);
      UI.q = "";
      render(true);
      break;
    case "rmFood": {
      const e = D().food_entries.find((x) => x.day === dk(UI.foodDay) && x.item === d.n);
      if (e) store.remove("food_entries", e);
      break;
    }
    case "prot": {
      const key = dk(UI.foodDay);
      const p = D().protein_days.find((x) => x.day === key) || { day: key, fish: 0, meat: 0, poultry: 0 };
      store.upsert("protein_days", { day: key, fish: p.fish || 0, meat: p.meat || 0, poultry: p.poultry || 0, [d.k]: Math.max(0, (p[d.k] || 0) + +d.d) });
      break;
    }
    case "planDay": {
      const plan = { ...S().trainingPlan };
      const cur = plan[d.k] || [];
      const dd = +d.d;
      plan[d.k] = cur.includes(dd) ? cur.filter((x) => x !== dd) : [...cur, dd].sort();
      store.setHouseholdSettings({ trainingPlan: plan });
      break;
    }
    case "sw": store.setHouseholdSettings({ [d.k]: !S()[d.k] }); break;
    case "msw": store.setMemberSettings({ [d.k]: !MS()[d.k] }); break;
    case "pushOn":
      try {
        b.disabled = true;
        await enablePush(db, CFG.vapidPublicKey);
        toast("Notifikationer er slået til");
      } catch (err) {
        toast(err.message || "Kunne ikke slå notifikationer til");
      }
      refreshPushState();
      break;
    case "pushOff":
      await disablePush(db).catch(() => {});
      toast("Notifikationer er slået fra på denne telefon");
      refreshPushState();
      break;
    case "testPush": {
      b.disabled = true;
      const { data, error } = await db.functions.invoke("notify", { body: { test: true } });
      b.disabled = false;
      toast(error ? "Testen fejlede. Er notify-funktionen sat op?" : data.sent ? "Testen er sendt. Den kommer om et øjeblik." : "Ingen enheder fik testen. Slå notifikationer fra og til igen.");
      break;
    }
    case "logout":
      if (store.ops.length && !confirm("Nogle ændringer er endnu ikke gemt online og går tabt, hvis du logger ud. Log ud alligevel?")) return;
      await disablePush(db).catch(() => {});
      await db.auth.signOut();
      break;
    case "demoUser": demoSwitch(d.u); break;
    case "demoReset": seedDemo(); toast("Testdata er nulstillet"); go("home"); break;
  }
});

// Startes den faste pause, mens en "fast pause" allerede er i gang, lukkes påmindelsen bare.
function startFixedDoneOnly() {
  const now = nowHHMM();
  for (const t of fixedPausesFor(today(), D().household.settings)) if (t <= now && reminder(`fixed:${t}`)?.status !== "done") doneReminder(`fixed:${t}`);
  closeSheet();
  render(true);
}

document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.id === "foodQ") {
    UI.q = t.value;
    $("#foodRes").innerHTML = searchResults();
  }
  if (t.id === "draft") {
    setDraft(t.value);
    const s = $("#draftState");
    if (s) s.textContent = t.value ? "Kladde gemt" : "";
  }
});
document.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.dataset?.set && t.value) store.setHouseholdSettings({ [t.dataset.set]: t.value });
  if (t.dataset?.mset && t.value) store.setMemberSettings({ [t.dataset.mset]: t.value });
});
document.addEventListener("keydown", (ev) => {
  if (ev.target.id === "foodQ" && ev.key === "Enter") {
    const f = $("#foodRes [data-n]") || $("#foodRes [data-act=newFood]");
    if (f) {
      ev.preventDefault();
      f.click();
      setTimeout(() => $("#foodQ")?.focus(), 0);
    }
  }
  if (ev.key === "Escape") closeSheet();
});
document.addEventListener("submit", async (ev) => {
  if (ev.target.id !== "pwForm") return;
  ev.preventDefault();
  const msg = $("#pwMsg");
  const { error } = await db.auth.updateUser({ password: ev.target.password.value });
  msg.className = "msg " + (error ? "error" : "ok");
  msg.textContent = error ? (/different/i.test(error.message) ? "Den nye adgangskode skal være forskellig fra den gamle." : error.message) : "Adgangskoden er skiftet.";
  if (!error) ev.target.reset();
});

// ============================================================
// Påmindelser mens appen er åben + tryk på notifikationer
// ============================================================

const asked = new Set();
function tick() {
  if (!isP() || !D().me || document.visibilityState !== "visible") return;
  const now = Date.now();
  // Fast pause
  const p = pendingFixed();
  if (p) {
    const due = !p.r || !p.r.next_at || Date.parse(p.r.next_at) <= now;
    const key = `${p.kind}|${p.r?.next_at || "first"}`;
    if (due && !asked.has(key)) {
      asked.add(key);
      chime();
      render(true);
      if (!sheetOpen) fixedFlow();
    }
  }
  // Aktivitet i gang
  const a = active();
  if (a && !sheetOpen) {
    const A = ACT[a.type] || {};
    if (a.next_check_at && Date.parse(a.next_check_at) <= now && !asked.has("c" + a.id + a.next_check_at)) {
      asked.add("c" + a.id + a.next_check_at);
      chime();
      if (A.check) brainFlow();
      else forgotFlow();
    } else if (S().hints && A.k === "drain" && a.next_hint_at && Date.parse(a.next_hint_at) <= now && !asked.has("h" + a.id + a.next_hint_at)) {
      asked.add("h" + a.id + a.next_hint_at);
      chime();
      pauseFlow();
    }
  }
}
setInterval(tick, 10000);
setInterval(() => document.querySelectorAll(".elapsed").forEach((el) => (el.textContent = dur(Date.now() - +el.dataset.start))), 30000);

function handleOpen(info) {
  const n = info.kind || info.n;
  if (!n || !D().me) return;
  closeSheet();
  if (n.startsWith("fixed:")) { go(isP() ? "home" : "home"); fixedFlow(); }
  else if (n === "training") { go("training"); trainFlow(); }
  else if (n === "day_review") { go("energy"); F.ev = null; evalFlow(); }
  else if (n === "worry") { go("notes"); worryFlow(); }
  else if (n === "food") { UI.foodDay = 0; go("food"); }
  else if (n === "check") { go("energy"); forgotFlow(); }
  else if (n === "brain") { go("energy"); brainFlow(); }
  else if (n === "hint") { go("energy"); pauseFlow(); }
}

navigator.serviceWorker?.addEventListener("message", async (e) => {
  const m = e.data || {};
  if (m.type === "open") {
    await store.sync();
    handleOpen(m.data || {});
  } else if (m.type === "push") {
    await store.sync();
    const k = m.data?.kind || "";
    if (/^(fixed:|check|brain|hint)/.test(k) && document.visibilityState === "visible" && !sheetOpen) {
      chime();
      handleOpen(m.data);
    }
  }
});

// ============================================================
// Login og første opsætning
// ============================================================

function show(which) {
  $("#auth-view").hidden = which !== "auth";
  $("#setup-view").hidden = which !== "setup";
  $("#app").hidden = which !== "app";
}

function translateAuthError(err) {
  const m = err?.message || String(err);
  if (/invalid login credentials/i.test(m)) return "Forkert e-mail eller adgangskode.";
  if (/email not confirmed/i.test(m)) return "Du skal først bekræfte din e-mail via linket, vi har sendt dig.";
  if (/already registered/i.test(m)) return "Der findes allerede en konto med den e-mail. Log ind i stedet.";
  if (/password should be at least/i.test(m)) return "Adgangskoden skal være på mindst 8 tegn.";
  if (/rate limit/i.test(m)) return "For mange forsøg. Vent lidt og prøv igen.";
  if (/signups not allowed/i.test(m)) return "Det er ikke muligt at oprette nye konti.";
  if (/fetch|network/i.test(m)) return "Ingen forbindelse. Tjek dit internet.";
  return m;
}

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const mode = e.submitter?.dataset.mode || "signin";
  const email = e.target.email.value.trim();
  const password = e.target.password.value;
  const msg = $("#auth-msg");
  const set = (t, k = "") => { msg.textContent = t; msg.className = "msg " + k; };
  set(mode === "signup" ? "Opretter konto…" : "Logger ind…");
  try {
    if (mode === "signup") {
      const { data, error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      if (!data.session) set("Konto oprettet! Tjek din e-mail og klik på linket. Kom derefter tilbage og log ind.", "ok");
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      set("");
    }
  } catch (err) {
    set(translateAuthError(err), "error");
  }
});

let setup = { role: null, name: "", mode: null, err: "" };
function renderSetup() {
  const s = setup;
  let h = `<div class="brand"><img src="branding/logo.png" alt=""><h1>Velkommen</h1><p class="muted" style="margin:0">Lad os sætte appen op. Det tager et minut.</p></div><div class="card">`;
  h += `<div class="eyebrow">Hvem er du?</div><div class="scale">
    <button data-sact="role" data-v="patient" style="${s.role === "patient" ? "outline:2px solid var(--primary)" : ""}">Jeg har MS og bruger appen til min hverdag</button>
    <button data-sact="role" data-v="supporter" style="${s.role === "supporter" ? "outline:2px solid var(--primary)" : ""}">Jeg er pårørende og vil støtte</button></div>
    <label class="field">Dit fornavn<input id="sName" value="${esc(s.name)}" autocomplete="given-name"></label>`;
  if (s.role) {
    h += `<div class="eyebrow">Fælles hjem</div>
      <p class="small muted" style="margin:0">I deler data gennem et fælles hjem. Den første opretter det og får en kode. Den anden skriver koden.</p>
      <div class="btnrow"><button class="btn ${s.mode === "create" ? "" : "ghost"}" data-sact="mode" data-v="create">Opret nyt hjem</button><button class="btn ${s.mode === "join" ? "" : "ghost"}" data-sact="mode" data-v="join">Jeg har en kode</button></div>`;
    if (s.mode === "join") h += `<label class="field">Kode<input id="sCode" autocapitalize="characters" autocomplete="off" maxlength="6" style="letter-spacing:.2em;text-transform:uppercase"></label>`;
    if (s.mode) h += `<button class="btn wide" data-sact="go">Fortsæt</button>`;
  }
  h += `<p class="msg error">${esc(s.err)}</p></div><button class="linkbtn" data-sact="logout" style="align-self:center">Log ud</button>`;
  $("#setup-view").innerHTML = h;
}
$("#setup-view").addEventListener("input", (e) => {
  if (e.target.id === "sName") setup.name = e.target.value;
});
$("#setup-view").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-sact]");
  if (!b) return;
  const v = b.dataset.v;
  if (b.dataset.sact === "role") { setup.role = v; setup.err = ""; }
  if (b.dataset.sact === "mode") { setup.mode = v; setup.err = ""; }
  if (b.dataset.sact === "logout") { await db.auth.signOut(); return; }
  if (b.dataset.sact === "go") {
    if (!setup.name.trim()) { setup.err = "Skriv dit fornavn."; return renderSetup(); }
    b.disabled = true;
    const { error } = setup.mode === "create"
      ? await db.rpc("create_household", { p_role: setup.role, p_display_name: setup.name.trim() })
      : await db.rpc("join_household", { p_code: $("#sCode").value, p_role: setup.role, p_display_name: setup.name.trim() });
    if (error) {
      setup.err = /findes ikke/.test(error.message) ? "Koden findes ikke. Tjek den og prøv igen." : error.message;
      return renderSetup();
    }
    await store.sync();
    enterApp();
    return;
  }
  renderSetup();
});

function enterApp() {
  if (!D().me) {
    show("setup");
    renderSetup();
    return;
  }
  show("app");
  if (!enterApp.started) {
    enterApp.started = true;
    UI.view = isP() && active() ? "energy" : "home";
    const n = params.get("n");
    if (n) {
      history.replaceState(null, "", location.pathname + (DEMO ? "?demo" : ""));
      setTimeout(() => handleOpen({ kind: n }), 50);
    }
  }
  render();
  refreshPushState();
}

if (!DEMO) {
  db.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      if (store.user?.id === session.user.id) return;
      if (store.data.me && store.data.me.user_id !== session.user.id) store.reset();
      store.user = session.user;
      if (store.data.me) enterApp();
      store.sync().then(() => {
        enterApp();
        refreshSubscription(db);
      });
    } else if (event === "SIGNED_OUT" || event === "INITIAL_SESSION") {
      store.user = null;
      if (event === "SIGNED_OUT") {
        store.reset();
        enterApp.started = false;
      }
      show("auth");
    }
  });
  window.addEventListener("online", () => store.sync());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") store.sync();
  });
  setInterval(() => store.user && store.sync(), 30000);
}

// ============================================================
// Demo (åbn med ?demo) – testdata som i prototypen, gemmes kun i browseren
// ============================================================

function seedDemo() {
  const now = Date.now();
  const hh = "demo-h";
  const ditte = { user_id: "demo-d", household_id: hh, role: "patient", display_name: "Ditte", settings: {} };
  const peter = { user_id: "demo-p", household_id: hh, role: "supporter", display_name: "Peter", settings: {} };
  const data = {
    me: ditte, household: { id: hh, name: "Hjemme", invite_code: "K7Q2PA", settings: {} }, members: [ditte, peter],
    activities: [], hint_events: [], day_reviews: [], food_entries: [], custom_foods: [], protein_days: [], training_log: [], notes: [], reminders: [],
  };
  let n = 0;
  const id = () => "demo-" + ++n;
  const mk = (type, a, b, e, daysAgo = 0) => ({
    id: id(), household_id: hh, type, origin: "manual", energy: e,
    started_at: iso(now - daysAgo * 864e5 - a * MIN), ended_at: iso(now - daysAgo * 864e5 - b * MIN),
  });
  data.activities.push(mk("spis", 330, 305, 4), mk("transport", 245, 215, 4), mk("fast", 200, 178, 4), mk("mode", 160, 100, 2), mk("pause", 97, 76, 3));
  for (let d = 1; d <= 9; d++) data.activities.push(mk("solo", 600, 600 - (70 + (d % 3) * 10), d % 2 ? 2 : 3, d), mk("mode", 400, 350, 2, d), mk("pause", 340, 320, 4, d));
  data.activities.push({ id: id(), household_id: hh, type: "solo", origin: "manual", started_at: iso(now - 72 * MIN), ended_at: null, energy: null, next_check_at: iso(now + 60 * MIN), next_hint_at: iso(now + 20 * MIN) });
  const plan = {
    12: "Havregryn,Blåbær,Mandler,Kikærter,Spinat,Tomat,Løg,Hvidløg,Gulerod,Æble",
    11: "Rugbrød (fuldkorn),Avocado,Rødløg,Røde linser,Ingefær,Peberfrugt,Banan,Valnødder",
    10: "Broccoli,Quinoa,Edamamebønner,Sesamfrø,Pære,Citron,Persille",
    9: "Kidneybønner,Majs,Squash,Hindbær,Mørk chokolade,Græskarkerner",
    8: "Blomkål,Kartoffel,Porre,Jordbær,Hasselnødder,Sorte bønner",
    7: "Grønkål,Rødbede,Appelsin,Brune ris,Hørfrø,Champignon",
    6: "Kiwi,Cashewnødder,Spidskål,Aubergine,Hvide bønner,Granatæble,Pistacienødder,Fennikel,Basilikum",
    5: "Havregryn,Æble,Mango,Rugbrød (fuldkorn),Tomat,Agurk,Gulerod,Løg",
    4: "Havregryn,Æble,Banan,Tomat,Agurk,Broccoli,Kikærter",
    3: "Havregryn,Æble,Banan,Tomat,Løg,Kartoffel",
    2: "Havregryn,Æble,Banan,Tomat,Agurk",
    1: "Havregryn,Æble,Rugbrød (fuldkorn),Tomat,Gulerod",
    0: "Havregryn,Mandler,Æble",
  };
  for (const [o, s] of Object.entries(plan)) s.split(",").forEach((item, i) => data.food_entries.push({
    household_id: hh, day: dk(+o), item, category: BASE_FOODS[item], created_by: i >= 3 && +o > 0 ? "demo-p" : "demo-d",
  }));
  const pr = { 6: "fish", 5: "poultry", 4: "meat", 3: "fish", 2: "poultry", 1: "poultry" };
  for (const [o, k] of Object.entries(pr)) data.protein_days.push({ household_id: hh, day: dk(+o), fish: 0, meat: 0, poultry: 0, [k]: 1 });
  const missed = { 2: "ro", 5: "bal" };
  for (let o = 1; o <= 8; o++) for (const ex of trainingFor(dk(o), {})) data.training_log.push({ household_id: hh, day: dk(o), exercise: ex, done: missed[o] !== ex });
  const notes = [
    [1, "Bekymret for arbejdsmødet på torsdag. Ved ikke om jeg har energi til en hel dag inde i København. Sov dårligt i nat."],
    [2, "Ikke så meget i dag. God tur i haven, og jeg fik hvilet efter frokost."],
    [4, "Tænker på om trætheden er blevet værre den sidste måned. Skal huske at spørge neurologen til kontrollen."],
    [6, "Mors fødselsdag på lørdag med mange gæster. Hvordan holder jeg pauser uden at det bliver akavet?"],
    [9, "Bekymret for arbejdet og om jeg kan holde til mine timer, når der er så mange møder."],
    [13, "Turen til Aarhus gik faktisk fint. Jeg var mindre træt end jeg havde frygtet."],
    [16, "Bekymret for rejsen til Aarhus. Toget, mange mennesker og en lang dag."],
  ];
  for (const [o, body] of notes) data.notes.push({ user_id: "demo-d", day: dk(o), body, nothing: false });
  store.data = data;
  store.persist();
}

function demoSwitch(role) {
  const m = D().members.find((x) => x.role === role);
  D().me = m;
  store.user = { id: m.user_id, email: "demo" };
  UI.sel = null;
  store.persist();
  toast(`Du ser nu appen som ${m.display_name}`);
  render();
}

function demoAnalysis(days) {
  const ns = D().notes.filter((n) => !n.nothing && offOf(n.day) < days);
  if (!ns.length) return { count: 0 };
  return {
    count: ns.length,
    summary: "Demo-svar. I den rigtige app laver Claude opsummeringen ud fra dine notater.",
    recurring: [{ topic: "Arbejde og energi til arbejdsdage", times: 2, detail: "Især store mødedage." }],
    biggest: ["Om der er energi til en hel arbejdsdag inde i byen."],
    resolved: ns.some((n) => /gik faktisk fint/.test(n.body)) ? ["Rejsen til Aarhus. Du skrev bagefter, at den gik fint."] : [],
  };
}

// ============================================================
// Start
// ============================================================

registerSW();
if (DEMO) {
  if (!store.data.me) seedDemo();
  store.user = { id: store.data.me.user_id, email: "demo" };
  enterApp();
}
