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

/** A stable key for a list's filters (same filters in any order = same key; paging and sorting ignored). */
export function filterKey(prefix: string, params: URLSearchParams, ignore: string[] = ["page", "page_size", "sort", "dir"]): string {
  const pairs = [...params.entries()].filter(([k]) => !ignore.includes(k)).map(([k, v]) => `${k}=${v}`).sort();
  return `${prefix}?${pairs.join("&")}`;
}
