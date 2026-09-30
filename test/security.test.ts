import { describe, expect, it } from "vitest";
import { checkWebhookUrl, finishedBatch, isPrivateAddress, retryDelayMinutes, signBody, webhookHeaders } from "../src/api-keys";
import { accountAttemptKey, updateUser, type User } from "../src/auth";

describe("webhook addresses", () => {
  it("accepts ordinary public https addresses", () => {
    expect(checkWebhookUrl("https://hooks.zapier.com/abc")).toBe("https://hooks.zapier.com/abc");
    expect(checkWebhookUrl("https://8.8.8.8/x")).toBe("https://8.8.8.8/x");
    expect(checkWebhookUrl("https://172.32.0.1/x")).toBe("https://172.32.0.1/x");
    expect(checkWebhookUrl("https://[2606:4700::1111]/x")).toBe("https://[2606:4700::1111]/x");
  });

  it.each([
    "http://hooks.zapier.com/abc",
    "https://localhost/x", "https://localhost./x", "https://app.localhost/x", "https://intranet/x",
    "https://printer.local/x", "https://db.internal/x", "https://nas.home.arpa/x",
    "https://127.0.0.1/x", "https://10.1.2.3/x", "https://192.168.1.4/x", "https://169.254.169.254/x",
    "https://172.16.0.1/x", "https://172.31.255.255/x", "https://100.64.0.1/x", "https://100.127.1.1/x",
    "https://0.0.0.0/x", "https://224.0.0.1/x", "https://255.255.255.255/x",
    // Odd spellings of 127.0.0.1 / 10.0.0.1
    "https://2130706433/x", "https://0x7f000001/x", "https://0x7f.1/x", "https://0177.0.0.1/x", "https://127.1/x", "https://012.0.0.1/x",
    // IPv6 loopback, private, link-local, mapped, unspecified, multicast
    "https://[::1]/x", "https://[::]/x", "https://[fc00::1]/x", "https://[fd12:3456::1]/x", "https://[fe80::1]/x",
    "https://[::ffff:127.0.0.1]/x", "https://[ff02::1]/x", "https://[2001:db8::1]/x",
    "https://user:pw@hooks.zapier.com/x",
    "not a url",
  ])("refuses %s", (url) => {
    expect(() => checkWebhookUrl(url)).toThrow();
  });

  it("knows which IPv4 addresses aren't public", () => {
    expect(isPrivateAddress("172.15.255.255")).toBe(false);
    expect(isPrivateAddress("172.16.0.0")).toBe(true);
    expect(isPrivateAddress("100.63.255.255")).toBe(false);
    expect(isPrivateAddress("100.128.0.0")).toBe(false);
    expect(isPrivateAddress("1.1.1.1")).toBe(false);
    expect(isPrivateAddress("example.com")).toBe(false);
  });
});

describe("webhook signing", () => {
  it("signs '<timestamp>.<body>' and sends the timestamp in seconds", async () => {
    const body = '{"event":"search.finished"}';
    const h = await webhookHeaders("whsec_test", "search.finished", body, 1_700_000_000_123);
    expect(h["X-LeadFinder-Timestamp"]).toBe("1700000000");
    expect(h["X-LeadFinder-Event"]).toBe("search.finished");
    expect(h["X-LeadFinder-Signature"]).toBe(await signBody("whsec_test", `1700000000.${body}`));
    expect(h["X-LeadFinder-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    // A different time gives a different signature, so an old call can't be replayed as new.
    const later = await webhookHeaders("whsec_test", "search.finished", body, 1_700_000_600_000);
    expect(later["X-LeadFinder-Signature"]).not.toBe(h["X-LeadFinder-Signature"]);
  });

  it("waits 1, 5, 30, 120, 480 minutes between retries, then gives up", () => {
    expect([1, 2, 3, 4, 5, 6].map(retryDelayMinutes)).toEqual([1, 5, 30, 120, 480, null]);
  });
});

describe("search.finished batches", () => {
  const row = (id: number, finished_at: string) => ({ id, finished_at });

  it("sends everything and moves the marker to the last one when the batch isn't full", () => {
    expect(finishedBatch([], 3)).toEqual({ emit: [], next: null });
    const rows = [row(1, "2026-01-01 10:00:00"), row(2, "2026-01-01 10:00:05")];
    expect(finishedBatch(rows, 3)).toEqual({ emit: rows, next: "2026-01-01 10:00:05" });
  });

  it("stops at the last one sent when the batch is full, holding back ties", () => {
    const rows = [row(1, "2026-01-01 10:00:00"), row(2, "2026-01-01 10:00:01"), row(3, "2026-01-01 10:00:01")];
    expect(finishedBatch(rows, 3)).toEqual({ emit: [rows[0]], next: "2026-01-01 10:00:00" });
    const same = [row(1, "2026-01-01 10:00:01"), row(2, "2026-01-01 10:00:01")];
    expect(finishedBatch(same, 2)).toEqual({ emit: same, next: "2026-01-01 10:00:01" });
  });
});

describe("sign-in limits", () => {
  it("counts an account's tries per network", () => {
    expect(accountAttemptKey("u1", "1.2.3.4")).toBe("acct:u1|1.2.3.4");
    expect(accountAttemptKey("u1", "5.6.7.8")).not.toBe(accountAttemptKey("u1", "1.2.3.4"));
    expect(accountAttemptKey("u1", undefined)).toBe("acct:u1|unknown");
  });
});

describe("changing team members", () => {
  const person = (id: string, role: User["role"]): User =>
    ({ id, email: `${id}@x.com`, name: id, role, active: 1, must_change_password: 0, last_login_at: null, created_at: "" });
  // Just enough of D1 for updateUser: the target lookup, and a record of what would be written.
  const fakeEnv = (target: User) => {
    const writes: string[] = [];
    const stmt = (sql: string) => ({ bind: () => ({ first: async () => (sql.startsWith("SELECT") ? target : null), sql }) });
    const env = { DB: { prepare: stmt, batch: async (s: { sql: string }[]) => { writes.push(...s.map((x) => x.sql)); return []; } } };
    return { env: env as unknown as Env, writes };
  };

  it("an admin can't reset or demote another admin", async () => {
    const { env, writes } = fakeEnv(person("a2", "admin"));
    await expect(updateUser(env, person("a1", "admin"), "a2", { password: "a-new-password-123" })).rejects.toThrow(/super admin/);
    await expect(updateUser(env, person("a1", "admin"), "a2", { role: "member" })).rejects.toThrow(/super admin/);
    await expect(updateUser(env, person("a1", "admin"), "a2", { active: false })).rejects.toThrow(/super admin/);
    expect(writes).toEqual([]);
  });

  it("the super admin can change an admin, and an admin can still manage members", async () => {
    const a = fakeEnv(person("a2", "admin"));
    await updateUser(a.env, person("owner", "super_admin"), "a2", { role: "member" });
    expect(a.writes.length).toBe(1);
    const m = fakeEnv(person("m1", "member"));
    await updateUser(m.env, person("a1", "admin"), "m1", { active: false });
    expect(m.writes.length).toBe(2);
  });
});
