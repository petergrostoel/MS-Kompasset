// Kør: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import {
  holidayName, isRestDay, fixedPausesFor, remindersFor, zonedTime, localParts, addDays, weekday,
} from "../supabase/functions/_shared/calendar.js";
import { foodStats, trainStats, predictMinutes, energyGuess, insights } from "../js/logic.js";

test("danske helligdage 2026 og Peters ekstra fridage", () => {
  assert.equal(holidayName("2026-04-02"), "Skærtorsdag");
  assert.equal(holidayName("2026-04-03"), "Langfredag");
  assert.equal(holidayName("2026-04-05"), "Påskedag");
  assert.equal(holidayName("2026-04-06"), "2. påskedag");
  assert.equal(holidayName("2026-05-14"), "Kristi himmelfartsdag");
  assert.equal(holidayName("2026-05-25"), "2. pinsedag");
  assert.equal(holidayName("2027-03-28"), "Påskedag");
  assert.equal(holidayName("2026-06-05"), "Grundlovsdag");
  assert.equal(holidayName("2026-12-24"), "Juleaften");
  assert.equal(holidayName("2026-12-31"), "Nytårsaften");
  assert.equal(holidayName("2026-11-12"), null);
  assert.equal(isRestDay("2026-12-24"), true); // torsdag, men juleaften
  assert.equal(isRestDay("2026-06-05"), true); // fredag, grundlovsdag
  assert.equal(isRestDay("2026-11-12"), false); // torsdag
  assert.equal(isRestDay("2026-11-14"), true); // lørdag
});

test("faste pauser: hverdag vs. weekend/helligdag", () => {
  assert.deepEqual(fixedPausesFor("2026-11-12", {}), ["12:30", "17:00"]);
  assert.deepEqual(fixedPausesFor("2026-11-15", {}), ["14:00"]);
  assert.deepEqual(fixedPausesFor("2026-12-24", {}), ["14:00"]);
});

test("påmindelser pr. rolle; træning kun på træningsdage og samlet", () => {
  // 2026-11-16 er mandag: romaskine + muskeltræning
  const r = remindersFor("2026-11-16", "patient", {});
  assert.deepEqual(r.map((x) => x.kind), ["fixed:12:30", "fixed:17:00", "training", "day_review", "worry"]);
  // 2026-11-15 søndag: ingen træning
  assert.ok(!remindersFor("2026-11-15", "patient", {}).some((x) => x.kind === "training"));
  // Peter: kun mad, ingen træning
  assert.deepEqual(remindersFor("2026-11-16", "supporter", {}, {}).map((x) => x.kind), ["food"]);
  assert.deepEqual(remindersFor("2026-11-16", "supporter", {}, { foodReminder: false }), []);
});

test("tidszone inkl. sommertid", () => {
  assert.equal(zonedTime("2026-11-12", "12:30", "Europe/Copenhagen").toISOString(), "2026-11-12T11:30:00.000Z");
  assert.equal(zonedTime("2026-07-01", "12:30", "Europe/Copenhagen").toISOString(), "2026-07-01T10:30:00.000Z");
  assert.deepEqual(localParts(new Date("2026-11-12T23:30:00Z"), "Europe/Copenhagen"), { day: "2026-11-13", time: "00:30" });
});

test("kost: en råvare tæller én gang pr. 7 dage, falder ud, trend og protein", () => {
  const today = "2026-11-12";
  const e = (o, item, category) => ({ day: addDays(today, -o), item, category });
  const entries = [
    e(0, "Tomat", "veg"), e(1, "Tomat", "veg"), e(2, "Tomat", "veg"),
    e(6, "Kikærter", "leg"), e(6, "Mandler", "nut"), e(3, "Mandler", "nut"),
    e(7, "Æble", "fruit"), // uden for perioden
  ];
  const s = foodStats(entries, [{ day: today, fish: 1, meat: 0, poultry: 2 }, { day: addDays(today, -8), fish: 5 }], today);
  assert.equal(s.total, 3);
  assert.deepEqual(s.by, { veg: 1, fruit: 0, leg: 1, nut: 1, grain: 0 });
  assert.deepEqual(s.drop, ["Kikærter"]);
  assert.equal(s.dropByCat.leg, 1);
  assert.deepEqual(s.prot, { fish: 1, meat: 0, poultry: 2 });
  assert.equal(s.st, "bad");
  assert.equal(s.trend.length, 7);
  assert.equal(s.trend[6].v, 3);
});

test("kost: grøn kræver 30, gul hvis nogle falder ud under 30", () => {
  const today = "2026-11-12";
  const entries = [];
  for (let i = 0; i < 31; i++) entries.push({ day: addDays(today, i < 5 ? -6 : -1), item: "R" + i, category: "veg" });
  assert.equal(foodStats(entries, [], today).st, "warn"); // 31 nu, men 5 falder ud → 26
  const steady = entries.map((x) => ({ ...x, day: today }));
  assert.equal(foodStats(steady, [], today).st, "ok");
});

test("træning: procent og at dagens først tæller når besvaret", () => {
  const today = "2026-11-12"; // torsdag
  const plan = { trainingPlan: { ro: [1, 3], bal: [2, 4, 6], mus: [1, 5] } };
  const log = [];
  for (let o = 1; o <= 6; o++) {
    const d = addDays(today, -o), wd = weekday(d);
    for (const [ex, days] of Object.entries(plan.trainingPlan)) if (days.includes(wd)) log.push({ day: d, exercise: ex, done: true });
  }
  log[0].done = false;
  const t = trainStats(plan, log, today);
  assert.equal(t.planned, log.length);
  assert.equal(t.done, log.length - 1);
  assert.equal(t.grid.bal[6].state, "pend"); // i dag torsdag: balance afventer
  const t2 = trainStats(plan, [...log, { day: today, exercise: "bal", done: true }], today);
  assert.equal(t2.planned, log.length + 1);
  assert.equal(t2.grid.bal[6].state, "done");
  assert.equal(t.st, t.pct > 80 ? "ok" : t.pct > 50 ? "warn" : "bad");
});

test("energi-læring: bruger historik og justerer efter for sene forslag", () => {
  const now = Date.parse("2026-11-12T14:00:00Z");
  const mk = (daysAgo, minutes, energy) => {
    const s = now - daysAgo * 864e5;
    return { type: "solo", started_at: new Date(s).toISOString(), ended_at: new Date(s + minutes * 60000).toISOString(), energy };
  };
  // Standard uden data
  assert.equal(predictMinutes("solo", [], [], 4, now), 90);
  assert.equal(predictMinutes("spis", [], [], 4, now), null);
  const acts = [mk(1, 70, 2), mk(2, 80, 1), mk(3, 60, 2), mk(4, 30, 4)];
  assert.equal(predictMinutes("solo", acts, [], 4, now), 60); // median 70 − 10
  const late = [{ activity_type: "solo", answer: "yes", energy_after: 1 }, { activity_type: "solo", answer: "yes", energy_after: 1 }];
  assert.equal(predictMinutes("solo", acts, late, 4, now), 48);
  assert.equal(predictMinutes("solo", acts, [], 2, now), 42); // træt ved start → tidligere
  const g = energyGuess({ type: "solo", started_at: new Date(now - 55 * 60000).toISOString() }, acts, [], "2026-11-12", now);
  assert.match(g.s, /hjernepause/);
  const ins = insights(acts, [], now);
  assert.equal(ins.enough, true);
  assert.equal(ins.types[0].type, "solo");
});
