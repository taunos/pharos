// Wiring point for the Implementation acceptance checker (./impl-verify).
//
// The flow's delivery ({ sessionId, siteUrl, patchR2Key, patch }) is the
// checker's { patch } delivery shape; the MCP URL travels separately as
// verifyArtifacts' optional mcpUrl (lib/impl-verification.ts).
// Callers still handle null (fail closed): the mark-applied endpoint answers
// 503 and a verified session's Day-30 run fails and is retried.

import type { ImplVerifier } from "./impl-verification";
import { expectedFromDelivery, verifyArtifacts } from "./impl-verify";

export function loadImplVerifier(): ImplVerifier | null {
  return { expectedFromDelivery, verifyArtifacts };
}
