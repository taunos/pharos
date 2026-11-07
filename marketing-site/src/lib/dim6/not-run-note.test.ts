// r4: a Dim 6 run with no AI provider configured says "not run", not
// "network or provider failures".
import { describe, expect, it } from "vitest";
import { DIM6_NOT_RUN_NOTE, dim6AllUnmeasurableNote, noProviderConfigured } from "./runDim6";

const cell = (notes: string, unmeasurable = true) => ({ result: { unmeasurable, notes } });

describe("Dim 6 not-run vs failed", () => {
  it("every cell failed for a missing API key -> not run", () => {
    const cells = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_AI_API_KEY", "PERPLEXITY_API_KEY"].map((k) =>
      cell(`Templated fallback: HTTP 0: ${k} not set`),
    );
    expect(noProviderConfigured(cells)).toBe(true);
  });

  it("any network / provider failure -> failures, not 'not run'", () => {
    expect(noProviderConfigured([cell("Templated fallback: HTTP 0: OPENAI_API_KEY not set"), cell("Templated fallback: network/timeout: fetch failed")])).toBe(false);
    expect(noProviderConfigured([cell("Templated fallback: HTTP 401: OpenAI 401: bad key")])).toBe(false);
    expect(noProviderConfigured([])).toBe(false);
  });

  it("the two notes say different things", () => {
    expect(DIM6_NOT_RUN_NOTE).toMatch(/^Citation Visibility was not run on this report: no AI assistant was set up to answer the test questions\. It is not counted in your score\./);
    expect(DIM6_NOT_RUN_NOTE).not.toMatch(/network|provider failures/);
    expect(dim6AllUnmeasurableNote(40)).toContain("(network or provider failures)");
  });
});
