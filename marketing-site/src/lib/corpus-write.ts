// Audit-fulfill -> corpus glue.
//
// Maps the in-memory AuditResult + SessionRecord shape to corpus inputs and
// fans out the three writes (scan_event + scan_finding + scan_recommendation)
// in order. Idempotent on session_id: scan_event.scan_id is set to session_id,
// so a fulfill-retry against the same session is a silent no-op via
// INSERT OR IGNORE rather than a duplicate row.
//
// Failure semantics: errors propagate to the caller. The route handler in
// audit-fulfill/route.ts wraps the call in try/catch and writes to
// CORPUS_DEAD_LETTER on failure — the customer Audit always ships regardless.
//
// engine_version stamped on the scan_event + scan_recommendation rows is the
// audit-fulfill REMEDIATION_ENGINE_VERSION_TAG. NOT the scanner's scoring
// version (separate namespace; recoverable via the linked source_scan_id).

import { CorpusClient } from "../../../corpus/src/client";
import type {
  ScanEventInput,
  ScanFindingInput,
  ScanRecommendationInput,
} from "../../../corpus/src/types";
import type { AuditResult, SessionRecord } from "./audit-types";

// Forbidden-path / "under 30 minutes" extractor. The remediation prompt asks
// the model to end with `Estimated effort: <duration>.` so we can recover the
// effort string without a re-parse of the LLM. Fall back to null on miss.
const EFFORT_RE = /Estimated effort:\s*([^.]+)\./i;

function extractEffort(remediation: string): string | null {
  const m = remediation.match(EFFORT_RE);
  return m ? m[1].trim() : null;
}

function findingsFromAudit(
  audit: AuditResult
): { gapKey: string; input: ScanFindingInput }[] {
  // We need stable keys to map a finding row -> a recommendation row by
  // finding_ids. Use `${dimension_id}:${check_id}` as the in-memory key.
  return audit.gaps.map((g) => ({
    gapKey: `${g.dimension_id}:${g.check_id}`,
    input: {
      dimension_id: g.dimension_id,
      dimension_name: g.dimension_name,
      check_id: g.check_id,
      check_name: g.check_name,
      score: g.score,
      weight: g.weight,
      notes: g.notes,
      evidence: {
        url: audit.scan.url,
        scan_id: audit.scan.id,
        composite: audit.scan.composite,
      },
    },
  }));
}

function recommendationsFromAudit(
  audit: AuditResult,
  findingIdByKey: Map<string, string>
): ScanRecommendationInput[] {
  return audit.gaps.map((g) => {
    const key = `${g.dimension_id}:${g.check_id}`;
    const findingId = findingIdByKey.get(key);
    return {
      finding_ids: findingId ? [findingId] : [],
      check_id: g.check_id,
      // subject is also in CHECK_SUBJECTS in audit-pipeline.ts; we don't
      // re-import it here to keep the mapping module thin. The full subject
      // is recoverable from the recommendation_payload (the prompt grounds
      // every output on it) and from check_id via the canonical map.
      subject: null,
      recommendation_payload: g.remediation,
      estimated_effort: extractEffort(g.remediation),
      // We don't currently distinguish "fallback_template" vs "llm" at the
      // call boundary. v1 tags everything 'llm'; the templated-fallback
      // pattern in audit-pipeline can be wired through later.
      source: "llm",
    };
  });
}

export type WriteAuditToCorpusInput = {
  sessionRecord: SessionRecord;
  audit: AuditResult;
};

/**
 * Write a completed Audit's scan_event + findings + recommendations to the
 * corpus. The scan_event row's scan_id IS the audit session_id (Option 1
 * from the design discussion: deterministic id, natural idempotency via
 * INSERT OR IGNORE, no separate dedup query).
 *
 * Returns the scan_id (== session_id) on success. Throws on D1 errors —
 * caller handles dead-letter.
 */
export async function writeAuditToCorpus(
  db: D1Database,
  engineVersion: string,
  input: WriteAuditToCorpusInput
): Promise<string> {
  const { sessionRecord, audit } = input;
  const corpus = new CorpusClient(db, engineVersion);

  const scanEventInput: ScanEventInput = {
    scan_id: sessionRecord.session_id, // deterministic; idempotent on retry
    customer_id: null, // V1: no customer-id concept yet beyond email
    url: audit.scan.url,
    tier: "audit",
    source_scan_id: sessionRecord.source_scan_id ?? null,
    consent_basis: "paid_optin",
    status: "recommendations_complete",
    score_pre: audit.scan.composite.score,
    score_post: null,
    metadata: {
      email: sessionRecord.email,
      grade: audit.scan.composite.grade,
      dimensions_scored: audit.scan.dimensions_scored,
      dimensions_total: audit.scan.dimensions_total,
      scanner_scan_id: audit.scan.id,
    },
  };

  const scanId = await corpus.recordScanEvent(scanEventInput);

  const findingPairs = findingsFromAudit(audit);
  const findingIds = await corpus.recordFindings(
    scanId,
    findingPairs.map((p) => p.input)
  );

  // Map gapKey -> finding_id so recommendations link cleanly.
  const findingIdByKey = new Map<string, string>();
  findingPairs.forEach((p, i) => {
    const id = findingIds[i];
    if (id !== undefined) findingIdByKey.set(p.gapKey, id);
  });

  await corpus.recordRecommendations(
    scanId,
    recommendationsFromAudit(audit, findingIdByKey)
  );

  return scanId;
}
