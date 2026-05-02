/**
 * Corpus schema version. Bump on any schema change.
 * Stamped on every row that has a schema-version-relevant column.
 *
 * History:
 * - 1.0.0 (Slice 2.0): initial six-table schema per pharos-corpus-layer-spec.md §3.
 * - 1.1.0 (Slice 3b): citation_audit_response table for Dim 6 DIY Citation Audit
 *                     (one row per scan_id × query × model trial). Adds the
 *                     unmeasurable + truncated flag columns. Engine version
 *                     `dim6:v1` stamped per row at write time.
 */
export const CORPUS_SCHEMA_VERSION = "1.1.0";
