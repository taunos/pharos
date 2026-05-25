DELETE FROM founding_customers;
UPDATE founding_cohort_meta SET reserved_count = 0, updated_at = strftime('%s','now') WHERE id = 1;

INSERT INTO founding_customers (customer_id, founding_status, founding_assigned_at, founding_tier_locks, created_at, updated_at)
VALUES ('test_c2_a', 'active', strftime('%s','now'), '{"standard": 14900}', strftime('%s','now'), strftime('%s','now'));
INSERT INTO founding_customers (customer_id, founding_status, founding_assigned_at, founding_tier_locks, created_at, updated_at)
VALUES ('test_c2_b', 'active', strftime('%s','now'), '{"standard": 14900}', strftime('%s','now'), strftime('%s','now'));
INSERT INTO founding_customers (customer_id, founding_status, founding_assigned_at, founding_tier_locks, created_at, updated_at)
VALUES ('test_c2_c', 'active', strftime('%s','now'), '{"standard": 14900}', strftime('%s','now'), strftime('%s','now'));

SELECT
  CASE WHEN
    (SELECT GROUP_CONCAT(founding_order_seq, ',') FROM (SELECT founding_order_seq FROM founding_customers WHERE customer_id LIKE 'test_c2_%' ORDER BY founding_order_seq)) = '1,2,3'
    AND (SELECT reserved_count FROM founding_cohort_meta WHERE id = 1) = 3
  THEN 'PASS case_2' ELSE 'FAIL case_2' END AS result;
