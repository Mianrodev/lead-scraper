import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { BACKUP_TABLES, rowsPerFile, stepTries } from "../src/backup";
import { afterBadAnswer, CLAIM_EMAILS_SQL, isFresh, QUEUE_EMAIL_SQL } from "../src/email-verify";
import { gbpScore, scoreChanged, scoreLead, type ScoreInput } from "../src/scoring";
import { AUDIT_UPSERT_SQL, CLAIM_SQL, MAX_REQUEUES, WATCHDOG_SQL } from "../src/website-audit";
import { FOLD_COLUMNS, FOLD_CRM_SQL, foldBinds, type FoldFields } from "../src/google-details";

// The project is typed for Workers, not Node, so the file reading is typed by hand here.
const fs = (await import("node:" + "fs")) as { readdirSync(p: string): string[]; readFileSync(p: string, enc: "utf8"): string };
const migration = (f: string) => fs.readFileSync(`migrations/${f}`, "utf8"); // tests run from the project folder
const migrationFiles = () => fs.readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();

/** The real schema: every migration run in order on an empty SQLite database. */
function schema(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const f of migrationFiles()) db.exec(migration(f));
  return db;
}

describe("backups", () => {
  it("copies every table with the team's own data, parents before children", () => {
    const created = migrationFiles().flatMap((f) => [...migration(f).matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/gi)].map((m) => m[1]));
    for (const t of BACKUP_TABLES) expect(created).toContain(t);
    for (const t of ["suppressions", "lead_notes", "lead_events", "website_audits", "email_checks", "saved_searches", "free_harvest", "webhooks", "api_keys", "free_imports"]) {
      expect(BACKUP_TABLES).toContain(t);
    }
    const at = (t: string) => BACKUP_TABLES.indexOf(t as (typeof BACKUP_TABLES)[number]);
    expect(at("searches")).toBeLessThan(at("leads"));
    for (const child of ["search_leads", "lead_emails", "lead_phones", "website_audits", "lead_notes", "lead_events"]) expect(at("leads")).toBeLessThan(at(child));
  });

  it("keeps each step small", () => {
    expect(rowsPerFile("leads")).toBeLessThanOrEqual(100);
    expect(rowsPerFile("lead_emails")).toBeLessThanOrEqual(500);
  });

  it("counts tries of a step at the same place only", () => {
    expect(stepTries(null, "leads", 0)).toBe(0);
    expect(stepTries("Copying leads from row 1200 (try 2)", "leads", 1200)).toBe(2);
    expect(stepTries("Copying leads from row 1200 (try 2)", "leads", 1300)).toBe(0);
    expect(stepTries("Copying leads from row 1200 (try 2)", "search_leads", 1200)).toBe(0);
    expect(stepTries("some old error", "leads", 1200)).toBe(0);
  });
});

describe("email verification", () => {
  const cutoff = "2026-07-01 00:00:00";
  it("knows which addresses don't need a (paid) check", () => {
    expect(isFresh(undefined, cutoff)).toBe(false);
    expect(isFresh({ result: "queued", checked_at: null }, cutoff)).toBe(true);
    expect(isFresh({ result: "ok", checked_at: "2026-09-01 10:00:00" }, cutoff)).toBe(true);
    expect(isFresh({ result: "ok", checked_at: "2026-01-01 10:00:00" }, cutoff)).toBe(false);
    expect(isFresh({ result: "invalid", checked_at: "2025-01-01 10:00:00" }, cutoff)).toBe(true); // stays out of downloads
    expect(isFresh({ result: "error", checked_at: "2026-09-01 10:00:00" }, cutoff)).toBe(false);
  });

  it("retries an unreadable answer, then gives up as unknown", () => {
    const a = afterBadAnswer(null, null);
    expect(a).toEqual({ giveUp: false, error: "try 1: unexpected answer" });
    const b = afterBadAnswer(a.error, "bad gateway");
    expect(b).toEqual({ giveUp: false, error: "try 2: bad gateway" });
    expect(afterBadAnswer(b.error, "bad gateway").giveUp).toBe(true);
  });

  it("claims addresses once, and re-queuing keeps a known bounce (real SQLite)", () => {
    const db = schema();
    const q = db.prepare(QUEUE_EMAIL_SQL);
    for (const e of ["a@x.com", "b@x.com", "c@x.com"]) q.run(e);
    db.exec(`UPDATE email_checks SET queued_at = datetime('now', '-1 minute')`);
    const first = db.prepare(CLAIM_EMAILS_SQL).all(2) as { email: string }[];
    const second = db.prepare(CLAIM_EMAILS_SQL).all(5) as { email: string }[];
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(1);
    expect(first.map((r) => r.email)).not.toContain(second[0].email);
    expect(db.prepare(CLAIM_EMAILS_SQL).all(5)).toHaveLength(0); // all taken for the lease

    db.exec(`INSERT INTO email_checks (email, result, checked_at) VALUES ('bad@x.com', 'invalid', '2025-01-01 00:00:00'), ('old@x.com', 'ok', '2025-01-01 00:00:00')`);
    q.run("bad@x.com");
    q.run("old@x.com");
    const rows = db.prepare(`SELECT email, result FROM email_checks WHERE email IN ('bad@x.com', 'old@x.com') ORDER BY email`).all();
    expect(rows).toEqual([{ email: "bad@x.com", result: "invalid" }, { email: "old@x.com", result: "queued" }]);
  });
});

describe("scores", () => {
  const base: ScoreInput = {
    dataSource: "form", isClaimed: null, website: null, websiteDomain: null, phone: "+14075550199",
    rating: null, reviewCount: null, photosCount: null, hasHours: false, hasDescription: false, attributesCount: 0,
  };

  it("gives website-form requests no Google profile score or Google advice", () => {
    expect(gbpScore(base)).toBeNull();
    const s = scoreLead(base);
    expect(s.gbp).toBeNull();
    expect(s.notes.suggestions.join(" ")).not.toMatch(/Google reviews|Google profile|to Google/);
    expect(gbpScore({ ...base, dataSource: "google" })).not.toBeNull();
    expect(gbpScore({ ...base, dataSource: null })).not.toBeNull();
  });

  it("only writes a business whose scores or notes changed", () => {
    const s = scoreLead({ ...base, dataSource: "google" });
    const notes = JSON.stringify(s.notes);
    const cur = { cur_gbp: s.gbp, cur_website: s.website, cur_presence: s.presence, cur_notes: notes, cur_chain: 0 };
    expect(scoreChanged(cur, s, notes, 0)).toBe(false);
    expect(scoreChanged(cur, s, notes, 1)).toBe(true);
    expect(scoreChanged({ ...cur, cur_chain: 1 }, s, notes, 1)).toBe(false);
    expect(scoreChanged({ ...cur, cur_gbp: (s.gbp ?? 0) + 1 }, s, notes, 0)).toBe(true);
    expect(scoreChanged({ ...cur, cur_notes: null }, s, notes, 0)).toBe(true);
  });
});

describe("website checks (real SQLite)", () => {
  it("gives up on a site that keeps stalling the checker", () => {
    const db = schema();
    db.exec(`INSERT INTO leads (id, google_place_id, website_domain, website_audit_status) VALUES ('a', 'p1', 'a.com', 'queued')`);
    const status = () => db.prepare(`SELECT website_audit_status AS s, website_audit_at AS at FROM leads WHERE id = 'a'`).all()[0] as { s: string; at: string };
    for (let i = 1; i <= MAX_REQUEUES; i++) {
      db.exec(`${CLAIM_SQL} WHERE id = 'a'`);
      expect(status().s).toBe("checking");
      db.exec(`UPDATE leads SET website_audit_at = '2000-01-01 00:00:00' || COALESCE(substr(website_audit_at, 20), '') WHERE id = 'a'`); // went stale
      db.prepare(WATCHDOG_SQL).run("-90 minutes");
      expect(status().s).toBe("queued");
      expect(status().at).toMatch(new RegExp(`^\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d #${i}$`));
    }
    db.exec(`${CLAIM_SQL} WHERE id = 'a'`);
    expect(status().at).toMatch(new RegExp(`#${MAX_REQUEUES}$`)); // the claim keeps the count
    db.exec(`UPDATE leads SET website_audit_at = '2000-01-01 00:00:00' || substr(website_audit_at, 20) WHERE id = 'a'`);
    db.prepare(WATCHDOG_SQL).run("-90 minutes");
    expect(status().s).toBe("failed");
  });

  it("updates a website check in place and clears the old speed result", () => {
    const db = schema();
    db.exec(`INSERT INTO leads (id, google_place_id) VALUES ('a', 'p1')`);
    const n = (AUDIT_UPSERT_SQL.match(/\?/g) ?? []).length;
    const values = (title: string) => ["a", ...Array.from({ length: n - 1 }, (_, i) => (i === 5 ? title : 0))];
    db.prepare(AUDIT_UPSERT_SQL).run(...values("First"));
    db.exec(`UPDATE website_audits SET psi_score = 55`);
    db.prepare(AUDIT_UPSERT_SQL).run(...values("Second"));
    expect(db.prepare(`SELECT COUNT(*) AS n, MAX(title) AS t, MAX(psi_score) AS p FROM website_audits`).all()[0]).toEqual({ n: 1, t: "Second", p: null });
  });
});

describe("folding a free business into Google's copy (real SQLite)", () => {
  it("keeps the team's work where Google's copy has none", () => {
    const db = schema();
    db.exec(`INSERT INTO leads (id, google_place_id, lead_status, assigned_to, owner_name, owner_title, owner_source, suppressed, report_token, report_views, report_viewed_at)
             VALUES ('free', 'p1', 'Contacted', 'u1', 'Ann Lee', 'Owner', 'website', 'client', 'tok1', 3, '2026-09-01 10:00:00'),
                    ('kept', 'p2', 'Untouched', NULL, NULL, NULL, NULL, NULL, NULL, 1, '2026-08-01 10:00:00'),
                    ('busy', 'p3', 'Won', 'u2', 'Bob', 'CEO', 'registry', NULL, 'tok2', 0, NULL)`);
    const crm = db.prepare(`SELECT ${FOLD_COLUMNS.join(", ")} FROM leads WHERE id = 'free'`).all()[0] as FoldFields;
    db.exec(`UPDATE leads SET report_token = NULL WHERE id = 'free'`);
    db.prepare(FOLD_CRM_SQL).run(...foldBinds(crm), "kept");
    db.prepare(FOLD_CRM_SQL).run(...foldBinds(crm), "busy");
    const rows = db.prepare(`SELECT id, lead_status, assigned_to, owner_name, owner_source, suppressed, report_token, report_views, report_viewed_at FROM leads WHERE id IN ('kept', 'busy') ORDER BY id`).all();
    expect(rows).toEqual([
      { id: "busy", lead_status: "Won", assigned_to: "u2", owner_name: "Bob", owner_source: "registry", suppressed: "client", report_token: "tok2", report_views: 3, report_viewed_at: "2026-09-01 10:00:00" },
      { id: "kept", lead_status: "Contacted", assigned_to: "u1", owner_name: "Ann Lee", owner_source: "website", suppressed: "client", report_token: "tok1", report_views: 4, report_viewed_at: "2026-09-01 10:00:00" },
    ]);
  });
});
