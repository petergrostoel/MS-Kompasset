// MS Kompasset – notifikationsserver (Supabase Edge Function).
//
// Kaldes hvert minut af databasens cron-job (se supabase/migrations/*_cron.sql).
// Finder de påmindelser der skal sendes nu, og sender dem som Web Push til
// iPhone (og videre til Apple Watch).
//
// Hemmeligheder (Supabase → Edge Functions → Secrets):
//   CRON_SECRET        – samme tilfældige tekst som i cron-jobbet
//   VAPID_PUBLIC_KEY   – offentlig nøgle (står også i config.js)
//   VAPID_PRIVATE_KEY  – privat nøgle (kun her!)
//   VAPID_SUBJECT      – fx mailto:din@mail.dk
// SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY sætter Supabase selv.

import { planNotifications } from "../_shared/plan.js";
import { trainingFor, withDefaults, localParts, addDays } from "../_shared/calendar.js";
import { sendPush } from "../_shared/webpush.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const VAPID = {
  publicKey: Deno.env.get("VAPID_PUBLIC_KEY") ?? "",
  privateKey: Deno.env.get("VAPID_PRIVATE_KEY") ?? "",
  subject: Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
};

type Row = Record<string, any>;

async function rest(path: string, init: RequestInit = {}, prefer = ""): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const get = (path: string) => rest(path);
const upsert = (table: string, rows: Row[], onConflict: string) =>
  rows.length
    ? rest(`${table}?on_conflict=${onConflict}`, { method: "POST", body: JSON.stringify(rows) }, "resolution=merge-duplicates,return=minimal")
    : null;

async function run(now: Date) {
  const utcToday = now.toISOString().slice(0, 10);
  const from = addDays(utcToday, -1);

  const [households, members, subs, reminders, active, trainingLog, reviews, notes] = await Promise.all([
    get("households?select=id,settings"),
    get("members?select=user_id,household_id,role,settings"),
    get("push_subscriptions?select=endpoint,user_id,p256dh,auth"),
    get(`reminders?select=user_id,kind,day,status,next_at,sent_count&day=gte.${from}`),
    get("activities?select=id,household_id,type,started_at,next_check_at,next_hint_at&ended_at=is.null"),
    get(`training_log?select=household_id,day,exercise&day=gte.${from}`),
    get(`day_reviews?select=household_id,day,mood&day=gte.${from}`),
    get(`notes?select=user_id,day&day=gte.${from}`),
  ]);

  // Hvad er allerede gjort i dag (så påmindelsen ikke er nødvendig)?
  const done = { training: new Set<string>(), day_review: new Set<string>(), worry: new Set<string>() };
  for (const h of households as Row[]) {
    const s = withDefaults(h.settings);
    const today = localParts(now, s.tz).day;
    const planned = trainingFor(today, s);
    const answered = new Set((trainingLog as Row[]).filter((t) => t.household_id === h.id && t.day === today).map((t) => t.exercise));
    if (planned.length && planned.every((ex: string) => answered.has(ex))) done.training.add(`${h.id}|${today}`);
  }
  for (const r of reviews as Row[]) if (r.mood) done.day_review.add(`${r.household_id}|${r.day}`);
  for (const n of notes as Row[]) done.worry.add(`${n.user_id}|${n.day}`);

  const plan = planNotifications({ now, households, members, reminders, activeActivities: active, done });

  // Gem først, så samme besked ikke sendes to gange, hvis næste kørsel starter før denne er færdig.
  await upsert("reminders", plan.reminderUpserts, "user_id,kind,day");
  for (const u of plan.activityUpdates) {
    const { id, ...body } = u;
    await rest(`activities?id=eq.${id}&ended_at=is.null`, { method: "PATCH", body: JSON.stringify(body) }, "return=minimal");
  }
  if (plan.hintInserts.length) {
    await rest("hint_events", { method: "POST", body: JSON.stringify(plan.hintInserts) }, "return=minimal");
  }

  let sent = 0, failed = 0;
  const subsByUser = new Map<string, Row[]>();
  for (const s of subs as Row[]) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) ?? []), s]);
  for (const msg of plan.sends) {
    for (const sub of subsByUser.get(msg.user_id) ?? []) {
      try {
        const r = await sendPush(sub, msg.payload, VAPID, { ttl: 1800 });
        if (r.ok) sent++;
        else {
          failed++;
          if (r.gone) await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" });
          else console.error("Push fejlede", r.status, sub.endpoint.slice(0, 40));
        }
      } catch (err) {
        failed++;
        console.error("Push fejlede", err);
      }
    }
  }
  return { planned: plan.sends.length, sent, failed };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// "Send en test" fra Indstillinger: sender til den indloggede brugers egne enheder.
async function sendTest(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? "";
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
  if (!who.ok) return Response.json({ error: "Log ind igen." }, { status: 401, headers: CORS });
  const user = await who.json();
  const subs = await get(`push_subscriptions?select=endpoint,user_id,p256dh,auth&user_id=eq.${user.id}`);
  let sent = 0;
  for (const sub of subs as Row[]) {
    const r = await sendPush(sub, {
      title: "MS Kompasset", body: "Notifikationer virker. 🌿", kind: "test", tag: "test", url: "./",
    }, VAPID, { ttl: 300 });
    if (r.ok) sent++;
    else if (r.gone) await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" });
  }
  return Response.json({ devices: subs.length, sent }, { headers: CORS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (!VAPID.publicKey || !VAPID.privateKey) {
    return new Response("VAPID-nøgler mangler", { status: 500, headers: CORS });
  }
  if (!req.headers.get("x-cron-secret") && req.headers.get("authorization")?.startsWith("Bearer ")) {
    try {
      return await sendTest(req);
    } catch (err) {
      console.error(err);
      return Response.json({ error: String(err) }, { status: 500, headers: CORS });
    }
  }
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    const result = await run(new Date());
    return Response.json(result);
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
});
