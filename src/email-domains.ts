// Free first pass before paid email verification: can the address's web domain receive email
// at all? Asked once per domain over public DNS (Cloudflare's DNS-over-HTTPS). A domain that
// doesn't exist, or says it takes no mail, can't have a working address, so its addresses are
// marked invalid (left out of downloads, never sent to MillionVerifier). About 2% of the
// addresses in the database, measured on 2026-09-30. Domains that do take mail are left for the
// paid check, which is what tells a real mailbox from a made-up one.

const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "aol.com",
  "icloud.com", "me.com", "mac.com", "comcast.net", "bellsouth.net", "att.net", "sbcglobal.net", "verizon.net", "cox.net",
  "charter.net", "earthlink.net", "protonmail.com", "proton.me", "gmx.com", "mail.com", "zoho.com",
]);
const ROWS_PER_RUN = 300;
const LOOKUPS_PER_RUN = 20; // each can take two DNS questions; the free plan allows 50 outside calls per run

export type MailAnswer = "mail" | "none" | "unknown";

interface DnsJson { Status: number; Answer?: { type: number; data: string }[] }

/** What DNS answers mean for mail: MX records (other than the "no mail" null MX) or an address = can take mail. */
export function mailFromDns(mx: DnsJson | null, a: DnsJson | null): MailAnswer {
  if (!mx) return "unknown";
  if (mx.Status === 3) return "none"; // the domain doesn't exist
  if (mx.Status !== 0) return "unknown"; // DNS trouble: don't judge
  const records = (mx.Answer ?? []).filter((r) => r.type === 15);
  if (records.length) return records.every((r) => /^0\s+\.?$/.test(r.data.trim())) ? "none" : "mail";
  // No MX: mail servers then try the domain's own address.
  if (!a) return "unknown";
  if (a.Status === 3) return "none";
  if (a.Status !== 0) return "unknown";
  return (a.Answer ?? []).some((r) => r.type === 1 || r.type === 28) ? "mail" : "none";
}

async function dns(name: string, type: "MX" | "A"): Promise<DnsJson | null> {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5000),
    });
    return res.ok ? ((await res.json()) as DnsJson) : null;
  } catch {
    return null;
  }
}

export const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase();

async function marker(env: Env): Promise<number> {
  return Number(await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'email_domain_rowid'`).first<string>("value")) || 0;
}

/** Cheap check for the minute job: are there addresses the domain check hasn't looked at yet? */
export async function emailDomainsWaiting(env: Env): Promise<boolean> {
  return !!(await env.DB.prepare(`SELECT 1 AS x FROM lead_emails WHERE rowid > ? LIMIT 1`).bind(await marker(env)).first());
}

/** One run: the next addresses in saving order; looks up new domains and marks addresses on dead ones. */
export async function emailDomainStep(env: Env): Promise<{ looked: number; marked: number; more: boolean }> {
  const from = await marker(env);
  const { results: rows } = await env.DB.prepare(`SELECT rowid AS rid, email FROM lead_emails WHERE rowid > ? ORDER BY rowid LIMIT ?`)
    .bind(from, ROWS_PER_RUN).all<{ rid: number; email: string }>();
  if (!rows.length) return { looked: 0, marked: 0, more: false };

  const domains = [...new Set(rows.map((r) => domainOf(r.email)).filter((d) => d && !FREEMAIL.has(d)))];
  const known = new Map<string, number | null>();
  for (let i = 0; i < domains.length; i += 90) {
    const part = domains.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT domain, has_mail FROM email_domains WHERE domain IN (${part.map(() => "?").join(", ")})`)
      .bind(...part).all<{ domain: string; has_mail: number | null }>();
    for (const r of results) known.set(r.domain, r.has_mail);
  }

  // Walk the addresses in order; stop (and resume there next run) when the lookup budget is spent.
  let looked = 0, lastRid = from;
  const noMail: string[] = [];
  const saves: D1PreparedStatement[] = [];
  for (const r of rows) {
    const d = domainOf(r.email);
    if (d && !FREEMAIL.has(d) && !known.has(d)) {
      if (looked >= LOOKUPS_PER_RUN) break;
      looked++;
      const mx = await dns(d, "MX");
      const answer = mailFromDns(mx, mx && mx.Status === 0 && !(mx.Answer ?? []).some((x) => x.type === 15) ? await dns(d, "A") : null);
      const has = answer === "mail" ? 1 : answer === "none" ? 0 : null;
      known.set(d, has);
      saves.push(env.DB.prepare(`INSERT OR REPLACE INTO email_domains (domain, has_mail, checked_at) VALUES (?, ?, datetime('now'))`).bind(d, has));
    }
    if (d && known.get(d) === 0) noMail.push(r.email.toLowerCase());
    lastRid = r.rid;
  }
  // Marked invalid for free; an address MillionVerifier already answered keeps its paid answer.
  for (const e of [...new Set(noMail)]) {
    saves.push(env.DB.prepare(
      `INSERT INTO email_checks (email, result, checked_at, error) VALUES (?, 'invalid', datetime('now'), 'No mail server for this domain (free check)')
       ON CONFLICT(email) DO UPDATE SET result = 'invalid', checked_at = datetime('now'), error = excluded.error WHERE email_checks.result IN ('queued', 'error')`,
    ).bind(e));
  }
  saves.push(env.DB.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('email_domain_rowid', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(String(lastRid)));
  for (let i = 0; i < saves.length; i += 90) await env.DB.batch(saves.slice(i, i + 90));
  return { looked, marked: noMail.length, more: lastRid < rows[rows.length - 1].rid || rows.length === ROWS_PER_RUN };
}
