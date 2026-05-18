-- F2 V-H Smoke Test Corpus — 10 cases verifying Stage 3 SQL semantics
-- Per `feedback_spec_drafting_pattern_analogy_trap.md` sub-pattern 3 discipline:
--   no SQL ships without empirical smoke-test pass on all branches.
-- Run against test D1: `npx wrangler d1 execute pharos-citation-tracking --local --file=pharos-f2-vh-smoke-test-corpus.sql`
-- Or interactively case-by-case for clearer debugging.
--
-- Schema assumption: customer_probe_targets per F3 0003_multi_tenant.sql:
--   customer_id TEXT UNIQUE NOT NULL
--   domain, brand_name, category, competitors TEXT
--   status TEXT CHECK(status IN ('active','paused')) NOT NULL DEFAULT 'active'
--   created_at, updated_at INTEGER
--
-- The Fix A INSERT-with-CHECK + ON CONFLICT pattern under test:
--   INSERT INTO customer_probe_targets (...)
--   SELECT ?, ?, ?, ?, ?, 'active', ?, ?
--   WHERE (SELECT COUNT(*) FROM customer_probe_targets WHERE status='active' AND customer_id != ?1) < 3
--   ON CONFLICT(customer_id) DO UPDATE SET status='active', updated_at=?;

-- ============================================================================
-- SETUP: reset state between cases
-- ============================================================================

-- Replace ? placeholders with literal values per case below
-- All cases assume: fresh start with `DELETE FROM customer_probe_targets;`

-- ============================================================================
-- CASE 1 — New customer, under capacity (2 active others)
-- Expected: changes=1, new row inserted, status='active'
-- ============================================================================

DELETE FROM customer_probe_targets;
INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at)
VALUES
  ('cus_existing_a', 'a.com', 'A', 'developer-tools', '[]', 'active', 1700000000, 1700000000),
  ('cus_existing_b', 'b.com', 'B', 'developer-tools', '[]', 'active', 1700000000, 1700000000);

-- The Fix A SQL with placeholders bound:
INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at)
SELECT 'cus_new_under', 'new.com', 'New', 'developer-tools', '[]', 'active', 1700000100, 1700000100
WHERE (SELECT COUNT(*) FROM customer_probe_targets WHERE status='active' AND customer_id != 'cus_new_under') < 3
ON CONFLICT(customer_id) DO UPDATE SET status='active', updated_at=1700000100;

-- Assertion (should return 1):
SELECT 'CASE 1 EXPECTED 1 ROW' AS marker, COUNT(*) AS row_count
FROM customer_probe_targets WHERE customer_id='cus_new_under' AND status='active';

-- ============================================================================
-- CASE 2 — New customer, at capacity (3 active others)
-- Expected: changes=0, no row inserted (correct rejection)
-- ============================================================================

DELETE FROM customer_probe_targets;
INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at)
VALUES
  ('cus_existing_a', 'a.com', 'A', 'developer-tools', '[]', 'active', 1700000000, 1700000000),
  ('cus_existing_b', 'b.com', 'B', 'developer-tools', '[]', 'active', 1700000000, 1700000000),
  ('cus_existing_c', 'c.com', 'C', 'developer-tools', '[]', 'active', 1700000000, 1700000000);

INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at)
SELECT 'cus_new_atcap', 'newatcap.com', 'NewAtCap', 'developer-tools', '[]', 'active', 1700000100, 1700000100
WHERE (SELECT COUNT(*) FROM customer_probe_targets WHERE status='active' AND customer_id != 'cus_new_atcap') < 3
ON CONFLICT(customer_id) DO UPDATE SET status='active', updated_at=1700000100;

-- Assertion (should return 0):
SELECT 'CASE 2 EXPECTED 0 ROWS' AS marker, COUNT(*) AS row_count
FROM customer_probe_targets WHERE customer_id='cus_new_atcap';

-- ============================================================================
-- CASE 3 — Existing-active customer, under capacity (this + 1 other = 2 active)
-- Expected: changes=1, ON CONFLICT UPDATE fires, status remains 'active'
-- ============================================================================

DELETE FROM customer_probe_targets;
INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at)
VALUES
  ('cus_existing_a', 'a.com', 'A', 'developer-tools', '[]', 'active', 1700000000, 1700000000),
  ('cus_returning', 'returning.com', 'Returning', 'developer-tools', '[]', 'active', 1700000000, 1700000000);

INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at)
SELECT 'cus_returning', 'returning.com', 'Returning', 'developer-tools', '[]', 'active', 1700000100, 1700000100
WHERE (SELECT COUNT(*) FROM customer_probe_targets WHERE status='active' AND customer_id != 'cus_returning') < 3
ON CONFLICT(customer_id) DO UPDATE SET status='active', updated_at=1700000100;

-- Assertion (should return 1 row, updated_at=1700000100):
SELECT 'CASE 3 EXPECTED 1 ROW STATUS=active updated_at=1700000100' AS marker,
       customer_id, status, updated_at
FROM customer_probe_targets WHERE customer_id='cus_returning';

-- ============================================================================
-- CASE 4 — Existing-active customer, at capacity (this + 2 others = 3 active)
-- Expected: changes=1, ON CONFLICT UPDATE fires (self-exclusion drops count to 2)
-- This is the F2+F3 dual-tier customer case D20 was designed for.
-- ============================================================================

DELETE FROM customer_probe_targets;
INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at)
VALUES
  ('cus_existing_a', 'a.com', 'A', 'developer-tools', '[]', 'active', 1700000000, 1700000000),
  ('cus_existing_b', 'b.com', 'B', 'developer-tools', '[]', 'active', 1700000000, 1700000000),
  ('cus_dualtier', 'dualtier.com', 'DualTier', 'developer-tools', '[]', 'active', 1700000000, 1700000000);

INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at)
SELECT 'cus_dualtier', 'dualtier.com', 'DualTier', 'developer-tools', '[]', 'active', 1700000100, 1700000100
WHERE (SELECT COUNT(*) FROM customer_probe_targets WHERE status='active' AND customer_id != 'cus_dualtier') < 3
ON CONFLICT(customer_id) DO UPDATE SET status='active', updated_at=1700000100;

-- Assertion (should return 1 row, status='active', updated_at=1700000100):
SELECT 'CASE 4 EXPECTED 1 ROW STATUS=active updated_at=1700000100' AS marker,
       customer_id, status, updated_at
FROM customer_probe_targets WHERE customer_id='cus_dualtier';

-- ============================================================================
-- CASE 5 — Existing-paused customer, at capacity (others fill 3 slots)
-- Expected: changes=0, INSERT no-ops (paused customer not in count;
-- but reactivating would push count to 4 → correct rejection)
-- ============================================================================

DELETE FROM customer_probe_targets;
INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at)
VALUES
  ('cus_existing_a', 'a.com', 'A', 'developer-tools', '[]', 'active', 1700000000, 1700000000),
  ('cus_existing_b', 'b.com', 'B', 'developer-tools', '[]', 'active', 1700000000, 1700000000),
  ('cus_existing_c', 'c.com', 'C', 'developer-tools', '[]', 'active', 1700000000, 1700000000),
  ('cus_paused_reactivate', 'paused.com', 'Paused', 'developer-tools', '[]', 'paused', 1700000000, 1700000000);

INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at)
SELECT 'cus_paused_reactivate', 'paused.com', 'Paused', 'developer-tools', '[]', 'active', 1700000100, 1700000100
WHERE (SELECT COUNT(*) FROM customer_probe_targets WHERE status='active' AND customer_id != 'cus_paused_reactivate') < 3
ON CONFLICT(customer_id) DO UPDATE SET status='active', updated_at=1700000100;

-- Assertion (should return 1 row STILL PAUSED — reactivation rejected):
SELECT 'CASE 5 EXPECTED status=paused (REJECTED)' AS marker,
       customer_id, status, updated_at
FROM customer_probe_targets WHERE customer_id='cus_paused_reactivate';

-- ============================================================================
-- CASE 6 — Existing-paused customer, under capacity (others fill 2 slots; reactivation OK)
-- Expected: changes=1, ON CONFLICT UPDATE fires, status flips to 'active'
-- ============================================================================

DELETE FROM customer_probe_targets;
INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at)
VALUES
  ('cus_existing_a', 'a.com', 'A', 'developer-tools', '[]', 'active', 1700000000, 1700000000),
  ('cus_existing_b', 'b.com', 'B', 'developer-tools', '[]', 'active', 1700000000, 1700000000),
  ('cus_paused_can_reactivate', 'paused2.com', 'Paused2', 'developer-tools', '[]', 'paused', 1700000000, 1700000000);

INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at)
SELECT 'cus_paused_can_reactivate', 'paused2.com', 'Paused2', 'developer-tools', '[]', 'active', 1700000100, 1700000100
WHERE (SELECT COUNT(*) FROM customer_probe_targets WHERE status='active' AND customer_id != 'cus_paused_can_reactivate') < 3
ON CONFLICT(customer_id) DO UPDATE SET status='active', updated_at=1700000100;

-- Assertion (should return 1 row, status='active' — reactivated):
SELECT 'CASE 6 EXPECTED status=active updated_at=1700000100 (REACTIVATED)' AS marker,
       customer_id, status, updated_at
FROM customer_probe_targets WHERE customer_id='cus_paused_can_reactivate';

-- ============================================================================
-- CASE 7-10: Overlapping F2 status filter cases (Day-91 sweep Step 2)
-- These verify the Codex MED fix at v6 §0.2:
--   AND customer_id NOT IN (
--     SELECT i2.customer_id FROM implementation_sessions i2
--     WHERE i2.status='active' AND i2.bundle_expires_at >= ? AND i2.bundle_expired_at IS NULL
--   )
-- Schema assumption: implementation_sessions per F2 0008_implementation_sessions.sql
-- ============================================================================

-- CASE 7 — Older F2 expired + newer F2 status='active' AND within bundle window
-- Expected: probe stays active (newer F2 keeps it alive)
-- (Note: probe pause assertion runs the actual Day-91 sweep SQL)

DELETE FROM customer_probe_targets;
DELETE FROM implementation_sessions;
-- Setup: shared customer has F2 older (expired) + F2 newer (active, within window) + probe-target active
INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at)
VALUES ('cus_overlap_alive', 'overlap.com', 'Overlap', 'developer-tools', '[]', 'active', 1700000000, 1700000000);
INSERT INTO implementation_sessions (session_id, dodo_payment_id, customer_email, customer_domain, brand_name, category, competitors, customer_id, status, payment_succeeded_at, bundle_expires_at, bundle_expired_at, created_at, updated_at)
VALUES
  ('impl-older', 'pay_older', 'a@x.com', 'overlap.com', 'Overlap', 'developer-tools', '[]', 'cus_overlap_alive', 'active', 1690000000, 1697000000, 1697000001, 1690000000, 1697000001),  -- older expired
  ('impl-newer', 'pay_newer', 'a@x.com', 'overlap.com', 'Overlap', 'developer-tools', '[]', 'cus_overlap_alive', 'active', 1700000000, 1707000000, NULL, 1700000000, 1700000000);  -- newer active, within window (assumes NOW=1700000100)

-- Run Day-91 sweep Step 2 (with NOW = 1700000100):
UPDATE customer_probe_targets
SET status = 'paused', updated_at = 1700000100
WHERE customer_id IN (
  SELECT i.customer_id FROM implementation_sessions i
  WHERE i.bundle_expires_at < 1700000100 AND i.bundle_expired_at IS NOT NULL
)
AND customer_id NOT IN (
  SELECT s.customer_id FROM subscriptions s WHERE s.status = 'active'
)
AND customer_id NOT IN (
  SELECT i2.customer_id FROM implementation_sessions i2
  WHERE i2.status='active' AND i2.bundle_expires_at >= 1700000100 AND i2.bundle_expired_at IS NULL
);

-- Assertion (should return status='active' — newer F2 keeps alive):
SELECT 'CASE 7 EXPECTED status=active (newer F2 keeps probe alive)' AS marker,
       customer_id, status
FROM customer_probe_targets WHERE customer_id='cus_overlap_alive';

-- ============================================================================
-- CASE 8 — Older F2 expired + newer F2 status='queued' (not yet fulfilled)
-- Expected: probe paused (queued F2 doesn't count as active entitlement)
-- ============================================================================

DELETE FROM customer_probe_targets;
DELETE FROM implementation_sessions;
INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at)
VALUES ('cus_overlap_queued', 'overlap2.com', 'Overlap2', 'developer-tools', '[]', 'active', 1700000000, 1700000000);
INSERT INTO implementation_sessions (session_id, dodo_payment_id, customer_email, customer_domain, brand_name, category, competitors, customer_id, status, payment_succeeded_at, bundle_expires_at, bundle_expired_at, created_at, updated_at)
VALUES
  ('impl-older2', 'pay_older2', 'a@x.com', 'overlap2.com', 'Overlap2', 'developer-tools', '[]', 'cus_overlap_queued', 'active', 1690000000, 1697000000, 1697000001, 1690000000, 1697000001),
  ('impl-newer2', 'pay_newer2', 'a@x.com', 'overlap2.com', 'Overlap2', 'developer-tools', '[]', 'cus_overlap_queued', 'queued', 1700000050, 1707000000, NULL, 1700000050, 1700000050);  -- newer is QUEUED

UPDATE customer_probe_targets
SET status = 'paused', updated_at = 1700000100
WHERE customer_id IN (
  SELECT i.customer_id FROM implementation_sessions i
  WHERE i.bundle_expires_at < 1700000100 AND i.bundle_expired_at IS NOT NULL
)
AND customer_id NOT IN (
  SELECT s.customer_id FROM subscriptions s WHERE s.status = 'active'
)
AND customer_id NOT IN (
  SELECT i2.customer_id FROM implementation_sessions i2
  WHERE i2.status='active' AND i2.bundle_expires_at >= 1700000100 AND i2.bundle_expired_at IS NULL
);

-- Assertion (should be 'paused' — queued F2 doesn't keep alive):
SELECT 'CASE 8 EXPECTED status=paused (queued F2 ignored)' AS marker,
       customer_id, status
FROM customer_probe_targets WHERE customer_id='cus_overlap_queued';

-- ============================================================================
-- CASE 9 — Older F2 expired + newer F2 status='failed'
-- Expected: probe paused (failed F2 doesn't count)
-- ============================================================================

DELETE FROM customer_probe_targets;
DELETE FROM implementation_sessions;
INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at)
VALUES ('cus_overlap_failed', 'overlap3.com', 'Overlap3', 'developer-tools', '[]', 'active', 1700000000, 1700000000);
INSERT INTO implementation_sessions (session_id, dodo_payment_id, customer_email, customer_domain, brand_name, category, competitors, customer_id, status, payment_succeeded_at, bundle_expires_at, bundle_expired_at, created_at, updated_at)
VALUES
  ('impl-older3', 'pay_older3', 'a@x.com', 'overlap3.com', 'Overlap3', 'developer-tools', '[]', 'cus_overlap_failed', 'active', 1690000000, 1697000000, 1697000001, 1690000000, 1697000001),
  ('impl-newer3', 'pay_newer3', 'a@x.com', 'overlap3.com', 'Overlap3', 'developer-tools', '[]', 'cus_overlap_failed', 'failed', 1700000050, 1707000000, NULL, 1700000050, 1700000050);  -- FAILED

UPDATE customer_probe_targets
SET status = 'paused', updated_at = 1700000100
WHERE customer_id IN (
  SELECT i.customer_id FROM implementation_sessions i
  WHERE i.bundle_expires_at < 1700000100 AND i.bundle_expired_at IS NOT NULL
)
AND customer_id NOT IN (
  SELECT s.customer_id FROM subscriptions s WHERE s.status = 'active'
)
AND customer_id NOT IN (
  SELECT i2.customer_id FROM implementation_sessions i2
  WHERE i2.status='active' AND i2.bundle_expires_at >= 1700000100 AND i2.bundle_expired_at IS NULL
);

-- Assertion (should be 'paused' — failed F2 doesn't keep alive):
SELECT 'CASE 9 EXPECTED status=paused (failed F2 ignored)' AS marker,
       customer_id, status
FROM customer_probe_targets WHERE customer_id='cus_overlap_failed';

-- ============================================================================
-- CASE 10 — Older F2 expired + newer F2 status='active' BUT bundle_expires_at < NOW
-- Expected: probe paused (newer F2 itself temporally expired despite status='active')
-- ============================================================================

DELETE FROM customer_probe_targets;
DELETE FROM implementation_sessions;
INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at)
VALUES ('cus_overlap_temp_expired', 'overlap4.com', 'Overlap4', 'developer-tools', '[]', 'active', 1700000000, 1700000000);
INSERT INTO implementation_sessions (session_id, dodo_payment_id, customer_email, customer_domain, brand_name, category, competitors, customer_id, status, payment_succeeded_at, bundle_expires_at, bundle_expired_at, created_at, updated_at)
VALUES
  ('impl-older4', 'pay_older4', 'a@x.com', 'overlap4.com', 'Overlap4', 'developer-tools', '[]', 'cus_overlap_temp_expired', 'active', 1690000000, 1697000000, 1697000001, 1690000000, 1697000001),
  ('impl-newer4', 'pay_newer4', 'a@x.com', 'overlap4.com', 'Overlap4', 'developer-tools', '[]', 'cus_overlap_temp_expired', 'active', 1690500000, 1699000000, NULL, 1690500000, 1690500000);  -- status=active but bundle_expires_at < NOW (1700000100)

UPDATE customer_probe_targets
SET status = 'paused', updated_at = 1700000100
WHERE customer_id IN (
  SELECT i.customer_id FROM implementation_sessions i
  WHERE i.bundle_expires_at < 1700000100 AND i.bundle_expired_at IS NOT NULL
)
AND customer_id NOT IN (
  SELECT s.customer_id FROM subscriptions s WHERE s.status = 'active'
)
AND customer_id NOT IN (
  SELECT i2.customer_id FROM implementation_sessions i2
  WHERE i2.status='active' AND i2.bundle_expires_at >= 1700000100 AND i2.bundle_expired_at IS NULL
);

-- Assertion (should be 'paused' — temporally-expired F2 doesn't keep alive):
SELECT 'CASE 10 EXPECTED status=paused (temporally expired F2 ignored)' AS marker,
       customer_id, status
FROM customer_probe_targets WHERE customer_id='cus_overlap_temp_expired';

-- ============================================================================
-- TEARDOWN
-- ============================================================================
DELETE FROM customer_probe_targets;
DELETE FROM implementation_sessions;

-- ============================================================================
-- Expected outcomes summary:
-- Case 1: status=active (new insert)
-- Case 2: 0 rows (rejected — at capacity)
-- Case 3: 1 row, status=active, updated_at=1700000100 (existing-active reactivated)
-- Case 4: 1 row, status=active, updated_at=1700000100 (DUAL-TIER F2+F3 — KEY CASE)
-- Case 5: status=paused (rejected — paused at capacity, no slot to reactivate into)
-- Case 6: status=active, updated_at=1700000100 (paused-customer reactivation OK)
-- Case 7: status=active (newer F2 active+within → probe stays alive)
-- Case 8: status=paused (queued F2 → probe paused; queued doesn't count)
-- Case 9: status=paused (failed F2 → probe paused; failed doesn't count)
-- Case 10: status=paused (temporally-expired F2 → probe paused; expired doesn't count)
-- ============================================================================
