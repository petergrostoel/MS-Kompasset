// Fælles kalender- og påmindelseslogik.
// Bruges både af appen i browseren og af notifikationsserveren (Supabase Edge Function),
// så de altid er enige om helligdage og tidspunkter.

/** Standardindstillinger for hjemmet. Gemmes som households.settings (jsonb). */
export const DEFAULT_SETTINGS = {
  tz: "Europe/Copenhagen",
  trainingPlan: { ro: [1, 3], bal: [2, 4, 6], mus: [1, 5] }, // 0 = søndag … 6 = lørdag
  trainTime: "17:00",
  dayTime: "20:30",
  worryTime: "21:00",
  fixedWeek: ["12:30", "17:00"],
  fixedWeekend: ["14:00"],
  hints: true,
};

/** Standardindstillinger pr. bruger (members.settings). */
export const DEFAULT_MEMBER_SETTINGS = {
  foodReminder: true,
  foodTime: "19:00",
};

export const EXERCISES = { ro: "Romaskine", bal: "Balanceøvelser", mus: "Muskeltræning" };

export function withDefaults(settings) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  s.trainingPlan = { ...DEFAULT_SETTINGS.trainingPlan, ...((settings && settings.trainingPlan) || {}) };
  return s;
}

export function withMemberDefaults(settings) {
  return { ...DEFAULT_MEMBER_SETTINGS, ...(settings || {}) };
}

// ------------------------------------------------------------
// Datoer som "YYYY-MM-DD" (lokal dato, uden klokkeslæt)
// ------------------------------------------------------------

export function keyOf(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function partsOf(key) {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

/** Ugedag for en datonøgle (0 = søndag). */
export function weekday(key) {
  const { y, m, d } = partsOf(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(key, n) {
  const { y, m, d } = partsOf(key);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return keyOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Antal dage fra a til b (b − a). */
export function daysBetween(a, b) {
  const pa = partsOf(a), pb = partsOf(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 864e5);
}

// ------------------------------------------------------------
// Danske helligdage
// ------------------------------------------------------------

function easterSunday(y) {
  // Gauss/Meeus' algoritme (gregoriansk kalender)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return keyOf(y, month, day);
}

const FIXED_HOLIDAYS = {
  "01-01": "Nytårsdag",
  "06-05": "Grundlovsdag",
  "12-24": "Juleaften",
  "12-25": "Juledag",
  "12-26": "2. juledag",
  "12-31": "Nytårsaften",
};

const EASTER_OFFSETS = {
  "-3": "Skærtorsdag",
  "-2": "Langfredag",
  "0": "Påskedag",
  "1": "2. påskedag",
  "39": "Kristi himmelfartsdag",
  "49": "Pinsedag",
  "50": "2. pinsedag",
};

/**
 * Navnet på helligdagen, eller null.
 * Juleaften, nytårsaften og grundlovsdag er ikke officielle helligdage,
 * men Peter har bestemt, at de skal tælle som weekend i appen.
 */
export function holidayName(key) {
  const fixed = FIXED_HOLIDAYS[key.slice(5)];
  if (fixed) return fixed;
  const off = daysBetween(easterSunday(partsOf(key).y), key);
  return EASTER_OFFSETS[String(off)] || null;
}

/** Weekend eller helligdag. */
export function isRestDay(key) {
  const wd = weekday(key);
  return wd === 0 || wd === 6 || !!holidayName(key);
}

// ------------------------------------------------------------
// Tidszoner
// ------------------------------------------------------------

/** Lokal dato og klokkeslæt i en tidszone. */
export function localParts(date, tz) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** UTC-tidspunkt for en lokal dato + "HH:MM" i en tidszone (håndterer sommertid). */
export function zonedTime(dayKey, hhmm, tz) {
  const { y, m, d } = partsOf(dayKey);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Find tidszonens forskydning ved det gættede tidspunkt og ret to gange (sommertidsskift).
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const lp = localParts(new Date(t), tz);
    const lpP = partsOf(lp.day);
    const [lh, lm] = lp.time.split(":").map(Number);
    const asUtc = Date.UTC(lpP.y, lpP.m - 1, lpP.d, lh, lm);
    t += guess - asUtc;
  }
  return new Date(t);
}

// ------------------------------------------------------------
// Påmindelser
// ------------------------------------------------------------

/** Faste pauser for en given dag (sorteret). */
export function fixedPausesFor(dayKey, settings) {
  const s = withDefaults(settings);
  return [...(isRestDay(dayKey) ? s.fixedWeekend : s.fixedWeek)].sort();
}

/** Træningsøvelser planlagt på en given dag. */
export function trainingFor(dayKey, settings) {
  const s = withDefaults(settings);
  const wd = weekday(dayKey);
  return Object.keys(EXERCISES).filter((k) => (s.trainingPlan[k] || []).includes(wd));
}

/**
 * Hvilke påmindelser en bruger skal have på en dag, med lokalt klokkeslæt.
 * patient (Ditte): faste pauser, træning (kun træningsdage, samlet i én), dagsevaluering, bekymringer.
 * supporter (Peter): kun påmindelse om at registrere aftensmaden.
 */
export function remindersFor(dayKey, role, settings, memberSettings) {
  const s = withDefaults(settings);
  const out = [];
  if (role === "patient") {
    for (const t of fixedPausesFor(dayKey, s)) out.push({ kind: `fixed:${t}`, time: t, repeat: 15 });
    if (trainingFor(dayKey, s).length && s.trainTime) out.push({ kind: "training", time: s.trainTime });
    if (s.dayTime) out.push({ kind: "day_review", time: s.dayTime });
    if (s.worryTime) out.push({ kind: "worry", time: s.worryTime });
  } else {
    const ms = withMemberDefaults(memberSettings);
    if (ms.foodReminder && ms.foodTime) out.push({ kind: "food", time: ms.foodTime });
  }
  return out.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

export const tdot = (t) => t.replace(":", ".");
