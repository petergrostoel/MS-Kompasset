import test from "node:test";
import assert from "node:assert/strict";
import { planNotifications } from "../supabase/functions/_shared/plan.js";

const H = { id: "h1", settings: {} };
const D = { user_id: "d", household_id: "h1", role: "patient", settings: {} };
const P = { user_id: "p", household_id: "h1", role: "supporter", settings: {} };
const base = (now, extra = {}) => ({
  now: new Date(now), households: [H], members: [D, P], reminders: [], activeActivities: [], done: {}, ...extra,
});

test("fast pause sendes på tidspunktet og gentages hvert kvarter, til den er startet", () => {
  // Torsdag 12. nov. 2026 kl. 12.31 dansk tid = 11.31 UTC
  const r1 = planNotifications(base("2026-11-12T11:31:00Z"));
  assert.equal(r1.sends.length, 1);
  assert.equal(r1.sends[0].user_id, "d");
  assert.equal(r1.sends[0].payload.title, "Tid til fast pause");
  const up = r1.reminderUpserts[0];
  assert.equal(up.kind, "fixed:12:30");
  assert.equal(up.next_at, "2026-11-12T11:46:00.000Z");

  // 15 min senere uden svar → påmindelse
  const r2 = planNotifications(base("2026-11-12T11:46:00Z", { reminders: [{ ...up }] }));
  assert.equal(r2.sends[0].payload.title, "Påmindelse: fast pause");
  // Startet (status done) → intet
  const r3 = planNotifications(base("2026-11-12T12:01:00Z", { reminders: [{ ...up, status: "done" }] }));
  assert.equal(r3.sends.length, 0);
});

test("juleaften bruger weekend-tidspunktet 14.00", () => {
  const r = planNotifications(base("2026-12-24T11:31:00Z")); // 12.31 lokal tid
  assert.equal(r.sends.length, 0);
  const r2 = planNotifications(base("2026-12-24T13:00:00Z")); // 14.00
  assert.equal(r2.reminderUpserts[0].kind, "fixed:14:00");
});

test("over 3 timer for sent oprettes ikke (fx hvis serveren har været nede)", () => {
  const r = planNotifications(base("2026-11-12T15:00:00Z")); // 16.00 lokal: 12.30 er 3,5 t gammel
  assert.ok(!r.reminderUpserts.some((u) => u.kind === "fixed:12:30"));
});

test("træning: kun på træningsdage, kun til Ditte, sprunget over hvis allerede besvaret", () => {
  // Mandag 16. nov. kl. 17.00 lokal = 16.00 UTC (romaskine + muskeltræning)
  const r = planNotifications(base("2026-11-16T16:00:00Z", { reminders: [{ user_id: "d", kind: "fixed:17:00", day: "2026-11-16", status: "done" }, { user_id: "d", kind: "fixed:12:30", day: "2026-11-16", status: "done" }] }));
  const tr = r.sends.find((s) => s.payload.kind === "training");
  assert.equal(tr.user_id, "d");
  assert.equal(tr.payload.body, "I dag står der: romaskine og muskeltræning.");
  assert.ok(!r.sends.some((s) => s.user_id === "p"));
  const r2 = planNotifications(base("2026-11-16T16:00:00Z", { done: { training: new Set(["h1|2026-11-16"]) } }));
  assert.ok(!r2.sends.some((s) => s.payload.kind === "training"));
});

test("Peter får påmindelse om aftensmad kl. 19", () => {
  const r = planNotifications(base("2026-11-12T18:00:00Z", { members: [P] }));
  assert.equal(r.sends.length, 1);
  assert.equal(r.sends[0].payload.kind, "food");
});

test("udskudt dagsevaluering sendes igen, når next_at er nået", () => {
  const rem = { user_id: "d", kind: "day_review", day: "2026-11-12", status: "open", next_at: "2026-11-12T20:30:00Z", sent_count: 1 };
  const r = planNotifications(base("2026-11-12T20:31:00Z", { members: [D], reminders: [rem] }));
  assert.ok(r.sends.some((s) => s.payload.kind === "day_review"));
  const r2 = planNotifications(base("2026-11-12T20:00:00Z", { members: [D], reminders: [rem] }));
  assert.ok(!r2.sends.some((s) => s.payload.kind === "day_review"));
});

test("aktivitet: glemt at stoppe, hjernepause slut og forslag om hjernepause", () => {
  const now = "2026-11-12T13:00:00Z"; // 14.00 lokal
  const rems = ["fixed:12:30"].map((kind) => ({ user_id: "d", kind, day: "2026-11-12", status: "done" }));
  const solo = { id: "a1", household_id: "h1", type: "solo", started_at: "2026-11-12T11:55:00Z", next_check_at: "2026-11-12T12:55:00Z", next_hint_at: null };
  const r = planNotifications(base(now, { reminders: rems, activeActivities: [solo] }));
  assert.equal(r.sends.length, 1);
  assert.equal(r.sends[0].payload.title, "Er du stadig i gang?");
  assert.equal(r.sends[0].payload.body, "Arbejde alene har kørt i 1 t 5 min.");
  assert.equal(r.activityUpdates[0].next_check_at, "2026-11-12T14:00:00.000Z");

  const brain = { id: "a2", household_id: "h1", type: "pause", started_at: "2026-11-12T12:45:00Z", next_check_at: "2026-11-12T13:00:00Z" };
  const r2 = planNotifications(base(now, { reminders: rems, activeActivities: [brain] }));
  assert.equal(r2.sends[0].payload.title, "Er du færdig med din hjernepause?");

  const hint = { ...solo, next_check_at: "2026-11-12T14:00:00Z", next_hint_at: "2026-11-12T12:59:00Z" };
  const r3 = planNotifications(base(now, { reminders: rems, activeActivities: [hint] }));
  assert.equal(r3.sends[0].payload.kind, "hint");
  assert.equal(r3.hintInserts.length, 1);
  assert.equal(r3.activityUpdates[0].next_hint_at, "2026-11-12T13:15:00.000Z");

  // Forslag slået fra
  const r4 = planNotifications(base(now, { reminders: rems, activeActivities: [hint], households: [{ id: "h1", settings: { hints: false } }] }));
  assert.equal(r4.sends.length, 0);
});

test("ingen aktivitetsspørgsmål om natten", () => {
  const solo = { id: "a1", household_id: "h1", type: "solo", started_at: "2026-11-12T20:00:00Z", next_check_at: "2026-11-12T23:00:00Z" };
  const r = planNotifications(base("2026-11-12T23:30:00Z", { members: [D], activeActivities: [solo], reminders: ["fixed:12:30", "fixed:17:00", "day_review", "worry"].map((kind) => ({ user_id: "d", kind, day: "2026-11-13", status: "done" })) }));
  assert.ok(!r.sends.some((s) => s.payload.kind === "check"));
});
