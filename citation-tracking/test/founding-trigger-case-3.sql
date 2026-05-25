DELETE FROM founding_customers;
UPDATE founding_cohort_meta SET reserved_count = 0, updated_at = strftime('%s','now') WHERE id = 1;

INSERT INTO founding_customers (customer_id, founding_status, founding_assigned_at, founding_tier_locks, created_at, updated_at)
VALUES ('test_c3_a', 'active', strftime('%s','now'), '{"standard": 14900}', strftime('%s','now'), strftime('%s','now'));
INSERT OR IGNORE INTO founding_customers (customer_id, founding_status, founding_assigned_at, founding_tier_locks, created_at, updated_at)
VALUES ('test_c3_a', 'active', strftime('%s','now'), '{"standard": 14900}', strftime('%s','now'), strftime('%s','now'));

SELECT
  CASE WHEN
    (SELECT COUNT(*) FROM founding_customers WHERE customer_id = 'test_c3_a') = 1
    AND (SELECT reserved_count FROM founding_cohort_meta WHERE id = 1) = 1
  THEN 'PASS case_3' ELSE 'FAIL case_3' END AS result;
