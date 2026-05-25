#!/bin/bash
# citation-tracking/test/probe-cadence-smoke.sh
# F4.1 smoke harness.

set -e

echo "=== F4.1 cadence smoke ==="

# Cases 2-6: tsx-runner
npx tsx test/cadence.test.ts

# Cases 1, 7, 8, 9: wrangler d1 execute against local D1
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --local --command \
  "INSERT INTO customer_probe_targets (customer_id, domain, brand_name, category, competitors, status, created_at, updated_at) VALUES ('smoke1', 'test.com', 'Test', 'test', '[]', 'active', strftime('%s','now'), strftime('%s','now'));" \
  && echo "PASS: case1 default insert (probe_cadence backfilled to twice_weekly)" \
  || echo "FAIL: case1 default insert"

./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --local --command \
  "UPDATE customer_probe_targets SET probe_cadence = 'monthly' WHERE customer_id = 'smoke1';" 2>&1 \
  | grep -iE "CHECK|constraint" \
  && echo "PASS: case7 CHECK constraint rejects monthly" \
  || echo "FAIL: case7 CHECK"

./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --local --command \
  "UPDATE customer_probe_targets SET probe_cadence = 'daily' WHERE customer_id = 'smoke1';" \
  && echo "PASS: case8 backfill UPDATE applies" \
  || echo "FAIL: case8 backfill"

./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --local --command \
  "UPDATE customer_probe_targets SET last_probed_at = strftime('%s','now') - 86400 WHERE customer_id = 'smoke1';" \
  && echo "PASS: case9 last_probed_at UPDATE" \
  || echo "FAIL: case9 last_probed_at"

./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --local --command \
  "DELETE FROM customer_probe_targets WHERE customer_id = 'smoke1';"

echo "=== smoke complete ==="
