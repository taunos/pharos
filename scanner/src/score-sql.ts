// Invariant-bearing SQL for score-admin capture / unsubscribe, extracted so the
// P0-C2 privacy invariants can be verified against a real SQLite engine
// (node:sqlite) using the exact statements the handlers run — no drift.

// Capture / set-email. Enforces the P0-C2 invariant at the DB: an unsubscribed
// row (unsubscribed_at IS NOT NULL) can never regain email_opted_in_rescan=1;
// opt-in is clamped to 0 until a dedicated resubscribe op clears unsubscribed_at.
// Bind order: email, opted_in, unsubscribe_token, scan_id.
export const CAPTURE_SET_EMAIL_SQL = `UPDATE scans
    SET email = ?,
        email_opted_in_rescan = CASE WHEN unsubscribed_at IS NULL THEN ? ELSE 0 END,
        unsubscribe_token = ?
  WHERE id = ?`;

// P0-C2 Chunk G: guarded variant, executed ONLY when the privacy-integration
// gate (PRIVACY_INTEGRATION_MODE) is on; the legacy statement above remains the
// gate-off bytes. Adds the tombstone predicate + the free/expired-op-lease
// predicate; the unsubscribed-clamp CASE is byte-identical to the legacy
// statement. Bind order: email, opted_in, unsubscribe_token, scan_id, live —
// `live` is a fresh Date.now() sample at dispatch.
export const CAPTURE_SET_EMAIL_GUARDED_SQL = `UPDATE scans
    SET email = ?,
        email_opted_in_rescan = CASE WHEN unsubscribed_at IS NULL THEN ? ELSE 0 END,
        unsubscribe_token = ?
  WHERE id = ? AND retention_locked_at IS NULL
    AND (op_lease_id IS NULL OR op_lease_expires_at < ?)`;

// Unsubscribe. Sets unsubscribed_at (idempotent) AND clears the opt-in flag, so
// an unsubscribed row falls into the retention cohort instead of being retained
// forever. Bind order: now, scan_id.
export const UNSUBSCRIBE_SQL = `UPDATE scans
    SET unsubscribed_at = COALESCE(unsubscribed_at, ?),
        email_opted_in_rescan = 0
  WHERE id = ?`;
