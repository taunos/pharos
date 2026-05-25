DELETE FROM founding_customers;
UPDATE founding_cohort_meta SET reserved_count = 0, updated_at = strftime('%s','now') WHERE id = 1;

WITH RECURSIVE seq(n) AS (
  SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 29
)
INSERT INTO founding_customers (customer_id, founding_status, founding_assigned_at, founding_tier_locks, created_at, updated_at)
SELECT 'test_c4_' || printf('%02d', n), 'active', strftime('%s','now') + n, '{"standard": 14900}', strftime('%s','now') + n, strftime('%s','now')
FROM seq;

INSERT INTO founding_customers (customer_id, founding_status, founding_assigned_at, founding_tier_locks, created_at, updated_at)
VALUES ('test_c4_30', 'active', strftime('%s','now'), '{"standard": 14900}', strftime('%s','now'), strftime('%s','now'));

SELECT
  CASE WHEN
    (SELECT founding_order_seq FROM founding_customers WHERE customer_id = 'test_c4_30') = 30
    AND (SELECT reserved_count FROM founding_cohort_meta WHERE id = 1) = 30
  THEN 'PASS case_4' ELSE 'FAIL case_4' END AS result;
