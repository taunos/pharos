-- Deploy-time Deviation (Phase 1b diagnostic): D1 local SQLite denies CREATE TEMP TABLE
-- with SQLITE_AUTH. Replaced TEMP TABLE with inline VALUES CTE; semantics identical.

DELETE FROM founding_customers;
UPDATE founding_cohort_meta SET reserved_count = 0, updated_at = strftime('%s','now') WHERE id = 1;

WITH mock_subs(customer_id, created_at) AS (VALUES
  ('mc_03', 3000),
  ('mc_01', 1000),
  ('mc_05', 5000),
  ('mc_02', 2000),
  ('mc_04', 4000)
)
INSERT INTO founding_customers (customer_id, founding_status, founding_assigned_at, founding_tier_locks, created_at, updated_at)
SELECT customer_id, 'active', created_at, '{"standard": 14900}', created_at, strftime('%s','now')
FROM mock_subs
ORDER BY created_at ASC;

SELECT
  CASE WHEN
    (SELECT GROUP_CONCAT(customer_id || ':' || founding_order_seq, ',')
       FROM (SELECT customer_id, founding_order_seq FROM founding_customers WHERE customer_id LIKE 'mc_%' ORDER BY founding_order_seq))
    = 'mc_01:1,mc_02:2,mc_03:3,mc_04:4,mc_05:5'
  THEN 'PASS case_9' ELSE 'FAIL case_9' END AS result;
