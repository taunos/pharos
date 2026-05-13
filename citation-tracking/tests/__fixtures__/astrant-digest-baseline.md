# Citation-Tracking Digest — May 2026 (full month, 31 days)

*Internal instrumentation report. Baseline measurement phase — no success/failure determination per OQ-H methodology until threshold-lock derives from baseline cite-share distribution.*

## 1. Top-of-document warnings

*No warnings this period.*

## 2. Headline KPI

*Astrant cite-share this month: 0%. Baseline phase — model-side cite-share signal not yet detected. Per the methodology, the baseline window precedes threshold-lock; once baseline cite-share patterns are established, subsequent cite-share emergence is measured against them.*

### By axis

*No cites detected in this axis this period.*

## 3. Per-provider cite share

| Provider | Observations | Cited | Cite share | Errors | Rate-limit | Timeout |
|---|---:|---:|---:|---:|---:|---:|
| openai | 0 | 0 | 0.0% | 0 | 0 | 0 |
| anthropic | 0 | 0 | 0.0% | 0 | 0 | 0 |
| perplexity | 0 | 0 | 0.0% | 0 | 0 | 0 |
| gemini | 0 | 0 | 0.0% | 0 | 0 | 0 |

## 4. Per-prompt — prompts that produced cites

*No cites detected in this axis this period.*

## 5. Vocabulary association (D2)

*No coined-term mentions detected this period. D2 axis fires only when an agent surfaces "citation-confabulation methodology" without explicit Astrant cite — a deeper-ingestion-but-incomplete-attribution signal that builds slowly.*

## 6. Competitive context (D3)

*No competitor cites detected this period.*
## 7. Trend (month-over-month)

*Insufficient data for trend analysis; this is the first digest. Comparisons against prior months will appear from the second digest onward.*

## 8. Operational health

- Total probe rows ingested this period: **0**
- Validated rows (status=success): **0**
- Partial-coverage rows: **0** (0.00%)

### Per-provider error breakdown

| Provider | Error | Rate-limit | Timeout |
|---|---:|---:|---:|
| openai | 0 | 0 | 0 |
| anthropic | 0 | 0 | 0 |
| perplexity | 0 | 0 | 0 |
| gemini | 0 | 0 | 0 |

## 9. Methodology footer

- Engine version: `citation-tracking:v1`
- Digest generated: 2026-05-13T20:53:43.000Z
- Period: 2026-05-01 through 2026-05-31 (UTC, half-open interval)
- Cross-provider headline KPI uses OQ-I Mitigation 1 equal weighting; OQ-K-2 validity threshold (3-of-4 providers) applies.
- Replicates collapsed via OQ-J majority-cite rule (≥2 of 3 replicates per provider/prompt/day fired the cite axis → day-level cite_present=1).
