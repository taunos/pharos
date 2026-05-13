-- Pre-flight discipline: if column already present (retry after partial deploy), this errors
-- with "duplicate column name: brand_name". Operator MUST verify §4.2 PRAGMA shows the column
-- absent BEFORE running §4.3. If §4.2 already shows brand_name at cid=8, skip §4.3.
ALTER TABLE customer_probe_targets ADD COLUMN brand_name TEXT NOT NULL DEFAULT '';
