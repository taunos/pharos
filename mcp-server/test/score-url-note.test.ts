// E10 (code-quality audit 2026-11-05): the free Score always marks Dim 6 N/A,
// so score_url's note must say Citation Visibility is in the paid Audit, not
// that dimensions are unreleased.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreUrlNote } from "../src/site-fetch.ts";

const dims = (...na: number[]) =>
  [1, 2, 3, 4, 5, 6].map((id) => ({ dimension_id: id, na: na.includes(id) }));

test("free scan with only Dim 6 N/A points at the paid Audit", () => {
  assert.equal(
    scoreUrlNote(dims(6), 5, 6),
    "Scored on 5 of 6 dimensions applicable to this site. Citation Visibility (Dim 6) is measured in the paid $79 Audit, not the free Score."
  );
});

test("another N/A dimension keeps the did-not-apply explanation", () => {
  assert.equal(
    scoreUrlNote(dims(3, 6), 4, 6),
    "Scored on 4 of 6 dimensions applicable to this site (some did not apply, e.g. no API surface for the OpenAPI dimension). Citation Visibility (Dim 6) is measured in the paid $79 Audit, not the free Score."
  );
});

test("no note ever claims unreleased dimensions", () => {
  for (const [d, a] of [[dims(6), 5], [dims(3, 6), 4], [dims(3), 5]] as const) {
    assert.ok(!/upcoming releases|unreleased/i.test(scoreUrlNote(d, a, 6)));
  }
});

test("all applicable", () => {
  assert.equal(scoreUrlNote(dims(), 6, 6), "All dimensions scored.");
});
