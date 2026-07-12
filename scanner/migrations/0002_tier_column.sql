-- P0-C2 prerequisite: first-class `tier` column on scans.
-- Additive, nullable. NULL = unclassified / quarantined (backfilled separately
-- from a json_valid-guarded results_json.$.tier; a NULL among otherwise-eligible
-- rows fail-closes the retention enforce gate rather than defaulting to free).
-- CHECK constrains the domain. If D1 rejects CHECK-in-ADD-COLUMN, STOP for
-- review — do not substitute an unconstrained column (the constraint is the
-- invariant). The node:sqlite invariant test confirms this statement applies.
ALTER TABLE scans ADD COLUMN tier TEXT CHECK (tier IN ('free','paid') OR tier IS NULL);
