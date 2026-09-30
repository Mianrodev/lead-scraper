import { describe, expect, it } from "vitest";
import { chunkFinished, findKnown, parseLines, searchFinished, type KnownLead } from "../src/free";
import { registryWaiting } from "../src/registry";

const lead = (over: Partial<{ googlePlaceId: string; phone: string | null; domain: string | null; city: string | null }> = {}) => ({
  googlePlaceId: "ovt:new", phone: null, domain: null, city: "Orlando", ...over,
});
const known = (over: Partial<KnownLead> = {}): KnownLead => ({ id: "k1", google_place_id: "ovt:old", phone: null, domain: null, city: "orlando", ...over });

describe("free saving: matching businesses we already have", () => {
  it("matches the same Overture id anywhere", () => {
    expect(findKnown([known({ google_place_id: "ovt:new", city: "tampa" })], lead())?.id).toBe("k1");
  });

  it("matches a local phone only in the same city (case and spaces ignored)", () => {
    const k = [known({ phone: "+14075551234", city: "orlando" })];
    expect(findKnown(k, lead({ phone: "+14075551234", city: " ORLANDO " }))?.id).toBe("k1");
    expect(findKnown(k, lead({ phone: "+14075551234", city: "Kissimmee" }))).toBeUndefined();
  });

  it("never matches on a toll-free number (a chain's shared line)", () => {
    const k = [known({ phone: "+18005551234", city: "orlando" })];
    expect(findKnown(k, lead({ phone: "+18005551234" }))).toBeUndefined();
    expect(findKnown([known({ phone: "+18885550000" })], lead({ phone: "+18885550000" }))).toBeUndefined();
  });

  it("matches a website only in the same city", () => {
    const k = [known({ domain: "acme.com", city: "orlando" })];
    expect(findKnown(k, lead({ domain: "acme.com" }))?.id).toBe("k1");
    expect(findKnown(k, lead({ domain: "acme.com", city: "Miami" }))).toBeUndefined();
  });
});

describe("free saving: batches", () => {
  it("finishes a batch on the lines actually read, whatever count was sent", () => {
    expect(chunkFinished(250, 250)).toBe(true);
    expect(chunkFinished(240, 240)).toBe(true); // the collector said 250 but 240 lines arrived
    expect(chunkFinished(250, 1000)).toBe(false);
  });

  it("skips damaged lines instead of failing the whole batch", () => {
    const rows = parseLines(['{"id":"a","name":"A"}', "{broken", "null", '{"name":"no id"}', '{"id":"b","name":"B"}']);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("free saving: finishing searches", () => {
  it("finishes only when the collector is done and no batches are left", () => {
    expect(searchFinished({ status: "ingesting", leftChunks: 0, importStatus: "received" })).toBe(true);
    expect(searchFinished({ status: "scraping", leftChunks: 0, importStatus: "received" })).toBe(true);
    expect(searchFinished({ status: "ingesting", leftChunks: 1, importStatus: "received" })).toBe(false);
    expect(searchFinished({ status: "scraping", leftChunks: 0, importStatus: "collecting" })).toBe(false);
    expect(searchFinished({ status: "done", leftChunks: 0, importStatus: "received" })).toBe(false);
  });
});

describe("registry: waiting matches what is handed out", () => {
  it("doesn't count businesses without a name", async () => {
    const seen: string[] = [];
    const env = {
      DB: {
        prepare: (q: string) => {
          seen.push(q);
          const stmt = { bind: () => stmt, first: async () => null };
          return stmt;
        },
      },
    } as unknown as Env;
    await registryWaiting(env);
    const waitingQueries = seen.filter((q) => q.includes("registry_checked_at IS NULL"));
    expect(waitingQueries.length).toBeGreaterThan(0);
    for (const q of waitingQueries) expect(q).toContain("business_name IS NOT NULL");
  });
});
