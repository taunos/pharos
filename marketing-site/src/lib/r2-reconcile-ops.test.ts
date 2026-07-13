// P0-C2 Chunk F1 — marketing R2 reconciliation ops proofs.
import { describe, it, expect, vi } from "vitest";
import { deleteArtifact, purgePrefix, validVersionedArtifactKey, validScanPrefix, R2OpError } from "./r2-reconcile-ops";

const SCAN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PREFIX = `score-reports/${SCAN}/`;
const key = (n: number) => `score-reports/${SCAN}/0123456789abcdef/${n}.pdf`;

// Stateful mock bucket with a capped page size to exercise pagination.
function makeBucket(initial: string[], pageSize = 1000, opts: { deleteNoop?: boolean } = {}) {
  const store = new Set(initial);
  return {
    store,
    list: vi.fn(async ({ prefix }: { prefix: string; limit?: number }) => {
      const objects = [...store].filter((k) => k.startsWith(prefix)).slice(0, pageSize).map((k) => ({ key: k }));
      return { objects };
    }),
    delete: vi.fn(async (k: string) => {
      if (!opts.deleteNoop) store.delete(k);
    }),
  };
}
const asBucket = (b: ReturnType<typeof makeBucket>) => b as unknown as R2Bucket;

describe("key/prefix validation", () => {
  it("exact-delete accepts ONLY the versioned form; rejects legacy + others", () => {
    expect(validVersionedArtifactKey(key(1))).toBe(true);
    expect(validVersionedArtifactKey(`score-reports/${SCAN}/deadbeefdeadbeef.pdf`)).toBe(false); // legacy → prefix-purge only
    expect(validVersionedArtifactKey(`score-reports/${SCAN}/0123456789abcdef/0.pdf`)).toBe(false); // fence must be positive
    expect(validVersionedArtifactKey(`score-reports/${SCAN}/nothex0123456/1.pdf`)).toBe(false); // hash must be 16 hex
    expect(validVersionedArtifactKey(`score-reports/not-a-uuid/0123456789abcdef/1.pdf`)).toBe(false);
    expect(validVersionedArtifactKey(`audits/${SCAN}/0123456789abcdef/1.pdf`)).toBe(false);
  });
  it("accepts only the exact scan-scoped purge prefix", () => {
    expect(validScanPrefix(PREFIX)).toBe(true);
    expect(validScanPrefix(`score-reports/${SCAN}`)).toBe(false); // no trailing slash
    expect(validScanPrefix(`score-reports/${SCAN}/x/`)).toBe(false);
    expect(validScanPrefix(`score-reports/not-a-uuid/`)).toBe(false);
  });
});

describe("deleteArtifact", () => {
  it("validates the key then deletes (idempotent)", async () => {
    const b = makeBucket([key(1)]);
    const r = await deleteArtifact(asBucket(b), key(1));
    expect(r.status).toBe("deleted");
    expect(b.delete).toHaveBeenCalledWith(key(1));
    // deleting a now-missing key still succeeds
    await expect(deleteArtifact(asBucket(b), key(1))).resolves.toEqual({ status: "deleted" });
  });
  it("rejects a malformed key without touching R2", async () => {
    const b = makeBucket([]);
    await expect(deleteArtifact(asBucket(b), "audits/x.pdf")).rejects.toBeInstanceOf(R2OpError);
    expect(b.delete).not.toHaveBeenCalled();
  });
});

describe("purgePrefix", () => {
  it("multi-page: re-lists from the start until an empty page; deletes every object", async () => {
    const b = makeBucket([key(1), key(2), key(3), key(4), key(5)], 2); // 5 objects, 2 per page
    const r = await purgePrefix(asBucket(b), PREFIX);
    expect(r.purged).toBe(5);
    expect(b.store.size).toBe(0);
    // pages: 2,2,1, then an empty page terminates → 4 list calls
    expect(b.list).toHaveBeenCalledTimes(4);
  });
  it("rejects a malformed prefix", async () => {
    const b = makeBucket([]);
    await expect(purgePrefix(asBucket(b), `score-reports/${SCAN}`)).rejects.toBeInstanceOf(R2OpError);
    expect(b.delete).not.toHaveBeenCalled();
  });
  it("iteration cap halts fail-closed when the prefix never drains", async () => {
    const b = makeBucket([key(1)], 1, { deleteNoop: true }); // list never empties
    await expect(purgePrefix(asBucket(b), PREFIX, { maxIterations: 3 })).rejects.toThrow("iteration_cap");
  });
  it("object cap halts fail-closed", async () => {
    const b = makeBucket([key(1), key(2), key(3)], 1000);
    await expect(purgePrefix(asBucket(b), PREFIX, { maxObjects: 2 })).rejects.toThrow("object_cap");
  });
  it("an empty prefix returns purged=0 after one empty page", async () => {
    const b = makeBucket([]);
    const r = await purgePrefix(asBucket(b), PREFIX);
    expect(r.purged).toBe(0);
    expect(b.list).toHaveBeenCalledTimes(1);
  });
});
