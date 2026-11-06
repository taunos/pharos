-- 0004 — dim6_question_set: one stable Dim 6 question set per canonical domain.
-- Read/written by marketing-site/src/lib/dim6/question-set.ts.
--
-- The first paid Audit of a domain stores its validated generated question
-- set here; every later Audit of that domain reuses it, so Dim 6 score
-- changes reflect the site and the models, not question churn.
--
-- DESIGN NOTES:
-- - canonical_domain: lowercased hostname, trailing dot and one leading
--   "www." removed; no scheme/port/path (canonicalDomain() in question-set.ts).
-- - question_set_version: DIM6_QUESTION_SET_VERSION. Bumping it starts new
--   sets; old rows stay for the record. No expiry within a version.
-- - The primary key makes concurrent first Audits converge: the writer uses
--   INSERT OR IGNORE then reads the row back.
-- - queries_json is validated before insert and re-validated on every read.
-- - source: 'generated' | 'padded'. Pure bank fallbacks are never stored.
-- - No customer data: keyed on the domain only (no session, email or IP).
--
-- Additive: no existing table changes, so CORPUS_SCHEMA_VERSION (stamped on
-- corpus rows) is unchanged.

CREATE TABLE IF NOT EXISTS dim6_question_set (
  canonical_domain      TEXT NOT NULL,
  question_set_version  TEXT NOT NULL,
  queries_json          TEXT NOT NULL,
  source                TEXT NOT NULL,
  created_at            INTEGER NOT NULL,   -- epoch millis
  PRIMARY KEY (canonical_domain, question_set_version)
);
