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

/** States with businesses waiting to be looked up (Florida only when its daily run is due). */
export async function registryWaiting(env: Env): Promise<string[]> {
  const lastFl = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'registry_fl_last_run'`).first<string>("value");
  const flDue = !lastFl || Date.parse(lastFl.replace(" ", "T") + "Z") < Date.now() - FL_EVERY_HOURS * 3_600_000;
  const out: string[] = [];
  for (const st of REGISTRY_STATES) {
    if (st === "FL" && !flDue) continue;
    const any = await env.DB.prepare(`SELECT 1 AS x FROM leads WHERE state = ? AND registry_checked_at IS NULL LIMIT 1`).bind(st).first();
    if (any) out.push(st);
  }
  return out;
}

/** A page of businesses in `state` not looked up yet (in saving order, after `after`). */
export async function claimRegistry(env: Env, state: string, after: number, limit: number) {
  if (!(REGISTRY_STATES as readonly string[]).includes(state)) return { items: [], after, done: true };
  if (state === "FL" && after === 0) await upsert(env, "registry_fl_last_run", new Date().toISOString().slice(0, 19).replace("T", " ")).run();
  const take = Math.max(1, Math.min(MAX_PAGE, limit || MAX_PAGE));
  const { results } = await env.DB.prepare(
    `SELECT rowid AS rid, id, business_name AS name, city, postal_code AS zip FROM leads
     WHERE state = ? AND registry_checked_at IS NULL AND rowid > ? AND business_name IS NOT NULL
     ORDER BY rowid LIMIT ?`,
  ).bind(state, after, take).all<{ rid: number; id: string; name: string; city: string | null; zip: string | null }>();
  return {
    items: results.map(({ rid: _r, ...x }) => x),
    after: results.length ? results[results.length - 1].rid : after,
    done: results.length < take,
  };
}

export interface RegistryResult {
  id: string;
  ownerName: string | null;
  ownerTitle: string | null;
  registryName: string | null;
  registryId: string | null;
}

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
  const owner = text(o.ownerName, 60);
  return {
    id,
    ownerName: owner && /^[A-Za-z][A-Za-z.'\- ]{2,59}$/.test(owner) ? owner : null,
    ownerTitle: tidyOwnerTitle(text(o.ownerTitle, 40)),
    registryName: text(o.registryName, 120),
    registryId: text(o.registryId, 40),
  };
}

/** Saves what the registry said; every business sent is marked as looked up (found or not). */
export async function saveRegistryResults(env: Env, raw: unknown[]): Promise<{ saved: number; owners: number }> {
  const rows = raw.map(sanitizeRegistry).filter((r): r is RegistryResult => !!r).slice(0, 1000);
  const st = rows.map((r) => env.DB.prepare(
    `UPDATE leads SET registry_checked_at = datetime('now'), registry_name = COALESCE(?, registry_name), registry_id = COALESCE(?, registry_id),
       owner_title = CASE WHEN owner_name IS NULL AND ? IS NOT NULL THEN ? ELSE owner_title END,
       owner_source = CASE WHEN owner_name IS NULL AND ? IS NOT NULL THEN 'registry' ELSE owner_source END,
       owner_name = COALESCE(owner_name, ?)
     WHERE id = ?`,
  ).bind(r.registryName, r.registryId, r.ownerName, r.ownerTitle, r.ownerName, r.ownerName, r.id));
  for (let i = 0; i < st.length; i += 90) await env.DB.batch(st.slice(i, i + 90));
  return { saved: rows.length, owners: rows.filter((r) => r.ownerName).length };
}

export async function registryStatus(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT state, COUNT(*) AS total, SUM(registry_checked_at IS NOT NULL) AS checked, SUM(owner_source = 'registry') AS from_registry
     FROM leads WHERE state IN (${REGISTRY_STATES.map((s) => `'${s}'`).join(", ")}) GROUP BY state`,
  ).all<{ state: string; total: number; checked: number; from_registry: number }>();
  const owners = await env.DB.prepare(`SELECT COUNT(*) AS n FROM leads WHERE owner_name IS NOT NULL`).first<number>("n");
  const lastFl = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'registry_fl_last_run'`).first<string>("value");
  const err = await env.DB.prepare(`SELECT value, updated_at FROM app_settings WHERE key = 'registry_last_error'`).first<{ value: string; updated_at: string }>();
  return { states: results, ownersKnown: owners ?? 0, floridaLastRun: lastFl || null, lastError: err?.value ? { message: err.value, at: err.updated_at } : null };
}
