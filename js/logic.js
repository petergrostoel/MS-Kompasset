// Beregninger uden sideeffekter: status for kost, træning og energi, og det appen lærer.
// Alle funktioner tager data ind som argumenter, så de kan testes (se tests/).

import { ACT, LV } from "../supabase/functions/_shared/catalog.js";
import { addDays, daysBetween, weekday, withDefaults, EXERCISES } from "../supabase/functions/_shared/calendar.js";

const MIN = 60000;
export const GOAL = 30;

// ------------------------------------------------------------
// Kost: unikke råvarer i en rullende 7-dages periode
// ------------------------------------------------------------

/** Unikke råvarer i perioden [end-6, end]. Returnerer Map navn → kategori. */
export function foodWindow(entries, endKey) {
  const from = addDays(endKey, -6);
  const seen = new Map();
  for (const e of entries) if (e.day >= from && e.day <= endKey) seen.set(e.item, e.category);
  return seen;
}

export function foodStats(entries, proteinDays, today) {
  const w = foodWindow(entries, today);
  const by = { veg: 0, fruit: 0, leg: 0, nut: 0, grain: 0 };
  for (const c of w.values()) if (c in by) by[c]++;

  // Råvarer der kun er spist på den ældste dag i perioden, falder ud i morgen.
  const oldest = addDays(today, -6);
  const last = new Map();
  for (const e of entries) {
    if (e.day < oldest || e.day > today) continue;
    if (!last.has(e.item) || e.day > last.get(e.item)) last.set(e.item, e.day);
  }
  const drop = [...last].filter(([, d]) => d === oldest).map(([n]) => n).sort((a, b) => a.localeCompare(b, "da"));

  const trend = [];
  for (let o = 6; o >= 0; o--) {
    const k = addDays(today, -o);
    trend.push({ day: k, v: foodWindow(entries, k).size });
  }

  const prot = { fish: 0, meat: 0, poultry: 0 };
  for (const p of proteinDays) {
    if (p.day < oldest || p.day > today) continue;
    for (const k in prot) prot[k] += p[k] || 0;
  }

  const total = w.size;
  let st = total >= GOAL ? "ok" : total >= 20 ? "warn" : "bad";
  if (st === "ok" && total - drop.length < GOAL) st = "warn";
  const dropByCat = { leg: 0, nut: 0 };
  for (const n of drop) {
    const c = w.get(n);
    if (c in dropByCat) dropByCat[c]++;
  }
  const falling = trend[6].v < trend[0].v - 3;
  return { total, by, drop, dropByCat, trend, prot, st, falling, window: w };
}

// ------------------------------------------------------------
// Træning: hvor mange gange planen er overholdt de sidste 7 dage
// ------------------------------------------------------------

export function trainStats(settings, log, today) {
  const s = withDefaults(settings);
  const byKey = new Map(log.map((l) => [l.day + "|" + l.exercise, l.done]));
  let planned = 0, done = 0;
  const grid = {};
  for (const ex of Object.keys(EXERCISES)) grid[ex] = [];
  for (let o = 6; o >= 0; o--) {
    const day = addDays(today, -o);
    const wd = weekday(day);
    for (const ex of Object.keys(EXERCISES)) {
      const isPlanned = (s.trainingPlan[ex] || []).includes(wd);
      const k = day + "|" + ex;
      const answered = byKey.has(k);
      let state = "none";
      if (isPlanned) {
        if (byKey.get(k) === true) state = "done";
        else if (o === 0 && !answered) state = "pend";
        else state = "miss";
      }
      grid[ex].push({ day, state });
      if (!isPlanned) continue;
      if (o === 0 && !answered) continue; // i dag tæller først, når den er besvaret
      planned++;
      if (byKey.get(k) === true) done++;
    }
  }
  const pct = planned ? Math.round((done / planned) * 100) : 100;
  return { planned, done, pct, st: pct > 80 ? "ok" : pct > 50 ? "warn" : "bad", grid };
}

// ------------------------------------------------------------
// Energi: lær hvornår Ditte bliver træt
// ------------------------------------------------------------

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const durMin = (a) => (Date.parse(a.ended_at) - Date.parse(a.started_at)) / MIN;

/** Afsluttede aktiviteter af en type med energi, de sidste 60 dage. */
function samples(type, acts, now) {
  const since = now - 60 * 864e5;
  return acts.filter((a) => a.type === type && a.ended_at && a.energy && Date.parse(a.started_at) >= since && durMin(a) >= 5);
}

/**
 * Hvor mange minutter med denne aktivitet, før det er tid til en hjernepause.
 * Bygger på hvornår hun tidligere er blevet træt (energi 1–2) af samme aktivitet,
 * justeret efter om tidligere forslag kom for sent eller for tidligt,
 * og efter hvor meget energi hun havde, da hun startede.
 */
export function predictMinutes(type, acts, hints, lastEnergy, now = Date.now()) {
  const a = ACT[type];
  if (!a || a.k !== "drain") return null;
  const tired = samples(type, acts, now).filter((x) => x.energy <= 2).map(durMin);
  let est = tired.length >= 2 ? Math.max(15, median(tired) - 10) : a.def;

  let factor = 1;
  const recent = hints.filter((h) => h.activity_type === type && h.answer).slice(-10);
  for (const h of recent) {
    if (h.answer === "yes" && h.energy_after === 1) factor -= 0.1; // for sent
    else if (h.answer === "no") factor += 0.05; // for tidligt
  }
  factor = Math.min(1.4, Math.max(0.6, factor));
  const startF = { 1: 0.5, 2: 0.7, 3: 0.85, 4: 1, 5: 1.15 }[lastEnergy] ?? 1;
  return Math.max(10, Math.round(est * factor * startF));
}

/** Seneste registrerede energi (fra stop af en aktivitet), eller null. */
export function lastEnergy(acts) {
  let best = null;
  for (const a of acts) if (a.ended_at && a.energy && (!best || a.ended_at > best.ended_at)) best = a;
  return best;
}

export function dur(ms) {
  const m = Math.max(1, Math.round(ms / MIN));
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} t${r ? " " + r + " min" : ""}` : `${r} min`;
}

export const hm = (t) => {
  const d = new Date(t);
  return String(d.getHours()).padStart(2, "0") + "." + String(d.getMinutes()).padStart(2, "0");
};

/** Appens gæt på energien lige nu, som tekst. */
export function energyGuess(active, acts, hints, todayKey, now = Date.now()) {
  const last = lastEnergy(acts);
  const lastToday = last && last.ended_at && dayKeyLocal(new Date(last.ended_at)) === todayKey ? last : null;
  const base = lastToday ? lastToday.energy : last ? Math.min(4, last.energy + 1) : 4;
  if (active) {
    const a = ACT[active.type] || { l: active.type, k: "drain" };
    const el = now - Date.parse(active.started_at);
    if (a.k === "gain") {
      return { t: "Lader op", s: `${a.l} i ${dur(el)}.${lastToday ? ` Seneste vurdering: ${LV[base].toLowerCase()}.` : ""}`, level: base };
    }
    const pred = predictMinutes(active.type, acts, hints, base, now);
    const m = el / MIN;
    const est = Math.min(5, Math.max(1, Math.round(base - (m / pred) * Math.max(1, base - 2))));
    const txt = { 5: "Fuld af energi", 4: "Godt med energi", 3: "Middel energi", 2: "Ved at blive træt", 1: "Meget træt" }[est];
    const left = Math.round(pred - m);
    const tip = left <= 10 ? "Jeg tror en hjernepause snart er en god idé." : `Pause anbefales om ca. ${left} min.`;
    return { t: txt, s: `${a.l} i ${dur(el)}. ${tip}`, level: est };
  }
  if (!lastToday) return { t: last ? LV[base] : "Ingen data endnu", s: "Ingen registreringer endnu i dag.", level: base };
  return { t: LV[base], s: `Seneste vurdering kl. ${hm(lastToday.ended_at)} efter ${(ACT[lastToday.type]?.l || "").toLowerCase()}.`, level: base };
}

export function dayKeyLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Det appen har lært. Returnerer null, hvis der er for lidt data. */
export function insights(acts, hints, now = Date.now()) {
  const done = acts.filter((a) => a.ended_at && a.energy);
  const days = new Set(done.map((a) => dayKeyLocal(new Date(a.started_at)))).size;
  if (days < 3) return { days, enough: false };

  const types = [];
  for (const type of Object.keys(ACT)) {
    if (ACT[type].k !== "drain") continue;
    const tired = samples(type, acts, now).filter((x) => x.energy <= 2).map(durMin);
    if (tired.length >= 2) types.push({ type, l: ACT[type].l, min: Math.round(median(tired)), n: tired.length });
  }
  types.sort((a, b) => b.n - a.n);

  // Mest sårbare tidsrum: gennemsnitlig energi pr. 2-timers vindue (kl. 8–22)
  const buckets = {};
  for (const a of done) {
    const h = new Date(a.ended_at).getHours();
    if (h < 8 || h >= 22) continue;
    const b = h - (h % 2);
    (buckets[b] ||= []).push(a.energy);
  }
  let low = null;
  for (const [b, arr] of Object.entries(buckets)) {
    if (arr.length < 3) continue;
    const avg = arr.reduce((x, y) => x + y, 0) / arr.length;
    if (!low || avg < low.avg) low = { from: +b, to: +b + 2, avg };
  }

  // Forslag om hjernepause de sidste 7 dage
  const since = now - 7 * 864e5;
  const recent = hints.filter((h) => h.answer && Date.parse(h.asked_at) >= since);
  const hit = recent.filter((h) => h.answer === "yes" && h.energy_after >= 2 && h.energy_after <= 3).length;
  const late = recent.filter((h) => h.answer === "yes" && h.energy_after === 1).length;
  return { days, enough: true, types: types.slice(0, 2), low, hints: { n: recent.length, hit, late } };
}

/** Vælg dag og klokkeslæt i dag: om et tidspunkt "HH:MM" er passeret. */
export function nowHHMM(d = new Date()) {
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

export { daysBetween };
