// Owners from state business registries (free public data), looked up by the free collector
// on GitHub (scripts/registry_owners.py). Florida uses the state's full corporate file (so it
// runs at most once a day, for every Florida business not looked up yet); the other states
// are searched one business at a time on their open-data portals.
//
// A business's owner from its own website is kept; the registry fills the gap otherwise.

export const REGISTRY_STATES = ["FL", "NY", "PA", "OR", "CT", "CO"] as const;
const FL_EVERY_HOURS = 20;
const MAX_PAGE = 2000;

const upsert = (env: Env, key: string, value: string) => env.DB.prepare(
  `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
).bind(key, value);

// Businesses looked up before all officers and the founding date were kept ("backfill") get a
// second look, at most this many handed out per UTC day across all states (D1's daily write
// allowance is shared with everything else). New, never-looked-up businesses are not capped.
export const BACKFILL_PER_DAY = 2500;
const BACKFILL_DAY_KEY = "registry_backfill_day"; // "YYYY-MM-DD <handed out that day>"
const BACKFILL_DONE_KEY = "registry_backfill_done"; // states with nothing left to backfill, "FL,NY"
const BACKFILL_WHERE = `state = ? AND registry_checked_at IS NOT NULL AND registry_details_at IS NULL AND business_name IS NOT NULL`;

type Claimed = { rid: number; id: string; name: string; city: string | null; zip: string | null };

/** Today's backfill allowance left, and the states already finished (nothing left to backfill). */
export async function backfillInfo(env: Env) {
  const day = new Date().toISOString().slice(0, 10);
  const used = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = ?`).bind(BACKFILL_DAY_KEY).first<string>("value");
  const [d, n] = (used || "").split(" ");
  const usedToday = d === day ? Math.max(0, Number(n) || 0) : 0;
  const done = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = ?`).bind(BACKFILL_DONE_KEY).first<string>("value");
  return { day, usedToday, left: Math.max(0, BACKFILL_PER_DAY - usedToday), done: new Set((done || "").split(",").filter(Boolean)) };
}

/** States with businesses waiting to be looked up (Florida only when its daily run is due). */
export async function registryWaiting(env: Env): Promise<string[]> {
  const lastFl = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'registry_fl_last_run'`).first<string>("value");
  const flDue = !lastFl || Date.parse(lastFl.replace(" ", "T") + "Z") < Date.now() - FL_EVERY_HOURS * 3_600_000;
  const bf = await backfillInfo(env);
  const out: string[] = [];
  for (const st of REGISTRY_STATES) {
    if (st === "FL" && !flDue) continue;
    // Same condition as claimRegistry: a business without a name is never handed out, so it doesn't count.
    const any = await env.DB.prepare(`SELECT 1 AS x FROM leads WHERE state = ? AND registry_checked_at IS NULL AND business_name IS NOT NULL LIMIT 1`).bind(st).first();
    if (any) {
      out.push(st);
      continue;
    }
    // Backfill: only looked for while today's allowance lasts, and never again once a state is
    // finished (businesses saved from now on always get their details, so it only shrinks).
    if (bf.left <= 0 || bf.done.has(st)) continue;
    const old = await env.DB.prepare(`SELECT 1 AS x FROM leads WHERE ${BACKFILL_WHERE} LIMIT 1`).bind(st).first();
    if (old) out.push(st);
    else {
      bf.done.add(st);
      // .first() runs the write too (and keeps this cheap path to plain reads + one rare write).
      await upsert(env, BACKFILL_DONE_KEY, [...bf.done].sort().join(",")).first();
    }
  }
  return out;
}

/**
 * A page of businesses in `state` to look up: first the ones never looked up (in saving order,
 * after `after`), then — within today's allowance — ones looked up before the details were kept.
 * The backfill part pages with a negative cursor: after = -1 starts it, -(rowid + 1) continues.
 */
export async function claimRegistry(env: Env, state: string, after: number, limit: number) {
  if (!(REGISTRY_STATES as readonly string[]).includes(state)) return { items: [], after, done: true };
  if (state === "FL" && after === 0) await upsert(env, "registry_fl_last_run", new Date().toISOString().slice(0, 19).replace("T", " ")).run();
  const take = Math.max(1, Math.min(MAX_PAGE, limit || MAX_PAGE));
  const strip = (rows: Claimed[]) => rows.map(({ rid: _r, ...x }) => x);
  let items: Claimed[] = [];
  let cursor = Math.trunc(after) || 0;
  if (cursor >= 0) {
    const { results } = await env.DB.prepare(
      `SELECT rowid AS rid, id, business_name AS name, city, postal_code AS zip FROM leads
       WHERE state = ? AND registry_checked_at IS NULL AND rowid > ? AND business_name IS NOT NULL
       ORDER BY rowid LIMIT ?`,
    ).bind(state, cursor, take).all<Claimed>();
    items = results;
    if (results.length === take) return { items: strip(items), after: results[results.length - 1].rid, done: false };
    cursor = -1;
  }
  const bf = await backfillInfo(env);
  const room = Math.min(take - items.length, bf.left);
  if (room <= 0 || bf.done.has(state)) return { items: strip(items), after: cursor, done: true };
  const { results: old } = await env.DB.prepare(
    `SELECT rowid AS rid, id, business_name AS name, city, postal_code AS zip FROM leads
     WHERE ${BACKFILL_WHERE} AND rowid > ? ORDER BY rowid LIMIT ?`,
  ).bind(state, -cursor - 1, room).all<Claimed>();
  if (old.length) {
    await upsert(env, BACKFILL_DAY_KEY, `${bf.day} ${bf.usedToday + old.length}`).run();
    cursor = -old[old.length - 1].rid - 1;
  }
  return { items: strip([...items, ...old]), after: cursor, done: old.length < room || bf.left - old.length <= 0 };
}

export interface RegistryContact {
  name: string;
  title: string | null;
}

export interface RegistryResult {
  id: string;
  ownerName: string | null;
  ownerTitle: string | null;
  registryName: string | null;
  registryId: string | null;
  /** People on the registry record (owner first), when the collector sent any. */
  contacts?: RegistryContact[];
  /** Founding (filing) date, YYYY-MM-DD, when known. */
  founded?: string;
}

export const MAX_REGISTRY_CONTACTS = 5;

/**
 * Plain titles from the registries' short codes: Florida files "PD" (president & director),
 * "MGRM" (managing member), "AMBR" (authorized member), "PSTD"... and some are cut off ("Mana").
 */
export function tidyOwnerTitle(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  const c = t.toUpperCase().replace(/[^A-Z]/g, "");
  if (!c) return null;
  const known = ["Owner", "CEO", "President", "Managing Member", "Manager", "Member", "Partner", "General Partner", "Principal", "Chairman",
    "Authorized Person", "Vice President", "Director", "Treasurer", "Secretary", "Registered agent"];
  const same = known.find((k) => k.toUpperCase().replace(/[^A-Z]/g, "") === c);
  if (same) return same;
  if (c.includes("CEO")) return "CEO";
  if (c.startsWith("OWN") || c === "O") return "Owner";
  if (/^(MGRM|MMGR|MM|MANAGINGMEMBER)/.test(c)) return "Managing Member";
  if (/^(MANA|MGR|MGM|MRG|MG|MR|OPMG)/.test(c)) return "Manager";
  if (/^(AMBR|AMB|MBR|MEMB|AM$)/.test(c)) return "Member";
  if (/^(AUTH|AP$|AR$)/.test(c)) return "Authorized Person";
  if (c.startsWith("PRIN")) return "Principal";
  if (c.startsWith("PART") || c === "GP") return "Partner";
  if (c === "CFO" || c.startsWith("CFO")) return "CFO";
  if (c === "COO") return "COO";
  if (c === "C" || c.startsWith("CHA")) return "Chairman";
  if (c.startsWith("SEC") || (c.startsWith("S") && c.length <= 3)) return "Secretary";
  if (c.startsWith("TRE") || (c.startsWith("T") && c.length <= 3)) return "Treasurer";
  if (c.startsWith("DIR") || /^D+$/.test(c)) return "Director";
  // Short officer codes made of P, D, S, T, V, C (e.g. PD, PTD, PSD, DPST, P/D): president first.
  if (/^[PDSTVC]{1,6}$/.test(c) && c.includes("P") && !c.startsWith("V")) return "President";
  if (c.startsWith("V")) return "Vice President";
  return t.length > 3 ? t : null;
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function sanitizeRegistry(v: unknown): RegistryResult | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = text(o.id, 64);
  if (!id || !/^[\w-]+$/.test(id)) return null;
  const owner = personName(o.ownerName);
  const out: RegistryResult = {
    id,
    ownerName: owner,
    ownerTitle: tidyOwnerTitle(text(o.ownerTitle, 40)),
    registryName: text(o.registryName, 120),
    registryId: text(o.registryId, 40),
  };
  const contacts = sanitizeContacts(o.contacts);
  if (contacts.length) out.contacts = contacts;
  const founded = foundedDate(o.founded);
  if (founded) out.founded = founded;
  return out;
}

const personName = (v: unknown): string | null => {
  const n = text(v, 60);
  return n && /^[A-Za-z][A-Za-z.'\- ]{2,59}$/.test(n) ? n : null;
};

/** People from the registry: names checked like the owner's, plain titles, once each, at most 5. */
export function sanitizeContacts(v: unknown): RegistryContact[] {
  if (!Array.isArray(v)) return [];
  const out: RegistryContact[] = [];
  const seen = new Set<string>();
  for (const c of v.slice(0, 50)) {
    if (!c || typeof c !== "object") continue;
    const name = personName((c as Record<string, unknown>).name);
    const key = name?.toLowerCase().replace(/[^a-z]/g, "");
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, title: tidyOwnerTitle(text((c as Record<string, unknown>).title, 40)) });
    if (out.length >= MAX_REGISTRY_CONTACTS) break;
  }
  return out;
}

/** A real calendar date YYYY-MM-DD between 1800-01-01 and today, else null. */
export function foundedDate(v: unknown, today = new Date().toISOString().slice(0, 10)): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.toISOString().slice(0, 10) !== s) return null; // 2015-02-30 and the like
  return s >= "1800-01-01" && s <= today ? s : null;
}

const SAVE_LEAD_SQL = `UPDATE leads SET registry_checked_at = datetime('now'), registry_details_at = datetime('now'),
       registry_name = COALESCE(?, registry_name), registry_id = COALESCE(?, registry_id),
       owner_title = CASE WHEN owner_name IS NULL AND ? IS NOT NULL THEN ? ELSE owner_title END,
       owner_source = CASE WHEN owner_name IS NULL AND ? IS NOT NULL THEN 'registry' ELSE owner_source END,
       owner_name = COALESCE(owner_name, ?),
       founded = COALESCE(founded, ?)
     WHERE id = ?`;

/** Registry people use positions 0-9 (website contacts go above), so the two never collide. */
function insertContactsSql(n: number) {
  const values = Array.from({ length: n }, (_, i) => `(${i}, ?, ?)`).join(", ");
  // Only for a business that still exists; OR IGNORE so a taken position never fails the batch.
  return `INSERT OR IGNORE INTO lead_contacts (lead_id, position, name, title, source)
     SELECT l.id, c.column1, c.column2, c.column3, 'registry' FROM (VALUES ${values}) AS c JOIN leads l ON l.id = ?`;
}

/**
 * Saves what the registry said; every business sent is marked as looked up (found or not), with
 * its registry people replaced and the founding date filled in when it wasn't known.
 */
export async function saveRegistryResults(env: Env, raw: unknown[]): Promise<{ saved: number; owners: number; contacts: number; founded: number }> {
  const rows = raw.map(sanitizeRegistry).filter((r): r is RegistryResult => !!r).slice(0, 1000);
  // Each business's statements stay in the same batch (at most 90 statements per batch).
  let batch: D1PreparedStatement[] = [];
  for (const r of rows) {
    const contacts = r.contacts ?? [];
    const st = [
      env.DB.prepare(SAVE_LEAD_SQL).bind(r.registryName, r.registryId, r.ownerName, r.ownerTitle, r.ownerName, r.ownerName, r.founded ?? null, r.id),
      env.DB.prepare(`DELETE FROM lead_contacts WHERE lead_id = ? AND source = 'registry'`).bind(r.id),
    ];
    if (contacts.length) st.push(env.DB.prepare(insertContactsSql(contacts.length)).bind(...contacts.flatMap((c) => [c.name, c.title]), r.id));
    if (batch.length + st.length > 90) {
      await env.DB.batch(batch);
      batch = [];
    }
    batch.push(...st);
  }
  if (batch.length) await env.DB.batch(batch);
  return {
    saved: rows.length,
    owners: rows.filter((r) => r.ownerName).length,
    contacts: rows.reduce((n, r) => n + (r.contacts?.length ?? 0), 0),
    founded: rows.filter((r) => r.founded).length,
  };
}

export async function registryStatus(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT state, COUNT(*) AS total, SUM(registry_checked_at IS NOT NULL) AS checked, SUM(owner_source = 'registry') AS from_registry,
       SUM(founded IS NOT NULL) AS with_founded,
       SUM(EXISTS (SELECT 1 FROM lead_contacts c WHERE c.lead_id = leads.id AND c.source = 'registry')) AS with_contacts,
       SUM(registry_checked_at IS NOT NULL AND registry_details_at IS NULL) AS details_waiting
     FROM leads WHERE state IN (${REGISTRY_STATES.map((s) => `'${s}'`).join(", ")}) GROUP BY state`,
  ).all<{ state: string; total: number; checked: number; from_registry: number; with_founded: number; with_contacts: number; details_waiting: number }>();
  const owners = await env.DB.prepare(`SELECT COUNT(*) AS n FROM leads WHERE owner_name IS NOT NULL`).first<number>("n");
  const lastFl = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'registry_fl_last_run'`).first<string>("value");
  const err = await env.DB.prepare(`SELECT value, updated_at FROM app_settings WHERE key = 'registry_last_error'`).first<{ value: string; updated_at: string }>();
  const bf = await backfillInfo(env);
  return {
    states: results, ownersKnown: owners ?? 0, floridaLastRun: lastFl || null,
    withFounded: results.reduce((n, r) => n + (r.with_founded || 0), 0),
    withContacts: results.reduce((n, r) => n + (r.with_contacts || 0), 0),
    backfill: { perDay: BACKFILL_PER_DAY, today: bf.usedToday, finishedStates: [...bf.done].sort() },
    lastError: err?.value ? { message: err.value, at: err.updated_at } : null,
  };
}
