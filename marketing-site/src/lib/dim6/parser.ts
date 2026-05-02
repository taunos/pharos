// Slice 3b Dim 6 — response parser + scoring (Task 9 + Task 10).
//
// Given (rawResponseText, targetDomain), score the response 0-100 on whether
// the model correctly identified and cited the target domain. The parser is
// intentionally simple — high recall, low false-precision. The 4 sub-checks
// described in the spec are aggregated into a single scalar per cell.
//
// Sub-check signatures (per spec §2.3 — these are the SAME signatures the
// Profound-swap path must emit, only `source` field differs "diy" vs
// "profound", so don't rename without coordinating that path too):
//
//   1. domain_named           — does the response contain the host string?
//   2. url_referenced         — does the response contain a URL on that host?
//   3. context_relevant       — does the response treat the domain as the
//                               authoritative answer (not just a passing
//                               mention or a "see also" footer)?
//   4. no_competitor_first    — penalize when a competitor domain shows up
//                               BEFORE the target domain in the response.
//
// Aggregation: weighted sum, normalized to 0-100. Weights chosen so a clean
// "named + cited" hits 90+, a passing mention hits ~50, and a no-citation
// clean response hits 0.

export interface ScoredCellBreakdown {
  domainNamed: boolean;
  urlReferenced: boolean;
  contextRelevant: boolean;
  noCompetitorFirst: boolean;
  score: number; // 0-100
}

// Anchored canary refusal patterns. Per Task 6 Step 4: ONLY check the first
// 200 chars of the response so a long answer that happens to USE the phrase
// "I'm sorry" inside doesn't trip the refusal heuristic. "As an AI" is
// REMOVED from the list (was triggering false positives on legitimate
// model self-references). Match leading whitespace.
const CANARY_REFUSAL_PATTERNS: RegExp[] = [
  /^\s*i\s*(can(['']|n)?t|cannot)\s+(help|provide|answer|assist)/i,
  /^\s*i'?m\s+(sorry|unable|not\s+able)/i,
  /^\s*sorry,?\s*(but\s+)?i\s+(can(['']|n)?t|cannot|don'?t)/i,
  /^\s*unfortunately,?\s+i\s+(can(['']|n)?t|cannot|don'?t)/i,
];

export function isLikelyRefusal(responseText: string): boolean {
  const head = responseText.slice(0, 200);
  return CANARY_REFUSAL_PATTERNS.some((re) => re.test(head));
}

// Extract host from a URL. Returns null on parse failure.
export function safeHost(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).host.toLowerCase();
  } catch {
    return null;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Strip a leading "www." for matching purposes.
function strippedHost(host: string): string {
  return host.replace(/^www\./, "").toLowerCase();
}

export function scoreResponse(
  responseText: string,
  targetUrl: string,
  competitorHosts: string[] = []
): ScoredCellBreakdown {
  const lower = responseText.toLowerCase();
  const targetHost = safeHost(targetUrl);
  const targetStripped = targetHost ? strippedHost(targetHost) : null;

  // Sub-check 1: domain_named
  // Match either the full host or the stripped (no www.) variant.
  let domainNamed = false;
  if (targetHost) {
    if (lower.includes(targetHost)) domainNamed = true;
    else if (targetStripped && lower.includes(targetStripped)) domainNamed = true;
  }

  // Sub-check 2: url_referenced
  // Find all URLs in the response, check if any host matches the target.
  let urlReferenced = false;
  const urlMatches = responseText.match(/https?:\/\/[^\s)>\]'"]+/gi) ?? [];
  for (const u of urlMatches) {
    const h = safeHost(u);
    if (!h) continue;
    if (targetHost && (h === targetHost || strippedHost(h) === targetStripped)) {
      urlReferenced = true;
      break;
    }
  }

  // Sub-check 3: context_relevant
  // Heuristic: domain appears in the FIRST HALF of the response (suggesting
  // it's the principal subject), not just a footer-style mention. We look
  // at first 50% of text length.
  let contextRelevant = false;
  if (targetHost && responseText.length > 0) {
    const firstHalfEnd = Math.max(200, Math.floor(responseText.length / 2));
    const firstHalf = responseText.slice(0, firstHalfEnd).toLowerCase();
    if (firstHalf.includes(targetHost) || (targetStripped && firstHalf.includes(targetStripped))) {
      contextRelevant = true;
    }
  }

  // Sub-check 4: no_competitor_first
  // Only meaningful when at least one competitor host is provided. If a
  // competitor host appears BEFORE the target, fail. With no competitor
  // list (current default — competitor enumeration is future work), pass
  // by default so the score is "neutral" rather than always-pass-or-fail
  // depending on a list we don't yet have.
  let noCompetitorFirst = true;
  if (targetHost && competitorHosts.length > 0) {
    const targetIdx = (() => {
      if (lower.includes(targetHost)) return lower.indexOf(targetHost);
      if (targetStripped && lower.includes(targetStripped)) return lower.indexOf(targetStripped);
      return -1;
    })();
    if (targetIdx >= 0) {
      for (const c of competitorHosts) {
        const cLow = c.toLowerCase();
        const re = new RegExp(`\\b${escapeRegex(cLow)}\\b`, "i");
        const m = re.exec(lower);
        if (m && m.index < targetIdx) {
          noCompetitorFirst = false;
          break;
        }
      }
    } else {
      // Target not present at all and competitor present → competitor first
      const competitorPresent = competitorHosts.some((c) =>
        lower.includes(c.toLowerCase())
      );
      if (competitorPresent) noCompetitorFirst = false;
    }
  }

  // Aggregate. Weights (sum 100):
  //   domain_named         40
  //   url_referenced       30
  //   context_relevant     20
  //   no_competitor_first  10
  let score = 0;
  if (domainNamed) score += 40;
  if (urlReferenced) score += 30;
  if (contextRelevant) score += 20;
  if (noCompetitorFirst) score += 10;

  return { domainNamed, urlReferenced, contextRelevant, noCompetitorFirst, score };
}
