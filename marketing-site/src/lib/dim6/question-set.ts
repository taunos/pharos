// Dim 6 — stable question set per canonical domain.
//
// Before this module every paid Audit generated a fresh question set, so two
// Audits of the same site could ask different questions and Dim 6 moved
// (e.g. 60 then 44) on question churn alone. Now the first successful
// generation for a canonical domain is stored in D1 (pharos_corpus,
// table dim6_question_set, corpus/migrations/0004) and every later Audit of
// that domain reuses it, so a score change reflects the site / the models,
// not the questions.
//
//   - Key: (canonical_domain, question_set_version). Bump
//     DIM6_QUESTION_SET_VERSION whenever the generator prompt, model,
//     validator or bank changes: a new version starts fresh sets instead of
//     silently mixing old and new questions. No expiry within a version.
//   - Concurrency: INSERT OR IGNORE then read back. Two first Audits of one
//     domain at once both use whichever row won the primary key.
//   - Validation: a set is stored only after isValidQuestionSet passes, and
//     every read-back is re-validated. An invalid stored row is never used;
//     it is repaired by compare-and-swap (UPDATE ... WHERE queries_json =
//     the exact invalid payload read), so concurrent repairers converge.
//   - Pure bank fallback (generator failed) is NOT stored, so a transient
//     Workers AI failure doesn't pin the domain to the bank for the version.
//   - Fail-open: any D1 error (including the table not existing before the
//     migration is applied) logs and uses the freshly generated set, i.e.
//     the pre-change behaviour. Dim 6 is never blocked on this store.

import { generatePromptSet, isValidQuestionSet, type PromptSetGenEnv } from "./promptset";
import type { PromptSetQuery } from "./types";

// v3 (2026-11-07): business-type neutral generator prompt and a parser that
// accepts output missing the closing "]" (generated sets now parse).
// v2 (2026-11-07): bank q_bank_8 is business-type neutral; "padded" sets
// stored under v1 may carry the old software-category question.
export const DIM6_QUESTION_SET_VERSION = "dim6-qs:v3";

export interface QuestionSetEnv extends PromptSetGenEnv {
  // pharos_corpus (PHAROS_CORPUS binding on the marketing Worker).
  questionSetDb: D1Database;
}

/**
 * Canonical domain for question-set keying: the URL's hostname, lowercased
 * (WHATWG URL parsing also punycodes IDNs), trailing dot removed, one
 * leading "www." removed. Scheme, port, path, query and fragment are
 * dropped. Subdomains other than www are kept (no public-suffix list
 * in-tree, and docs.x.com / app.x.com can be different products). Returns
 * null for anything that isn't an http(s) URL with a host.
 */
export function canonicalDomain(url: string): string | null {
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/\.+$/, "").replace(/^www\./, "");
  return host.length > 0 ? host : null;
}

const SELECT_SQL =
  "SELECT queries_json FROM dim6_question_set WHERE canonical_domain = ? AND question_set_version = ?";
const INSERT_SQL =
  "INSERT OR IGNORE INTO dim6_question_set (canonical_domain, question_set_version, queries_json, source, created_at) VALUES (?, ?, ?, ?, ?)";
// Compare-and-swap repair of an invalid row: only replaces the exact payload
// this run read and rejected.
const REPAIR_SQL =
  "UPDATE dim6_question_set SET queries_json = ?, source = ?, created_at = ? WHERE canonical_domain = ? AND question_set_version = ? AND queries_json = ?";

// queries: the validated set, or null. invalidRaw: the stored payload when a
// row exists but fails validation (for the CAS repair). Throws on D1 error
// (caller fails open).
async function readStored(
  db: D1Database,
  domain: string
): Promise<{ queries: PromptSetQuery[] | null; invalidRaw: string | null }> {
  const row = await db
    .prepare(SELECT_SQL)
    .bind(domain, DIM6_QUESTION_SET_VERSION)
    .first<{ queries_json: string }>();
  if (!row) return { queries: null, invalidRaw: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.queries_json);
  } catch {
    parsed = null;
  }
  if (!isValidQuestionSet(parsed)) {
    console.error(
      `[dim6/question-set] stored set failed validation; not used. domain=${domain} version=${DIM6_QUESTION_SET_VERSION}`
    );
    return { queries: null, invalidRaw: row.queries_json };
  }
  return { queries: parsed, invalidRaw: null };
}

/**
 * The question set for this Audit: the stored set for the URL's canonical
 * domain if there is one, else a newly generated set (stored when it came
 * from the model). The generator is given the canonical domain, never the
 * customer-typed URL, so path/query text can't reach the generator prompt.
 */
export async function resolveQuestionSet(
  env: QuestionSetEnv,
  scanUrl: string,
  signals: { homepageHtml?: string | null; titleTag?: string | null } = {}
): Promise<PromptSetQuery[]> {
  const domain = canonicalDomain(scanUrl);
  if (!domain) {
    // audit-create only stores valid http(s) URLs, so this is defensive.
    return (await generatePromptSet(env, scanUrl, signals)).queries;
  }

  try {
    const stored = await readStored(env.questionSetDb, domain);
    if (stored.queries) {
      console.log(`[dim6/question-set] reuse domain=${domain} version=${DIM6_QUESTION_SET_VERSION}`);
      return stored.queries;
    }
  } catch (e) {
    console.error(
      `[dim6/question-set] store_unavailable on read; generating unstored. ${e instanceof Error ? e.message : String(e)}`
    );
    return (await generatePromptSet(env, domain, signals)).queries;
  }

  const fresh = await generatePromptSet(env, domain, signals);
  try {
    const storable = fresh.source !== "bank" && isValidQuestionSet(fresh.queries);
    const payload = JSON.stringify(fresh.queries);
    if (storable) {
      await env.questionSetDb
        .prepare(INSERT_SQL)
        .bind(domain, DIM6_QUESTION_SET_VERSION, payload, fresh.source, Date.now())
        .run();
    }
    // Read back even after a bank fallback: a concurrent Audit may have
    // stored a set meanwhile, and every run of the domain should use it.
    let winner = await readStored(env.questionSetDb, domain);
    if (!winner.queries && winner.invalidRaw !== null && storable) {
      await env.questionSetDb
        .prepare(REPAIR_SQL)
        .bind(payload, fresh.source, Date.now(), domain, DIM6_QUESTION_SET_VERSION, winner.invalidRaw)
        .run();
      console.warn(`[dim6/question-set] repair CAS on invalid stored set domain=${domain}`);
      winner = await readStored(env.questionSetDb, domain);
    }
    if (winner.queries) {
      console.log(
        `[dim6/question-set] resolved domain=${domain} version=${DIM6_QUESTION_SET_VERSION} source=${fresh.source}`
      );
      return winner.queries;
    }
  } catch (e) {
    console.error(
      `[dim6/question-set] store_unavailable on write; using unstored set. ${e instanceof Error ? e.message : String(e)}`
    );
  }
  return fresh.queries;
}
