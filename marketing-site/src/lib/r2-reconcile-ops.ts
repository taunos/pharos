// P0-C2 Chunk F1 — marketing-owned R2 reconciliation operations.
//
// Marketing owns R2 (AUDITS); scanner (the D1/registry owner) drives
// reconciliation and calls these over a Service Binding for the physical object
// deletes. Both ops are STRICTLY VALIDATED (UUID-scoped keys/prefixes only),
// BOUNDED (iteration + object caps, fail closed on overflow), and IDEMPOTENT
// (R2 delete of a missing object succeeds). Logs are fixed-class/count-only —
// never keys, ids, email hashes, or raw errors.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// The exact-delete primitive accepts ONLY the generated versioned form
// `score-reports/<uuid>/<16-hex email hash>/<positive fence>.pdf`. Legacy
// fallback deletion belongs to the UUID prefix-purge op, not the exact delete.
const VERSIONED_KEY_RE = new RegExp(`^score-reports/${UUID}/[0-9a-f]{16}/[1-9][0-9]*\\.pdf$`, "i");
// A scan-scoped purge prefix: score-reports/<uuid>/
const SCAN_PREFIX_RE = new RegExp(`^score-reports/${UUID}/$`, "i");

const PAGE_LIMIT = 1000;
export const DEFAULT_MAX_ITERATIONS = 10_000;
export const DEFAULT_MAX_OBJECTS = 1_000_000;

export const validVersionedArtifactKey = (key: unknown): key is string => typeof key === "string" && VERSIONED_KEY_RE.test(key);
export const validScanPrefix = (prefix: unknown): prefix is string => typeof prefix === "string" && SCAN_PREFIX_RE.test(prefix);

export class R2OpError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

// Exact single-object delete (idempotent). ONLY the versioned form is accepted.
export async function deleteArtifact(bucket: R2Bucket, key: unknown): Promise<{ status: "deleted" }> {
  if (!validVersionedArtifactKey(key)) throw new R2OpError("bad_key");
  await bucket.delete(key); // R2 delete is idempotent (missing object → success)
  return { status: "deleted" };
}

// UUID-scoped prefix purge: list → delete the page → RE-LIST FROM THE PREFIX START,
// repeating until a page returns zero objects. Bounded by iteration + object caps;
// throws (fail closed) on overflow so a runaway prefix never deletes unbounded.
export async function purgePrefix(
  bucket: R2Bucket,
  prefix: unknown,
  caps: { maxIterations?: number; maxObjects?: number } = {},
): Promise<{ status: "purged"; purged: number }> {
  if (!validScanPrefix(prefix)) throw new R2OpError("bad_prefix");
  const maxIterations = caps.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const maxObjects = caps.maxObjects ?? DEFAULT_MAX_OBJECTS;
  let iterations = 0;
  let purged = 0;
  for (;;) {
    if (++iterations > maxIterations) throw new R2OpError("iteration_cap");
    const listed = await bucket.list({ prefix: prefix as string, limit: PAGE_LIMIT });
    const objects = listed.objects ?? [];
    if (objects.length === 0) break; // empty page ⇒ prefix is drained
    for (const o of objects) {
      if (++purged > maxObjects) throw new R2OpError("object_cap");
      await bucket.delete(o.key);
    }
  }
  return { status: "purged", purged };
}
