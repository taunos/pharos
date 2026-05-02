// Slice 3b Dim 6 — orchestrator (Task 8 + Task 11).
//
// Given (scanUrl, optional signals), generate a prompt set, dispatch each
// prompt across all 4 models, and aggregate. Returns Dim6Result + a
// SubCheck-shaped DimensionResult ready for the scanner-style consumer
// (audit-fulfill puts this on the paid-tier scan response in place of the
// scanner's free-tier demo Dim 6).
//
// Critical correctness invariants (per locked decision 4 + CC-1):
//   - Promise.allSettled, NOT Promise.all. One model failing must not
//     short-circuit the whole audit.
//   - Defensive synthesizeFallbackCell(reason, modelId, query) — handles
//     Error / string / null / POJO / non-serializable rejection values.
//     Real model_id (not "unknown") so the cell is cacheable at the same
//     key it would have been cached at, and so per-model averages stay
//     unaffected by the rejection class.
//   - Explicit row-build mapping: unmeasurable: cell.result.unmeasurable
//     ? 1 : 0, truncated: cell.result.truncated ? 1 : 0. Without this
//     explicit mapping, the M-6 corpus columns silently default to 0 and
//     the spec invariant (unmeasurable cells excluded) breaks at the
//     persistence layer.

import { runLadder, type LadderEnv } from "./ladder";
import { generatePromptSet, type PromptSetGenEnv } from "./promptset";
import {
  ALL_MODEL_IDS,
  DIM6_ENGINE_VERSION,
  type CellEnvelope,
  type CellResult,
  type Dim6Result,
  type ModelId,
  type PromptSetQuery,
} from "./types";

export interface OrchestratorEnv extends LadderEnv, PromptSetGenEnv {}

export interface OrchestratorInput {
  scanUrl: string;
  signals?: {
    homepageHtml?: string | null;
    titleTag?: string | null;
  };
  competitorHosts?: string[];
}

// Defensive fallback synthesis. Per CC-1 + Task 8: handles anything from
// `new Error("...")` through `null` through a non-serializable POJO. The
// resulting cell is cacheable (real modelId) and unmeasurable:true so it's
// excluded from the score formula.
export function synthesizeFallbackCell(
  reason: unknown,
  modelId: ModelId,
  query: PromptSetQuery
): CellEnvelope {
  let reasonStr: string;
  if (reason instanceof Error) {
    reasonStr = reason.message || reason.name || "Error";
  } else if (typeof reason === "string") {
    reasonStr = reason;
  } else if (reason === null) {
    reasonStr = "null";
  } else if (reason === undefined) {
    reasonStr = "undefined";
  } else {
    try {
      reasonStr = JSON.stringify(reason);
    } catch {
      // Non-serializable POJO (e.g. circular ref). Use Object.prototype.toString.
      reasonStr = Object.prototype.toString.call(reason);
    }
  }
  const cell: CellResult = {
    text: null,
    score: 0,
    unmeasurable: true,
    truncated: false,
    notes: `Orchestrator fallback (rejection): ${reasonStr.slice(0, 240)}`,
  };
  return {
    query,
    modelId,
    result: cell,
  };
}

/**
 * Run the Dim 6 audit. Generates a prompt set, dispatches across 4 models
 * via the TP-7 ladder, returns aggregated Dim6Result. Never throws — every
 * failure path produces an unmeasurable cell that's excluded from the score
 * formula.
 */
export async function runDim6Orchestrator(
  env: OrchestratorEnv,
  input: OrchestratorInput
): Promise<Dim6Result> {
  const { scanUrl, signals = {}, competitorHosts = [] } = input;

  // Generate the prompt set (Task 7).
  const queries = await generatePromptSet(env, scanUrl, signals);

  // Build the (model × query) task list. Tasks are DEFERRED (function returning
  // a promise) — NOT pre-created promises. This is load-bearing for the
  // batched-concurrency pattern below: if we built `promise: runLadder(...)`
  // here, all 40 calls would fire at construction time regardless of the
  // batching loop, blowing past Cloudflare Workers' ~6-concurrent-fetch cap
  // and triggering "stalled HTTP response was canceled to prevent deadlock"
  // (verified live 2026-05-02 dogfood: 40 concurrent fetches → orchestrator
  // failure with subrequest-cap exhaustion + stalled-response cancellations).
  type Task = {
    query: PromptSetQuery;
    modelId: ModelId;
    run: () => Promise<CellResult>;
  };
  const tasks: Task[] = [];
  for (const query of queries) {
    for (const modelId of ALL_MODEL_IDS) {
      tasks.push({
        query,
        modelId,
        run: () =>
          runLadder(env, {
            modelId,
            prompt: query.text,
            targetUrl: scanUrl,
            competitorHosts,
          }),
      });
    }
  }

  // Batched concurrency. Workers caps in-flight fetch() at ~6 per isolate
  // (a runtime safety, not a billing limit — paid plan doesn't lift it).
  // Concurrency=5 leaves one slot of headroom for any other concurrent
  // fetches the audit-fulfill pipeline kicks off (corpus writes, R2 puts,
  // BR REST PDF gen). Total wall-time at 40 cells / batch-of-5 = 8 batches
  // × ~5-15s/batch = 40-120s, comfortably under maxDuration: 300.
  const CONCURRENCY = 5;
  const cells: CellEnvelope[] = [];
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((t) => t.run()));
    settled.forEach((s, j) => {
      const t = batch[j];
      if (s.status === "fulfilled") {
        cells.push({ query: t.query, modelId: t.modelId, result: s.value });
      } else {
        // Per CC-1 / Task 8: defensive fallback. Real modelId, real query.
        cells.push(synthesizeFallbackCell(s.reason, t.modelId, t.query));
      }
    });
  }

  return aggregateCells(cells);
}

export function aggregateCells(cells: CellEnvelope[]): Dim6Result {
  // Score formula: average of all cells where unmeasurable === false.
  // Truncated cells ARE INCLUDED (per locked decision 4) — they have a real
  // score even when capped by max_tokens.
  const measurable = cells.filter((c) => !c.result.unmeasurable);
  const unmeasurableCount = cells.length - measurable.length;
  const totalCells = cells.length;

  const score =
    measurable.length === 0
      ? null
      : Math.round(
          measurable.reduce((sum, c) => sum + c.result.score, 0) /
            measurable.length
        );

  // Per-model averages.
  const perModelAverage: Record<ModelId, number | null> = {
    "openai:gpt-4o": null,
    "anthropic:claude-sonnet": null,
    "google:gemini-2.0-flash": null,
    "perplexity:sonar": null,
  };
  for (const modelId of ALL_MODEL_IDS) {
    const ms = measurable.filter((c) => c.modelId === modelId);
    if (ms.length > 0) {
      perModelAverage[modelId] = Math.round(
        ms.reduce((s, c) => s + c.result.score, 0) / ms.length
      );
    }
  }

  return {
    score,
    cells,
    perModelAverage,
    unmeasurableCount,
    totalCells,
  };
}

export { DIM6_ENGINE_VERSION };
