// Short-lived answers for the heaviest dashboard reads. D1's free plan allows 5 million rows
// read a day, and one filter-count refresh reads the whole table many times over; the same
// question asked again within a few minutes (paging, re-opening a dropdown, a second person on
// the same list) is answered from one stored row instead.

async function keyOf(key: string): Promise<string> {
  if (key.length <= 200) return key;
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return key.slice(0, 40) + ":" + [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The stored answer when it is younger than `ttlSeconds`, else a fresh one (stored for next time). */
export async function cached<T>(env: Env, key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  const now = Math.floor(Date.now() / 1000);
  const k = await keyOf(key);
  try {
    const hit = await env.DB.prepare(`SELECT value FROM api_cache WHERE key = ? AND expires_at > ?`).bind(k, now).first<string>("value");
    if (hit) return JSON.parse(hit) as T;
  } catch {
    // No cache table yet (or a bad row): just compute.
  }
  const value = await compute();
  const text = JSON.stringify(value);
  if (text.length < 500_000) {
    try {
      await env.DB.prepare(
        `INSERT INTO api_cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
      ).bind(k, text, now + ttlSeconds).run();
      // Now and then, clear out old answers (the table stays small).
      if (Math.random() < 0.05) await env.DB.prepare(`DELETE FROM api_cache WHERE expires_at < ?`).bind(now).run();
    } catch {
      // Caching is best-effort.
    }
  }
  return value;
}

/**
 * Like cached(), for many keys at once: stored answers are read 90 keys per query, the missing
 * ones are worked out together by `compute` (which returns them by key) and stored in one batch.
 */
export async function cachedMany<T>(env: Env, keys: string[], ttlSeconds: number, compute: (missing: string[]) => Promise<Map<string, T>>): Promise<Map<string, T>> {
  const now = Math.floor(Date.now() / 1000);
  const unique = [...new Set(keys)];
  const stored = new Map<string, string>(); // stored key -> our key
  for (const k of unique) stored.set(await keyOf(k), k);
  const out = new Map<string, T>();
  const all = [...stored.keys()];
  for (let i = 0; i < all.length; i += 90) {
    const part = all.slice(i, i + 90);
    try {
      const { results } = await env.DB.prepare(`SELECT key, value FROM api_cache WHERE key IN (${part.map(() => "?").join(", ")}) AND expires_at > ?`)
        .bind(...part, now).all<{ key: string; value: string }>();
      for (const r of results) {
        try { out.set(stored.get(r.key)!, JSON.parse(r.value) as T); } catch { /* recompute a bad row */ }
      }
    } catch {
      // No cache table yet: just compute.
    }
  }
  const missing = unique.filter((k) => !out.has(k));
  if (!missing.length) return out;
  const fresh = await compute(missing);
  const writes: D1PreparedStatement[] = [];
  for (const [storedKey, k] of stored) {
    if (!fresh.has(k)) continue;
    out.set(k, fresh.get(k)!);
    const text = JSON.stringify(fresh.get(k));
    if (text.length < 500_000) {
      writes.push(env.DB.prepare(`INSERT INTO api_cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`)
        .bind(storedKey, text, now + ttlSeconds));
    }
  }
  try {
    for (let i = 0; i < writes.length; i += 50) await env.DB.batch(writes.slice(i, i + 50));
  } catch {
    // Caching is best-effort.
  }
  return out;
}

/** A stable key for a list's filters (same filters in any order = same key; paging and sorting ignored). */
export function filterKey(prefix: string, params: URLSearchParams, ignore: string[] = ["page", "page_size", "sort", "dir"]): string {
  const pairs = [...params.entries()].filter(([k]) => !ignore.includes(k)).map(([k, v]) => `${k}=${v}`).sort();
  return `${prefix}?${pairs.join("&")}`;
}
