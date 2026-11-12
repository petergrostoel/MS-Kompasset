// MS Kompasset – analyse af bekymringer (Supabase Edge Function).
//
// Læser brugerens egne notater for den valgte periode (via brugerens login, så
// Row Level Security sikrer, at kun egne notater kan læses) og beder Claude om
// en kort opsummering: hvad går igen, hvad fylder mest, hvad er ikke længere en bekymring.
//
// Hemmelighed: ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets).

import Anthropic from "npm:@anthropic-ai/sdk";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const MODEL = Deno.env.get("ANALYSIS_MODEL") ?? "claude-opus-5-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2-3 sætninger der samler perioden op" },
    recurring: {
      type: "array",
      description: "Bekymringer der går igen flere gange",
      items: {
        type: "object",
        properties: { topic: { type: "string" }, times: { type: "integer" }, detail: { type: "string" } },
        required: ["topic", "times", "detail"],
        additionalProperties: false,
      },
    },
    biggest: { type: "array", items: { type: "string" }, description: "Det der fylder mest lige nu" },
    resolved: { type: "array", items: { type: "string" }, description: "Tidligere bekymringer der ikke længere ser ud til at være det" },
  },
  required: ["summary", "recurring", "biggest", "resolved"],
  additionalProperties: false,
};

const SYSTEM = `Du hjælper en person med multipel sklerose (MS), som skriver korte daglige notater om det, der går hende på.
Du får hendes notater for en periode og laver en kort, rolig og venlig opsummering på dansk, skrevet direkte til hende ("du").
- Find bekymringer der går igen, og tæl hvor mange notater de optræder i.
- Sig hvad der fylder mest lige nu (vægt de nyeste notater højest).
- Nævn bekymringer der tidligere fyldte, men som hun senere har skrevet er gået godt eller ikke længere nævner.
- Hold dig til det, der står i notaterne. Stil ikke diagnoser og giv ikke medicinske råd.
- Skriv kort og klart. Hun kan være træt, når hun læser det.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const auth = req.headers.get("authorization") ?? "";
    const apikey = req.headers.get("apikey") ?? "";
    if (!auth.startsWith("Bearer ") || !apikey) return json({ error: "Du skal være logget ind." }, 401);

    const { days = 14, today } = await req.json().catch(() => ({}));
    const n = Math.min(365, Math.max(1, Number(days) || 14));
    const end = /^\d{4}-\d{2}-\d{2}$/.test(today ?? "") ? today : new Date().toISOString().slice(0, 10);
    const from = new Date(Date.parse(end + "T12:00:00Z") - (n - 1) * 864e5).toISOString().slice(0, 10);

    // Brugerens egne notater (RLS)
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/notes?select=day,body,nothing&day=gte.${from}&day=lte.${end}&order=day.asc`,
      { headers: { Authorization: auth, apikey } },
    );
    if (res.status === 401) return json({ error: "Dit login er udløbet. Log ind igen." }, 401);
    if (!res.ok) throw new Error(`Kunne ikke hente notater: ${res.status}`);
    const notes = (await res.json()).filter((x: { body: string; nothing: boolean }) => !x.nothing && x.body.trim());
    if (!notes.length) return json({ count: 0 });

    const text = notes.map((x: { day: string; body: string }) => `${x.day}: ${x.body.trim()}`).join("\n\n");
    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
    const msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `Her er mine notater fra ${from} til ${end} (${notes.length} notater):\n\n${text}`,
      }],
    } as any);

    if (msg.stop_reason === "refusal") return json({ error: "Analysen kunne ikke laves. Prøv en anden periode." }, 502);
    const block = msg.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined;
    if (!block) throw new Error("Tomt svar");
    return json({ count: notes.length, from, to: end, ...JSON.parse(block.text) });
  } catch (err) {
    console.error(err);
    return json({ error: "Analysen fejlede. Prøv igen om lidt." }, 500);
  }
});
