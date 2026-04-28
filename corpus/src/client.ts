// Pharos Corpus — typed write client.
//
// Imported by paid-tier writer services (audit-fulfill today; future
// Implementation pipeline; future AutoPilot rescan job). Each writer binds
// its own D1 connection. Per pharos-corpus-layer-spec.md §2.4 the scanner
// Worker MUST NOT import this client because it MUST NOT bind pharos_corpus.
//
// Idempotency: callers may pass a deterministic `scan_id` on
// recordScanEvent (e.g. audit-fulfill passes the audit session_id). The
// underlying INSERT uses OR IGNORE so a duplicate session re-running fulfill
// is a silent no-op rather than a constraint error or duplicate row.
//
// Failure semantics: errors propagate. Callers wrap in try/catch + dead-letter.

import { CORPUS_SCHEMA_VERSION } from "./version";
import type {
  ScanApplicationInput,
  ScanEventInput,
  ScanFindingInput,
  ScanOutcomeInput,
  ScanRecommendationInput,
  StrategistAnnotationInput,
} from "./types";

export class CorpusClient {
  constructor(
    private readonly db: D1Database,
    private readonly engineVersion: string
  ) {}

  /**
   * Insert a scan_event row. Returns the scan_id (either the caller-supplied
   * one or a freshly minted UUIDv4). Uses INSERT OR IGNORE so callers passing
   * a deterministic id (audit-fulfill: session_id) get natural idempotency.
   */
  async recordScanEvent(input: ScanEventInput): Promise<string> {
    const scanId = input.scan_id ?? crypto.randomUUID();
    const now = Date.now();
    const metadataJson =
      input.metadata == null ? null : JSON.stringify(input.metadata);

    await this.db
      .prepare(
        `INSERT OR IGNORE INTO scan_event (
          scan_id, customer_id, url, tier, source_scan_id, parent_scan_id,
          consent_basis, status, score_pre, score_post,
          engine_version, schema_version, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        scanId,
        input.customer_id ?? null,
        input.url,
        input.tier,
        input.source_scan_id ?? null,
        input.parent_scan_id ?? null,
        input.consent_basis,
        input.status,
        input.score_pre ?? null,
        input.score_post ?? null,
        this.engineVersion,
        CORPUS_SCHEMA_VERSION,
        metadataJson,
        now
      )
      .run();

    return scanId;
  }

  /**
   * Batch-insert scan_finding rows for a scan. Returns the finding_ids in the
   * same order as input. INSERT OR IGNORE keeps re-runs clean when callers
   * pass deterministic finding_ids; otherwise a fresh UUID per row.
   */
  async recordFindings(
    scanId: string,
    findings: ScanFindingInput[]
  ): Promise<string[]> {
    if (findings.length === 0) return [];
    const now = Date.now();
    const ids: string[] = [];
    const stmts = findings.map((f) => {
      const id = f.finding_id ?? crypto.randomUUID();
      ids.push(id);
      const evidenceJson =
        f.evidence == null ? null : JSON.stringify(f.evidence);
      return this.db
        .prepare(
          `INSERT OR IGNORE INTO scan_finding (
            finding_id, scan_id, dimension_id, dimension_name,
            check_id, check_name, score, weight, notes, evidence,
            schema_version, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          scanId,
          f.dimension_id,
          f.dimension_name,
          f.check_id,
          f.check_name,
          f.score,
          f.weight,
          f.notes,
          evidenceJson,
          CORPUS_SCHEMA_VERSION,
          now
        );
    });

    await this.db.batch(stmts);
    return ids;
  }

  /**
   * Batch-insert scan_recommendation rows. finding_ids passed as JSON array.
   */
  async recordRecommendations(
    scanId: string,
    recs: ScanRecommendationInput[]
  ): Promise<string[]> {
    if (recs.length === 0) return [];
    const now = Date.now();
    const ids: string[] = [];
    const stmts = recs.map((r) => {
      const id = r.recommendation_id ?? crypto.randomUUID();
      ids.push(id);
      return this.db
        .prepare(
          `INSERT OR IGNORE INTO scan_recommendation (
            recommendation_id, scan_id, finding_ids, check_id, subject,
            recommendation_payload, estimated_effort, source,
            engine_version, schema_version, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          scanId,
          JSON.stringify(r.finding_ids),
          r.check_id,
          r.subject ?? null,
          r.recommendation_payload,
          r.estimated_effort ?? null,
          r.source,
          this.engineVersion,
          CORPUS_SCHEMA_VERSION,
          now
        );
    });

    await this.db.batch(stmts);
    return ids;
  }

  async recordApplication(input: ScanApplicationInput): Promise<string> {
    const id = input.application_id ?? crypto.randomUUID();
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO scan_application (
          application_id, recommendation_id, scan_id, applied_payload,
          delivery_mode, applied_at, notes, schema_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.recommendation_id,
        input.scan_id,
        input.applied_payload,
        input.delivery_mode,
        input.applied_at ?? now,
        input.notes ?? null,
        CORPUS_SCHEMA_VERSION,
        now
      )
      .run();
    return id;
  }

  async recordOutcome(input: ScanOutcomeInput): Promise<string> {
    const id = input.outcome_id ?? crypto.randomUUID();
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO scan_outcome (
          outcome_id, application_id, rescan_id, score_delta,
          observed_at, notes, schema_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.application_id,
        input.rescan_id,
        input.score_delta ?? null,
        input.observed_at ?? now,
        input.notes ?? null,
        CORPUS_SCHEMA_VERSION,
        now
      )
      .run();
    return id;
  }

  async recordAnnotation(input: StrategistAnnotationInput): Promise<string> {
    const id = input.annotation_id ?? crypto.randomUUID();
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO strategist_annotation (
          annotation_id, scan_id, author, body, visibility,
          schema_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.scan_id,
        input.author,
        input.body,
        input.visibility,
        CORPUS_SCHEMA_VERSION,
        now
      )
      .run();
    return id;
  }
}

export { CORPUS_SCHEMA_VERSION } from "./version";
export type {
  AnnotationVisibility,
  ConsentBasis,
  DeliveryMode,
  RecommendationSource,
  ScanApplicationInput,
  ScanApplicationRow,
  ScanEventInput,
  ScanEventRow,
  ScanFindingInput,
  ScanFindingRow,
  ScanOutcomeInput,
  ScanOutcomeRow,
  ScanRecommendationInput,
  ScanRecommendationRow,
  ScanStatus,
  StrategistAnnotationInput,
  StrategistAnnotationRow,
  Tier,
} from "./types";
