#!/usr/bin/env node
// marketing-site/scripts/sign-dodo-fixture.mjs
//
// Usage:
//   node scripts/sign-dodo-fixture.mjs <fixture-path> [webhook-id] [timestamp]
//
// Prints a curl command (using --data-binary to preserve exact body bytes) that
// POSTs the fixture to local /api/dodo-webhook with a valid Standard Webhooks
// signature. Use for offline reproducible F2 webhook testing without disabling
// signature verification in source.
//
// Requires DODO_WEBHOOK_SECRET in env. Source via:
//   bash:       export DODO_WEBHOOK_SECRET="<paste-value>"
//   PowerShell: $env:DODO_WEBHOOK_SECRET = "<paste-value>"
//
// Secret value comes from marketing-site/.dev.vars OR manually pasted (NOT from
// `wrangler secret list` — that lists names only; values are not retrievable
// post-set).
//
// Notes:
//   - Verifier rejects timestamps older than 300s (STALE_THRESHOLD_SEC in dodo.ts).
//     Generate + run the printed curl within 5 minutes; if STALE error, regenerate.
//   - --data-binary preserves all bytes including newlines. Do NOT use -d / --data
//     (those strip CR/LF and break the HMAC body match).

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const fixturePath = process.argv[2];
if (!fixturePath) {
  console.error("Usage: node sign-dodo-fixture.mjs <fixture-path> [webhook-id] [timestamp]");
  process.exit(1);
}

const webhookId = process.argv[3] ?? `msg_local_${Date.now()}`;
const timestamp = process.argv[4] ?? String(Math.floor(Date.now() / 1000));

const secret = process.env.DODO_WEBHOOK_SECRET;
if (!secret) {
  console.error("DODO_WEBHOOK_SECRET not set in environment.");
  console.error("Source it from marketing-site/.dev.vars OR paste manually.");
  console.error("NOTE: `wrangler secret list` lists names only — values are not retrievable post-set.");
  process.exit(1);
}

// Sign EXACT bytes that curl will send (no .trim()). curl --data-binary @file
// preserves all bytes including trailing newline; the HMAC must cover the same.
const body = readFileSync(fixturePath, "utf-8");

// Standard Webhooks spec: HMAC-SHA256 of `${webhook-id}.${webhook-timestamp}.${body}`.
// Mirror dodo.ts decodeSecret(): strip "whsec_" prefix + base64-decode; else UTF-8.
const rawSecret = secret.startsWith("whsec_")
  ? Buffer.from(secret.slice("whsec_".length), "base64")
  : Buffer.from(secret, "utf-8");

const signed = `${webhookId}.${timestamp}.${body}`;
const signature = createHmac("sha256", rawSecret).update(signed).digest("base64");

console.log(`curl -X POST http://localhost:8787/api/dodo-webhook \\
  -H "Content-Type: application/json" \\
  -H "webhook-id: ${webhookId}" \\
  -H "webhook-timestamp: ${timestamp}" \\
  -H "webhook-signature: v1,${signature}" \\
  --data-binary @${fixturePath}`);
