// Røgtest af Edge Function "notify" i Node med en falsk Deno og falsk Supabase/push-tjeneste.
// Kør: node --experimental-strip-types tests/notify.smoke.mjs
import { generateVapidKeys } from "../supabase/functions/_shared/webpush.js";
import * as nodeCrypto from "node:crypto";

const v = await generateVapidKeys();
const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", CRON_SECRET: "hemmelig", VAPID_PUBLIC_KEY: v.publicKey, VAPID_PRIVATE_KEY: v.privateKey, VAPID_SUBJECT: "mailto:t@example.com" };
let handler;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => (handler = h) };

const ua = nodeCrypto.createECDH("prime256v1"); ua.generateKeys();
const b64u = (b) => Buffer.from(b).toString("base64url");
const now = new Date();
// Fast pause lige nu, så testen virker uanset tidspunkt på dagen
const hhmm = now.toISOString().slice(11, 16);
const calls = [];
const db = {
  households: [{ id: "h1", settings: { fixedWeek: [hhmm], fixedWeekend: [hhmm], tz: "UTC" } }],
  members: [{ user_id: "d", household_id: "h1", role: "patient", settings: {} }],
  push_subscriptions: [{ endpoint: "https://push.example.com/abc", user_id: "d", p256dh: b64u(ua.getPublicKey()), auth: b64u(nodeCrypto.randomBytes(16)) }],
  reminders: [], activities: [], training_log: [], day_reviews: [], notes: [],
};
globalThis.fetch = async (url, init = {}) => {
  calls.push([init.method || "GET", String(url).replace(/\?.*/, "")]);
  const u = new URL(url);
  if (u.hostname === "push.example.com") return new Response("", { status: 201 });
  const table = u.pathname.split("/").pop();
  if ((init.method || "GET") === "GET") return new Response(JSON.stringify(db[table] || []), { status: 200 });
  return new Response("", { status: 201 });
};

await import("../supabase/functions/notify/index.ts");
const deny = await handler(new Request("https://x/notify", { method: "POST" }));
console.log("uden hemmelighed:", deny.status);
const res = await handler(new Request("https://x/notify", { method: "POST", headers: { "x-cron-secret": "hemmelig" } }));
const body = await res.json();
console.log("svar:", res.status, JSON.stringify(body));
console.log("kald:", calls.filter((c) => c[0] !== "GET").map((c) => c.join(" ")).join(", "));
if (res.status !== 200 || body.sent < 1 || deny.status !== 403) { console.error("RØGTEST FEJLEDE"); process.exit(1); }
console.log("NOTIFY RØGTEST OK");
