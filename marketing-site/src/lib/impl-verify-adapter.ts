// Wiring point for the Implementation acceptance checker.
//
// WIRE-AT-MERGE: the checker (./impl-verify) is built on branch
// claude/impl-verify-checks. Once it is merged, replace the body below with:
//
//   import { verifyArtifacts, expectedFromDelivery } from "./impl-verify";
//   export function loadImplVerifier(): ImplVerifier | null {
//     return { verifyArtifacts, expectedFromDelivery };
//   }
//
// Until then this returns null and every caller fails closed: the mark-applied
// endpoint answers 503 and a verified session's Day-30 run fails (and is
// retried by the next sweep) instead of sending.

import type { ImplVerifier } from "./impl-verification";

export function loadImplVerifier(): ImplVerifier | null {
  return null;
}
