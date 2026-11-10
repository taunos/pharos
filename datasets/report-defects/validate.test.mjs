import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "./validate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

for (const name of ["defects.jsonl", "customer.local.jsonl"]) {
  const file = path.join(HERE, name);
  if (!fs.existsSync(file)) continue;
  test(`${name} is valid`, () => {
    assert.deepEqual(validate(fs.readFileSync(file, "utf8"), HERE), []);
  });
}

const good = {
  schema_version: 1, id: "RD-0001", label: "defect", found_at: "2026-11-10", found_by: "outside_reader", source: "test",
  product: "audit", surface: "report", site: "example.com", scoring_version: "1.5.1",
  section: "Structured data", text: "description=false, sameAs=0", context: null, category: "raw_internal",
  severity: "polish", why: "internal note", fixed_text: null, status: "open", fix_commit: null,
  caught_by_rule: "raw-note", snapshot: "snap/report.md",
};

test("validator: accepts a good entry and checks the text against its snapshot", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-"));
  fs.mkdirSync(path.join(dir, "snap"));
  fs.writeFileSync(path.join(dir, "snap", "report.md"), "Organization found:\n description=false,   sameAs=0\n");
  assert.deepEqual(validate(JSON.stringify(good), dir), []);
  const errs = (o) => validate(JSON.stringify({ ...good, ...o }), dir);
  assert.match(errs({ text: "not in the report" }).join(), /does not appear/);
  assert.match(errs({ snapshot: "../outside.md" }).join(), /inside this folder/);
  assert.match(errs({ category: "typo" }).join(), /category must be/);
  assert.match(errs({ status: "fixed" }).join(), /fixed needs fix_commit/);
  assert.match(errs({ label: "not_defect" }).join(), /not_defect needs/);
  assert.match(errs({ extra: 1 }).join(), /unknown field extra/);
  assert.match(errs({ schema_version: 2 }).join(), /schema_version must be 1/);
  assert.match(errs({ label: "disputed", status: "fixed", fix_commit: "abc" }).join(), /disputed needs status open/);
  assert.deepEqual(errs({ id: "RD-10000" }), []);
  assert.match(validate([JSON.stringify(good), JSON.stringify(good)].join("\n"), dir).join(), /duplicate id/);
});
