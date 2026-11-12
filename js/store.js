// Data: lokal kopi + synkronisering med Supabase.
// Alt gemmes først lokalt (så appen virker uden net), og sendes derefter op.
// Ændringer fra den anden telefon hentes ved åbning, hvert 30. sekund og når appen kommer i forgrunden.

const LS = "msk.v1.";
const TABLES = {
  activities: { key: ["id"], since: 60 },
  hint_events: { key: ["id"], since: 60, dateCol: "asked_at" },
  day_reviews: { key: ["household_id", "day"], since: 30, dateCol: "day" },
  food_entries: { key: ["household_id", "day", "item"], since: 30, dateCol: "day" },
  custom_foods: { key: ["household_id", "name"] },
  protein_days: { key: ["household_id", "day"], since: 30, dateCol: "day" },
  training_log: { key: ["household_id", "day", "exercise"], since: 30, dateCol: "day" },
  notes: { key: ["user_id", "day"] },
  reminders: { key: ["user_id", "kind", "day"], since: 2, dateCol: "day" },
};
export const TABLE_NAMES = Object.keys(TABLES);

const keyOf = (table, row) => TABLES[table].key.map((k) => row[k]).join("|");

function read(k, fallback) {
  try {
    const v = localStorage.getItem(LS + k);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function write(k, v) {
  try {
    localStorage.setItem(LS + k, JSON.stringify(v));
  } catch (err) {
    console.error("Kunne ikke gemme lokalt", err);
  }
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
}

function emptyData() {
  const d = { me: null, household: null, members: [] };
  for (const t of TABLE_NAMES) d[t] = [];
  return d;
}

export class Store {
  constructor({ db = null, demo = false, onChange = () => {}, onSync = () => {} } = {}) {
    this.db = db;
    this.demo = demo;
    this.onChange = onChange;
    this.onSync = onSync;
    this.user = null;
    this.data = read(demo ? "demo" : "data", null) || emptyData();
    for (const t of TABLE_NAMES) this.data[t] ||= [];
    this.ops = demo ? [] : read("ops", []);
    this.syncing = false;
    this.again = false;
  }

  persist() {
    write(this.demo ? "demo" : "data", this.data);
    if (!this.demo) write("ops", this.ops);
  }

  reset() {
    this.data = emptyData();
    this.ops = [];
    this.persist();
  }

  get me() { return this.data.me; }
  get household() { return this.data.household; }
  get isPatient() { return this.data.me?.role === "patient"; }

  // ---------- lokale ændringer ----------

  upsert(table, row) {
    const full = { ...row };
    if (table !== "notes" && table !== "reminders") full.household_id ||= this.data.household?.id;
    if (TABLES[table].key.includes("user_id") || table === "notes") full.user_id ||= this.user?.id;
    if (TABLES[table].key[0] === "id") full.id ||= uuid();
    full.updated_at = new Date().toISOString();
    const k = keyOf(table, full);
    const list = this.data[table];
    const i = list.findIndex((r) => keyOf(table, r) === k);
    if (i >= 0) list[i] = { ...list[i], ...full };
    else list.push(full);
    this.queue({ t: "upsert", table, row: i >= 0 ? list[i] : full });
    return i >= 0 ? list[i] : full;
  }

  remove(table, row) {
    const k = keyOf(table, row);
    this.data[table] = this.data[table].filter((r) => keyOf(table, r) !== k);
    const match = Object.fromEntries(TABLES[table].key.map((c) => [c, row[c]]));
    this.queue({ t: "delete", table, match });
  }

  setHouseholdSettings(patch) {
    const h = this.data.household;
    h.settings = { ...(h.settings || {}), ...patch };
    this.queue({ t: "household", id: h.id, settings: h.settings });
  }

  setMemberSettings(patch) {
    const m = this.data.me;
    m.settings = { ...(m.settings || {}), ...patch };
    const mm = this.data.members.find((x) => x.user_id === m.user_id);
    if (mm) mm.settings = m.settings;
    this.queue({ t: "member", settings: m.settings });
  }

  queue(op) {
    if (!this.demo) {
      // Saml flere ændringer af samme række til én
      const same = (o) => o.t === op.t && (
        (op.t === "upsert" && o.table === op.table && keyOf(o.table, o.row) === keyOf(op.table, op.row)) ||
        op.t === "household" || op.t === "member");
      const i = this.ops.findIndex(same);
      if (i >= 0) this.ops[i] = op;
      else this.ops.push(op);
      if (op.t === "upsert" || op.t === "delete") {
        // En sletning annullerer en ventende oprettelse og omvendt
        const k = op.t === "upsert" ? keyOf(op.table, op.row) : keyOf(op.table, op.match);
        this.ops = this.ops.filter((o) => o === op || !(
          (o.t === "upsert" || o.t === "delete") && o.table === op.table &&
          keyOf(o.table, o.t === "upsert" ? o.row : o.match) === k && o.t !== op.t));
      }
    }
    this.persist();
    this.onChange();
    if (!this.demo) this.sync();
  }

  // ---------- synkronisering ----------

  async sync() {
    if (this.demo || !this.db || !this.user) return;
    if (this.syncing) {
      this.again = true;
      return;
    }
    this.syncing = true;
    this.onSync("pending");
    try {
      await this.flush();
      await this.pull();
      this.onSync(this.ops.length ? "pending" : "ok");
    } catch (err) {
      console.error("Synkronisering fejlede", err);
      this.onSync(navigator.onLine ? "error" : "offline");
    } finally {
      this.syncing = false;
      if (this.again) {
        this.again = false;
        this.sync();
      }
    }
  }

  async flush() {
    while (this.ops.length) {
      const op = this.ops[0];
      let res;
      if (op.t === "upsert") {
        const row = { ...op.row };
        delete row.updated_at;
        delete row.created_at;
        res = await this.db.from(op.table).upsert(row, { onConflict: TABLES[op.table].key.join(",") });
      } else if (op.t === "delete") {
        res = await this.db.from(op.table).delete().match(op.match);
      } else if (op.t === "household") {
        res = await this.db.from("households").update({ settings: op.settings }).eq("id", op.id);
      } else if (op.t === "member") {
        res = await this.db.from("members").update({ settings: op.settings }).eq("user_id", this.user.id);
      }
      if (res?.error) {
        // Fejl fra databasen (fx manglende rettighed) kan ikke løses ved at prøve igen.
        if (res.error.code && !/fetch|network/i.test(res.error.message || "")) {
          console.error("Ændring afvist af databasen – springes over", op, res.error);
          this.ops.shift();
          this.persist();
          continue;
        }
        throw res.error;
      }
      // Fjern kun hvis den ikke er blevet erstattet i mellemtiden
      if (this.ops[0] === op) this.ops.shift();
      this.persist();
    }
  }

  async pull() {
    const db = this.db;
    const { data: me, error: e1 } = await db.from("members").select("*").eq("user_id", this.user.id).maybeSingle();
    if (e1) throw e1;
    if (!me) {
      this.data = emptyData();
      this.persist();
      this.onChange();
      return;
    }
    const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    const queries = TABLE_NAMES.map((t) => {
      let q = db.from(t).select("*");
      const def = TABLES[t];
      if (def.since) q = q.gte(def.dateCol || "started_at", def.dateCol === "day" ? day(def.since) : new Date(Date.now() - def.since * 864e5).toISOString());
      return q.limit(5000);
    });
    const [hh, mem, ...rest] = await Promise.all([
      db.from("households").select("*").eq("id", me.household_id).single(),
      db.from("members").select("user_id,household_id,role,display_name,settings").eq("household_id", me.household_id),
      ...queries,
    ]);
    for (const r of [hh, mem, ...rest]) if (r.error) throw r.error;

    // Dataene fra serveren + de lokale ændringer, der endnu ikke er sendt.
    const next = { me, household: hh.data, members: mem.data };
    TABLE_NAMES.forEach((t, i) => (next[t] = rest[i].data));
    // Aktiviteten i gang skal altid med, også hvis den er ældre end perioden
    if (!next.activities.some((a) => !a.ended_at)) {
      const { data: act } = await db.from("activities").select("*").is("ended_at", null).limit(1);
      if (act?.length) next.activities.push(act[0]);
    }
    for (const op of this.ops) {
      if (op.t === "upsert") {
        const k = keyOf(op.table, op.row);
        const i = next[op.table].findIndex((r) => keyOf(op.table, r) === k);
        if (i >= 0) next[op.table][i] = { ...next[op.table][i], ...op.row };
        else next[op.table].push(op.row);
      } else if (op.t === "delete") {
        const k = keyOf(op.table, op.match);
        next[op.table] = next[op.table].filter((r) => keyOf(op.table, r) !== k);
      } else if (op.t === "household") next.household.settings = op.settings;
      else if (op.t === "member") next.me.settings = op.settings;
    }
    this.data = next;
    this.persist();
    this.onChange();
  }
}
