-- Deploy-time Deviation (Phase 1b diagnostic): case 6 spec-locked as a bare INSERT, but
-- prior cases leave counter=30 (cap-full). SQLite fires BEFORE INSERT cap-trigger first;
-- RAISE(IGNORE) silently aborts the INSERT before the CHECK constraint can evaluate, so
-- no "CHECK constraint failed" error surfaces. Adding a reset prefix matches the pattern
-- of all other cases + ensures the CHECK constraint is actually exercised against a
-- non-cap-full state.

DELETE FROM founding_customers;
UPDATE founding_cohort_meta SET reserved_count = 0, updated_at = strftime('%s','now') WHERE id = 1;

INSERT INTO founding_customers (customer_id, founding_status, founding_assigned_at, founding_tier_locks, created_at, updated_at)
VALUES ('astrant', 'active', strftime('%s','now'), '{"standard": 14900}', strftime('%s','now'), strftime('%s','now'));
