#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

WRANGLER="./node_modules/.bin/wrangler"
DB="pharos-citation-tracking"
PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()

run_case_normal() {
  local case_num="$1"
  local file="test/founding-trigger-case-${case_num}.sql"
  local output
  output=$("${WRANGLER}" d1 execute "${DB}" --local --file "${file}" 2>&1)
  local exit_code=$?

  if [ "${exit_code}" -ne 0 ]; then
    RESULTS+=("case_${case_num}: FAIL (exit ${exit_code}; output: ${output})")
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi
  if echo "${output}" | grep -q "FAIL case_${case_num}"; then
    RESULTS+=("case_${case_num}: FAIL (assertion failed)")
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi
  if echo "${output}" | grep -q "PASS case_${case_num}"; then
    RESULTS+=("case_${case_num}: PASS")
    PASS_COUNT=$((PASS_COUNT + 1))
    return
  fi
  RESULTS+=("case_${case_num}: FAIL (no PASS/FAIL marker; output: ${output})")
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

run_case_expected_error() {
  # Deploy-time Deviation (Phase 1b diagnostic): wrangler d1 execute --file exits 0 even
  # when SQLite returns SQLITE_CONSTRAINT (CHECK violations). Original harness AND'd
  # exit-non-zero with substring match — false-FAILs on case 6. Substring-only is sufficient
  # because wrangler emits the SQLite error text on stderr regardless of exit code.
  local case_num="$1"
  local expected_substring="$2"
  local file="test/founding-trigger-case-${case_num}.sql"
  local output
  output=$("${WRANGLER}" d1 execute "${DB}" --local --file "${file}" 2>&1)
  local exit_code=$?
  if echo "${output}" | grep -q "${expected_substring}"; then
    RESULTS+=("case_${case_num}: PASS (expected error substring '${expected_substring}' present; wrangler exit=${exit_code})")
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    RESULTS+=("case_${case_num}: FAIL (expected substring '${expected_substring}' absent; exit=${exit_code}; output: ${output})")
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

reset_db() {
  "${WRANGLER}" d1 execute "${DB}" --local --file test/founding-reset.sql > /dev/null 2>&1
}

run_case_normal 1
run_case_normal 2
run_case_normal 3
run_case_normal 4
run_case_normal 5
run_case_expected_error 6 "CHECK constraint"
run_case_normal 8
run_case_normal 9

reset_db
echo ""
echo "==============================="
echo "Pre-case-7 reset complete. Run case 7 via Worker test endpoint."
echo "==============================="
echo ""

echo "==============================="
echo "F-Fnd smoke test results (cases 1-6, 8, 9)"
echo "==============================="
for r in "${RESULTS[@]}"; do
  echo "  ${r}"
done
echo "-------------------------------"
echo "PASS: ${PASS_COUNT}  FAIL: ${FAIL_COUNT}"
echo "==============================="

[ "${FAIL_COUNT}" -eq 0 ]
