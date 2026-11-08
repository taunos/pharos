// Slice 3b Dim 6 — TP-7 trust ladder.
//
// Six rungs (locked decision 3):
//   1. Deterministic generation (temperature: 0, seed: 42 where supported)
//   2. Validators (response non-empty, refusal pattern check, score parser)
//   3. Retry-once-with-feedback on validator failure
//   4. Templated fallback (returns unmeasurable cell — locked decision 4)
//   5. Cache (KV, key shape `<DIM6_ENGINE_VERSION>:<model_id>:<sha256(
//      target + competitors + prompt + reference)>`, currently `dim6:v5:...`; 24h TTL,
//      independent of SCORING_VERSION/REMEDIATION_ENGINE_VERSION per locked
//      decision 5)
//   6. Engine versioning (DIM6_ENGINE_VERSION constant stamped on rows)
//
// Three retry paths per Task 6:
//   - Network/timeout/abort → immediate templated fallback (no retry)
//   - HTTP 429/5xx → wait Retry-After (defensive parser, capped at 30s; >30s
//     short-circuits to fallback), retry SAME prompt once. Second 429/5xx
//     → fallback.
//   - Validator failure → retry-once-with-feedback (prepend "Your previous
//     response was rejected because: <reason>...")
//
// Validator order:
//   1. Response non-empty (adapter already returns decode_error if empty)
//   2. max_tokens truncation is NOT a fail — set truncated:true flag,
//      cell stays measurable
//   3. Canary refusal patterns ANCHORED to first 200 chars only
//      ("As an AI" REMOVED from list — see parser.ts)
//   4. URL-grounding async fetch-check (don't block; future work — emit
//      a structured log line so we have a hook to add it without changing
//      the public API)

import {
  callAdapter,
  parseRetryAfter,
  type AdapterEnv,
  type AdapterResult,
} from "./adapters";
import {
  isLikelyRefusal,
  safeHost,
  scoreResponse,
} from "./parser";
import {
  judgeAffirmation,
  type JudgeEnv,
} from "./affirmation-judge";
import { judgeAccuracy, type AccuracyVerdict } from "./accuracy-judge";
import {
  type CellResult,
  type ModelId,
} from "./types";
import { DIM6_ENGINE_VERSION } from "./types";

const RETRY_AFTER_CAP_SEC = 30;
// 24 hours (was 30 days). Long enough to cover every automatic re-run of
// one fulfillment (queue retries at +60/+120/+180 s, each run bounded by the
// Worker wall time, so well under an hour; the DLQ consumer only marks the
// session failed and never re-runs Dim 6), short enough that a re-Audit a day
// or more later asks the models again instead of replaying old answers. Since
// stable per-domain question sets (question-set.ts) the prompt hash repeats,
// so a long TTL would hide real site improvements.
export const CACHE_TTL_SEC = 24 * 60 * 60;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

export interface LadderEnv extends AdapterEnv, JudgeEnv {
  // KV namespace used for the Dim 6 cell cache. Reuses SESSIONS by default
  // (audit-fulfill already binds it). Caller may pass a different KV for tests.
  cacheKv: KVNamespace;
}

export interface LadderInput {
  modelId: ModelId;
  prompt: string;
  targetUrl: string;
  competitorHosts?: string[];
  // dim6:v5: the run's verifiable reference description of the site
  // (reference.ts). null/absent → accuracy not checked for this run, and
  // AFFIRM answers score 0 (fail closed, accuracy_not_checked=true).
  reference?: string | null;
  // dim6:v5: the site's description tripped the injection screen. Every AFFIRM
  // answer scores 0 (measurable, accuracy_blocked=true): the site owner is the
  // likely attacker, so no v4 credit.
  referenceBlocked?: boolean;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// The cached cell is a SCORED result, so the key covers every scoring input:
// the target the parser/judge score against and the competitor list, not
// just the prompt (Codex r1 HIGH: a cell scored for `x.com.` must never be
// replayed for `x.com`). modelId in the key keeps adapters separate.
// dim6:v5: the reference description is a scoring input too: a cell judged
// against one description (or with accuracy unchecked) is never reused for
// another.
export async function cellCacheKey(
  modelId: ModelId,
  prompt: string,
  targetUrl: string,
  competitorHosts: string[] = [],
  reference: string | null = null,
  referenceBlocked = false
): Promise<string> {
  const identity = JSON.stringify([targetUrl, [...competitorHosts].sort(), prompt, reference, referenceBlocked]);
  return `${DIM6_ENGINE_VERSION}:${modelId}:${await sha256Hex(identity)}`;
}

interface CachedCell {
  text: string | null;
  score: number;
  unmeasurable: boolean;
  truncated: boolean;
  notes: string;
  // When this was cached (epoch ms). readCache treats entries older than
  // CACHE_TTL_SEC as a miss.
  cached_at: number;
}

async function readCache(
  kv: KVNamespace,
  key: string
): Promise<CachedCell | null> {
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedCell;
    // A cached failure is a miss: provider outages / exhausted credits must
    // not replay into later audits of the same domain for the full TTL.
    // Also neutralizes unmeasurable entries written before this guard.
    if (cached.unmeasurable) return null;
    // Age guard on top of the KV TTL: entries KV hasn't evicted yet are a
    // miss once older than CACHE_TTL_SEC, and a cached_at more than
    // FUTURE_SKEW_MS in the future is a miss too.
    const now = Date.now();
    if (
      typeof cached.cached_at !== "number" ||
      !(now - cached.cached_at < CACHE_TTL_SEC * 1000) ||
      cached.cached_at > now + FUTURE_SKEW_MS
    ) {
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

async function writeCache(
  kv: KVNamespace,
  key: string,
  cell: CachedCell
): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(cell), { expirationTtl: CACHE_TTL_SEC });
  } catch {
    // Cache write failure is non-fatal.
  }
}

// Templated fallback (locked decision 4). Returns an unmeasurable cell with
// a structured note explaining why. unmeasurable:true means EXCLUDED from
// the score formula (distinct from score=0, which means "clean response,
// no citation found").
function templatedFallback(reason: string): CellResult {
  return {
    text: null,
    score: 0,
    unmeasurable: true,
    truncated: false,
    notes: `Templated fallback: ${reason}`,
  };
}

// Build a retry-with-feedback prompt. The original prompt is preserved
// verbatim and the rejection reason is prepended.
function buildRetryPrompt(originalPrompt: string, rejectionReason: string): string {
  return `Your previous response was rejected because: ${rejectionReason}

Please answer the same question again, this time avoiding that pattern.

${originalPrompt}`;
}

// Convert an adapter outcome to a CellResult OR a retryable signal. The
// caller (runLadder) decides whether to actually retry based on the
// retryability flags.
type LadderStep =
  | { kind: "result"; cell: CellResult }
  | { kind: "validator_fail"; reason: string; truncated: boolean }
  | { kind: "retry_after"; reason: string; waitSec: number };

/**
 * dim6:v5: the cell for an answer the affirmation judge marked AFFIRM, given
 * the accuracy verdict. Fail closed (Codex r1): only CORRECT answers keep the
 * substring breakdown. Everything else scores 0 and stays MEASURABLE:
 *   WRONG → misidentified=true; UNCLEAR → accuracy_unclear=true (plus
 *   accuracy_failed=<reason> when the answer could not be checked);
 *   "blocked" (the site's description tripped the injection screen) →
 *   accuracy_blocked=true; null (no usable description of the site) →
 *   accuracy_not_checked=true.
 * Pure, so the replay tool (tools/report-panel/replay-dim6-accuracy.mjs)
 * scores exactly like the ladder.
 */
export function scoreAffirmedCell(
  text: string,
  targetUrl: string,
  competitorHosts: string[],
  truncated: boolean,
  accuracy: AccuracyVerdict | { kind: "blocked" } | null
): CellResult {
  if (accuracy?.kind !== "correct") {
    const notes = [
      `score=0/100`,
      `judge=AFFIRM`,
      accuracy === null
        ? "accuracy_not_checked=true"
        : accuracy.kind === "wrong"
          ? "accuracy=WRONG; misidentified=true"
          : accuracy.kind === "unclear"
            ? `accuracy=UNCLEAR; accuracy_unclear=true${accuracy.failed ? `; accuracy_failed=${accuracy.failed}` : ""}`
            : "accuracy_blocked=true",
      truncated ? "truncated=true" : null,
    ]
      .filter((s): s is string => s !== null)
      .join("; ");
    return { text, score: 0, unmeasurable: false, truncated, notes };
  }
  // Substring-counting is appropriate here because the judges have already
  // confirmed the response is affirmative and accurate. Granular sub-checks
  // differentiate "passing mention" from "clean named citation with URL."
  const breakdown = scoreResponse(text, targetUrl, competitorHosts);
  const notes = [
    `score=${breakdown.score}/100`,
    `judge=AFFIRM`,
    "accuracy=CORRECT",
    `domain_named=${breakdown.domainNamed}`,
    `url_referenced=${breakdown.urlReferenced}`,
    `context_relevant=${breakdown.contextRelevant}`,
    `no_competitor_first=${breakdown.noCompetitorFirst}`,
    truncated ? "truncated=true" : null,
  ]
    .filter((s): s is string => s !== null)
    .join("; ");
  return { text, score: breakdown.score, unmeasurable: false, truncated, notes };
}

/** dim6:v5: the affirmation judge failed twice on a received answer: 0, measurable, flagged. */
export function affirmationFailedCell(text: string, truncated: boolean): CellResult {
  return {
    text,
    score: 0,
    unmeasurable: false,
    truncated,
    notes: ["score=0/100", "affirmation_failed=true", truncated ? "truncated=true" : null]
      .filter((s): s is string => s !== null)
      .join("; "),
  };
}

async function classifyAdapterResult(
  env: LadderEnv,
  adapter: AdapterResult,
  targetUrl: string,
  competitorHosts: string[],
  reference: string | null,
  referenceBlocked: boolean
): Promise<LadderStep> {
  const o = adapter.outcome;
  switch (o.kind) {
    case "network":
      // Network/timeout/abort → IMMEDIATE templated fallback (no retry)
      return {
        kind: "result",
        cell: templatedFallback(`network/timeout: ${o.reason}`),
      };
    case "rate_limit":
    case "server_error": {
      const wait = o.retryAfterSec ?? -1;
      // Retry-After unparseable or absent (-1): treat as wait=0 and try once.
      // Retry-After present and > cap: short-circuit to fallback (locked
      // decision: don't tie up audit-fulfill behind a long wait).
      if (wait > RETRY_AFTER_CAP_SEC) {
        return {
          kind: "result",
          cell: templatedFallback(
            `${o.kind} retry-after ${wait}s exceeds ${RETRY_AFTER_CAP_SEC}s cap`
          ),
        };
      }
      const waitSec = Math.max(0, wait);
      return { kind: "retry_after", reason: o.reason, waitSec };
    }
    case "client_error":
      // 4xx other than 429 (e.g. 401/403/400 bad-request). Not retryable.
      return {
        kind: "result",
        cell: templatedFallback(`HTTP ${o.status}: ${o.reason}`),
      };
    case "decode_error":
      return {
        kind: "result",
        cell: templatedFallback(`decode_error: ${o.reason}`),
      };
    case "safety":
      // Safety refusal — no point retrying with the same prompt. Templated
      // fallback. The cell is unmeasurable (excluded from score formula).
      return {
        kind: "result",
        cell: templatedFallback(`safety refusal: ${o.reason}`),
      };
    case "ok": {
      // Run validators.
      // (1) Refusal pattern (anchored to first 200 chars; "As an AI" removed)
      if (isLikelyRefusal(o.text)) {
        return {
          kind: "validator_fail",
          reason:
            "your response begins with a refusal pattern (e.g. 'I can't help with...' or 'I'm sorry, but I cannot...'). Answer the question directly with a short, factual statement.",
          truncated: o.truncated,
        };
      }

      // (2) v2 affirmation judge (new in dim6:v2 — 2026-05-02 parser-bug fix).
      //     Workers AI binary verdict on whether the response affirmatively
      //     mentions the target domain. Gates the substring scoring below.
      //     - AFFIRM       → run substring breakdown, real granular score
      //     - DENY         → score=0 but cell stays MEASURABLE (clean
      //                       no-citation, distinct from unmeasurable)
      //     - unmeasurable → judge failed twice; cell excluded from formula
      //
      // Without this gate, v1 substring-only scoring counts every response
      // that repeats the domain name as a citation — including explicit
      // refusals ("No, astrant.io does not appear...") and confabulated
      // mentions of unknown domains. Dogfood scan 2026-05-02 surfaced 70/100
      // false-positive cells across all four providers; v2 closes that
      // failure mode at the judge step.
      const verdict = await judgeAffirmation(env, targetUrl, o.text);
      const truncated = o.truncated;

      if (verdict.kind === "unmeasurable") {
        // dim6:v5 (Codex r3 MED): a received answer the judge could not
        // classify stays measurable at 0, so a judge failure can't drop a
        // losing answer from the denominator. aggregateCells turns a run
        // where EVERY received answer failed (a Workers AI outage) back into
        // all-unmeasurable, so our outage never gives a customer a 0.
        console.warn(`[dim6] affirmation judge failed, scoring 0: ${verdict.reason.slice(0, 120)}`);
        return { kind: "result", cell: affirmationFailedCell(o.text, o.truncated) };
      }

      if (verdict.kind === "deny") {
        // Clean no-citation. score=0, MEASURABLE, included in formula as
        // a real "model didn't recognize the domain" signal.
        const notes = [
          `score=0/100`,
          `judge=DENY`,
          truncated ? "truncated=true" : null,
        ]
          .filter((s): s is string => s !== null)
          .join("; ");
        return {
          kind: "result",
          cell: {
            text: o.text,
            score: 0,
            unmeasurable: false,
            truncated,
            notes,
          },
        };
      }

      // verdict.kind === "affirm" → (dim6:v5) accuracy judge against the
      // site's own description when the run has one, then the substring
      // breakdown for CORRECT (or unchecked) answers only.
      const accuracy = referenceBlocked
        ? ({ kind: "blocked" } as const)
        : reference
          ? await judgeAccuracy(env, safeHost(targetUrl) ?? targetUrl, reference, o.text)
          : null;
      return {
        kind: "result",
        cell: scoreAffirmedCell(o.text, targetUrl, competitorHosts, truncated, accuracy),
      };
    }
  }
}

// Bounded async sleep. Avoid `setTimeout(0)` race where caller resolves the
// promise before fetch fires.
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run the TP-7 ladder for a single (model, prompt) pair. Returns a
 * fully-classified CellResult — never throws (errors land in the cell's
 * notes field as templated fallback).
 */
export async function runLadder(
  env: LadderEnv,
  input: LadderInput
): Promise<CellResult> {
  const { modelId, prompt, targetUrl, competitorHosts = [] } = input;
  const reference = input.reference ?? null;
  const referenceBlocked = input.referenceBlocked === true;

  // Cache check (rung 5).
  const key = await cellCacheKey(modelId, prompt, targetUrl, competitorHosts, reference, referenceBlocked);
  const cellHash = key.slice(key.lastIndexOf(":") + 1);
  const cached = await readCache(env.cacheKv, key);
  if (cached) {
    console.log(
      `[dim6] cache=hit model=${modelId} hash=${cellHash.slice(0, 12)}`
    );
    return {
      text: cached.text,
      score: cached.score,
      unmeasurable: cached.unmeasurable,
      truncated: cached.truncated,
      notes: cached.notes,
    };
  }
  console.log(
    `[dim6] cache=miss model=${modelId} hash=${cellHash.slice(0, 12)}`
  );

  // Initial call.
  let adapter = await callAdapter(env, modelId, prompt);
  let step = await classifyAdapterResult(env, adapter, targetUrl, competitorHosts, reference, referenceBlocked);

  // 429/5xx retry path: wait Retry-After (capped 30s), retry SAME prompt once.
  if (step.kind === "retry_after") {
    if (step.waitSec > 0) {
      await sleep(step.waitSec * 1000);
    }
    console.log(
      `[dim6] retry=rate_limit model=${modelId} waited=${step.waitSec}s`
    );
    adapter = await callAdapter(env, modelId, prompt);
    step = await classifyAdapterResult(env, adapter, targetUrl, competitorHosts, reference, referenceBlocked);
    // Second 429/5xx → fallback.
    if (step.kind === "retry_after") {
      const cell = templatedFallback(
        `rate_limit/server_error after retry: ${step.reason}`
      );
      await writeCacheCell(env.cacheKv, key, cell);
      return cell;
    }
    // If second adapter call returns a validator_fail, fall through to the
    // validator retry path below.
  }

  // Validator retry path: retry-once-with-feedback.
  if (step.kind === "validator_fail") {
    const retryPrompt = buildRetryPrompt(prompt, step.reason);
    console.log(
      `[dim6] retry=validator model=${modelId} reason="${step.reason.slice(0, 80)}"`
    );
    const adapter2 = await callAdapter(env, modelId, retryPrompt);
    const step2 = await classifyAdapterResult(env, adapter2, targetUrl, competitorHosts, reference, referenceBlocked);
    if (step2.kind === "result") {
      step = step2;
    } else if (step2.kind === "validator_fail") {
      // Validator failed twice — templated fallback. Cell is unmeasurable.
      const cell = templatedFallback(
        `validator failed twice: first=${step.reason.slice(0, 80)}; retry=${step2.reason.slice(0, 80)}`
      );
      await writeCacheCell(env.cacheKv, key, cell);
      return cell;
    } else {
      // retry_after on the validator-retry call — short-circuit to fallback.
      const cell = templatedFallback(
        `retry-after on validator-retry: ${step2.reason}`
      );
      await writeCacheCell(env.cacheKv, key, cell);
      return cell;
    }
  }

  // Final cell from `step`.
  if (step.kind === "result") {
    await writeCacheCell(env.cacheKv, key, step.cell);
    return step.cell;
  }

  // Unreachable in practice — defensive fallback.
  const cell = templatedFallback("ladder reached unreachable state");
  await writeCacheCell(env.cacheKv, key, cell);
  return cell;
}

async function writeCacheCell(
  kv: KVNamespace,
  key: string,
  cell: CellResult
): Promise<void> {
  // Only measured results are cacheable (see readCache). A judge failure is
  // our own transient failure, not a result: never replay it.
  if (cell.unmeasurable) return;
  if (/\baffirmation_failed=true\b|\baccuracy_failed=judge_failed\b/.test(cell.notes)) return;
  await writeCache(kv, key, {
    text: cell.text,
    score: cell.score,
    unmeasurable: cell.unmeasurable,
    truncated: cell.truncated,
    notes: cell.notes,
    cached_at: Date.now(),
  });
}
