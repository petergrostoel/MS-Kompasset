// Beslutter hvilke notifikationer der skal sendes lige nu.
// Ren funktion uden database og netværk, så den kan testes. Bruges af Edge Function "notify",
// som kaldes hvert minut.

import { ACT } from "./catalog.js";
import {
  localParts, zonedTime, remindersFor, trainingFor, withDefaults, EXERCISES, tdot,
} from "./calendar.js";

const MIN = 60000;
const LATE_LIMIT = 3 * 60 * MIN; // en påmindelse der er over 3 timer for sent, oprettes ikke
const QUIET_FROM = "23:00"; // ingen "er du stadig i gang?" om natten
const QUIET_TO = "07:00";

export function dur(ms) {
  const m = Math.max(1, Math.round(ms / MIN));
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} t${r ? " " + r + " min" : ""}` : `${r} min`;
}

function listText(arr) {
  return arr.length <= 1 ? arr.join("") : arr.slice(0, -1).join(", ") + " og " + arr[arr.length - 1];
}

/** Tekst til påmindelser. */
export function reminderMessage(kind, ctx = {}) {
  if (kind.startsWith("fixed:")) {
    const t = tdot(kind.slice(6));
    return ctx.repeat
      ? { title: "Påmindelse: fast pause", body: `Din faste pause kl. ${t} venter stadig.` }
      : { title: "Tid til fast pause", body: `Kl. ${t} er det tid til din faste pause.` };
  }
  switch (kind) {
    case "training": {
      const ex = (ctx.exercises || []).map((k) => EXERCISES[k].toLowerCase());
      return { title: "Har du trænet i dag?", body: ex.length ? `I dag står der: ${listText(ex)}.` : "Tryk for at svare." };
    }
    case "day_review":
      return { title: "Hvordan er dagen gået?", body: "Tag et minut og gennemgå dagen." };
    case "worry":
      return { title: "Dagens bekymringer", body: "Er der noget, der fylder i dag?" };
    case "food":
      return { title: "Hvad blev der spist i aften?", body: "Registrér grøntsagerne fra aftensmaden." };
  }
  return { title: "MS Kompasset", body: "" };
}

/**
 * input:
 *   now: Date
 *   households: [{ id, settings }]
 *   members: [{ user_id, household_id, role, settings }]
 *   reminders: [{ user_id, kind, day, status, next_at, sent_count }]   (kun for de relevante dage)
 *   activeActivities: [{ id, household_id, type, started_at, next_check_at, next_hint_at }]
 *   done: { training: Set("household|day"), day_review: Set("household|day"), worry: Set("user|day") }
 * output: { sends, reminderUpserts, activityUpdates, hintInserts }
 */
export function planNotifications(input) {
  const now = input.now.getTime();
  const nowIso = new Date(now).toISOString();
  const out = { sends: [], reminderUpserts: [], activityUpdates: [], hintInserts: [] };
  const remKey = (u, k, d) => `${u}|${k}|${d}`;
  const rems = new Map(input.reminders.map((r) => [remKey(r.user_id, r.kind, r.day), r]));
  const done = input.done || {};

  for (const h of input.households) {
    const s = withDefaults(h.settings);
    const local = localParts(input.now, s.tz);
    const today = local.day;
    const members = input.members.filter((m) => m.household_id === h.id);

    // ---------- Påmindelser på faste tidspunkter ----------
    for (const m of members) {
      for (const r of remindersFor(today, m.role, s, m.settings)) {
        if (r.time > local.time) continue;
        const row = rems.get(remKey(m.user_id, r.kind, today));
        let send = false, repeat = false;
        if (!row) {
          const at = zonedTime(today, r.time, s.tz).getTime();
          if (now - at > LATE_LIMIT) continue;
          if (r.kind === "training" && done.training?.has(`${h.id}|${today}`)) continue;
          if (r.kind === "day_review" && done.day_review?.has(`${h.id}|${today}`)) continue;
          if (r.kind === "worry" && done.worry?.has(`${m.user_id}|${today}`)) continue;
          send = true;
        } else if (row.status === "open" && row.next_at && Date.parse(row.next_at) <= now) {
          send = true;
          repeat = row.sent_count > 0;
        }
        if (!send) continue;
        const msg = reminderMessage(r.kind, { repeat, exercises: trainingFor(today, s) });
        out.sends.push({
          user_id: m.user_id,
          payload: { ...msg, kind: r.kind, day: today, tag: `${r.kind}-${today}`, url: `./?n=${encodeURIComponent(r.kind)}&d=${today}` },
        });
        out.reminderUpserts.push({
          user_id: m.user_id, kind: r.kind, day: today, status: "open",
          next_at: r.repeat ? new Date(now + r.repeat * MIN).toISOString() : null,
          sent_count: (row?.sent_count || 0) + 1,
        });
      }
    }

    // ---------- Aktivitet i gang: glemt at stoppe, hjernepause slut, forslag om hjernepause ----------
    const quiet = local.time >= QUIET_FROM || local.time < QUIET_TO;
    const patients = members.filter((m) => m.role === "patient");
    for (const a of input.activeActivities.filter((x) => x.household_id === h.id)) {
      const def = ACT[a.type] || { l: a.type, k: "drain" };
      const elapsed = now - Date.parse(a.started_at);
      const upd = { id: a.id };
      let sent = false;

      if (a.next_check_at && Date.parse(a.next_check_at) <= now) {
        if (def.check) {
          upd.next_check_at = new Date(now + def.check * MIN).toISOString();
          if (!quiet) {
            for (const p of patients) out.sends.push({ user_id: p.user_id, payload: {
              title: "Er du færdig med din hjernepause?", body: `Der er gået ${dur(elapsed)}.`,
              kind: "brain", tag: `brain-${a.id}`, url: `./?n=brain&a=${a.id}`,
            } });
            sent = true;
          }
        } else {
          upd.next_check_at = new Date(now + 60 * MIN).toISOString();
          if (!quiet) {
            for (const p of patients) out.sends.push({ user_id: p.user_id, payload: {
              title: "Er du stadig i gang?", body: `${def.l} har kørt i ${dur(elapsed)}.`,
              kind: "check", tag: `check-${a.id}`, url: `./?n=check&a=${a.id}`,
            } });
            sent = true;
          }
        }
      }

      if (s.hints && def.k === "drain" && a.next_hint_at && Date.parse(a.next_hint_at) <= now) {
        upd.next_hint_at = new Date(now + 15 * MIN).toISOString();
        if (!quiet && !sent) {
          for (const p of patients) out.sends.push({ user_id: p.user_id, payload: {
            title: "Tid til en hjernepause?", body: "Jeg tror det er tid til en hjernepause. Er du enig?",
            kind: "hint", tag: `hint-${a.id}`, url: `./?n=hint&a=${a.id}`,
          } });
          out.hintInserts.push({
            household_id: h.id, activity_id: a.id, activity_type: a.type, asked_at: nowIso,
            minutes_in: Math.round(elapsed / MIN),
          });
        }
      }
      if (Object.keys(upd).length > 1) out.activityUpdates.push(upd);
    }
  }
  return out;
}
