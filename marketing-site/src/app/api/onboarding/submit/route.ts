// F3 D7: form-submit handler. Validates token, direct-D1 writes via cross-bound
// CITATION_DB (OQ-15.A), UPSERT semantics on customer_id, OQ-16.A belt-and-suspenders
// ceiling check. See spec v3.2 §7.

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyOnboardingToken, type OnboardingTokenEnv } from "@/lib/onboarding-token";
import type { SessionRecord } from "@/lib/audit-types";

interface SubmitEnv extends OnboardingTokenEnv {
  CITATION_DB: D1Database;
  SESSIONS: KVNamespace;
  INTERNAL_FULFILL_KEY: string;
}

// Validation logic mirrored from citation-tracking/src/validation.ts (B1.3-followup).
// Inlined here to avoid cross-package drift; keep aligned if either side changes.
type BrandNameError = "BRAND_NAME_REQUIRED" | "BRAND_NAME_TOO_LONG" | "BRAND_NAME_INVALID_CHAR";

const INVISIBLE_RANGES: Array<[number, number]> = [
  [0x0000, 0x001f],
  [0x007f, 0x007f],
  [0x200b, 0x200d],
  [0xfeff, 0xfeff],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];

const ALLOWED_BRAND_RE = /^[\p{L}\p{N}\p{M} .\-&,']+$/u;

function hasInvisible(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    for (const [lo, hi] of INVISIBLE_RANGES) if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

function validateBrandName(value: unknown):
  | { ok: true; value: string }
  | { ok: false; code: BrandNameError; message: string } {
  if (typeof value !== "string")
    return { ok: false, code: "BRAND_NAME_REQUIRED", message: "brand_name must be a string" };
  const trimmed = value.trim();
  if (trimmed.length === 0)
    return { ok: false, code: "BRAND_NAME_REQUIRED", message: "brand_name must be non-empty" };
  if (trimmed.length > 50)
    return { ok: false, code: "BRAND_NAME_TOO_LONG", message: "brand_name must be at most 50 chars" };
  if (hasInvisible(trimmed))
    return { ok: false, code: "BRAND_NAME_INVALID_CHAR", message: "brand_name has control/invisible chars" };
  if (!ALLOWED_BRAND_RE.test(trimmed))
    return { ok: false, code: "BRAND_NAME_INVALID_CHAR", message: "brand_name allowed chars: letters, digits, space, . - & , '" };
  return { ok: true, value: trimmed };
}

const CATEGORY_ENUM = ["saas", "ecommerce", "fintech", "developer-tools", "other"];
const CUSTOMER_CEILING = 3;

export async function POST(request: Request): Promise<Response> {
  const { env: rawEnv, ctx } = getCloudflareContext();
  const env = rawEnv as unknown as SubmitEnv;
  const form = await request.formData();
  const token = String(form.get("t") ?? "");
  const tokenResult = await verifyOnboardingToken(env, token);
  if (!tokenResult.ok) {
    return NextResponse.json(
      { code: tokenResult.code, message: tokenResult.message },
      { status: tokenResult.status },
    );
  }

  const brandResult = validateBrandName(form.get("brand_name"));
  if (!brandResult.ok) {
    return NextResponse.json({ code: brandResult.code, message: brandResult.message }, { status: 400 });
  }

  const domain = String(form.get("domain") ?? "").trim();
  if (!/^https?:\/\/[\w.-]+/.test(domain) && !/^[\w.-]+\.[\w]{2,}$/.test(domain)) {
    return NextResponse.json(
      { code: "DOMAIN_INVALID", message: "domain required (e.g., example.com)" },
      { status: 400 },
    );
  }

  const category = String(form.get("category") ?? "");
  if (!CATEGORY_ENUM.includes(category)) {
    return NextResponse.json({ code: "CATEGORY_INVALID", message: "category required" }, { status: 400 });
  }

  const competitorsCsv = String(form.get("competitors_csv") ?? "").trim();
  const competitorsRaw = competitorsCsv
    ? competitorsCsv.split(",").map((s) => s.trim()).filter((s) => s.length)
    : [];
  if (competitorsRaw.length > 5) {
    return NextResponse.json({ code: "COMPETITORS_TOO_MANY", message: "max 5 competitors" }, { status: 400 });
  }
  const competitorsValidated: string[] = [];
  for (const c of competitorsRaw) {
    const r = validateBrandName(c);
    if (!r.ok) {
      return NextResponse.json({ code: "COMPETITOR_INVALID", message: r.message }, { status: 400 });
    }
    competitorsValidated.push(r.value);
  }
  const competitorsJson = JSON.stringify(competitorsValidated);

  // Resolve subscription_id → customer_id via CITATION_DB.
  const subRow = await env.CITATION_DB.prepare(
    `SELECT customer_id, customer_email FROM subscriptions WHERE subscription_id = ?`,
  )
    .bind(tokenResult.subscriptionId)
    .first<{ customer_id: string; customer_email: string }>();
  if (!subRow) {
    return NextResponse.json(
      { code: "SUBSCRIPTION_NOT_FOUND", message: "subscription not found" },
      { status: 404 },
    );
  }

  const existing = await env.CITATION_DB.prepare(
    `SELECT 1 FROM customer_probe_targets WHERE customer_id = ?`,
  )
    .bind(subRow.customer_id)
    .first();

  const now = Math.floor(Date.now() / 1000);
  if (existing) {
    // UPSERT-update path.
    await env.CITATION_DB.prepare(
      `UPDATE customer_probe_targets
       SET brand_name = ?, domain = ?, category = ?, competitors = ?, updated_at = ?
       WHERE customer_id = ?`,
    )
      .bind(brandResult.value, domain, category, competitorsJson, now, subRow.customer_id)
      .run();
  } else {
    // Atomic INSERT-with-ceiling-check (per feedback_d1_vs_sqlite_semantics.md).
    const result = await env.CITATION_DB.prepare(
      `INSERT INTO customer_probe_targets
       (customer_id, domain, category, competitors, status, created_at, updated_at, brand_name)
       SELECT ?, ?, ?, ?, 'active', ?, ?, ?
       WHERE (SELECT COUNT(*) FROM customer_probe_targets WHERE status='active') < ?`,
    )
      .bind(subRow.customer_id, domain, category, competitorsJson, now, now, brandResult.value, CUSTOMER_CEILING)
      .run();
    if (result.meta.changes !== 1) {
      console.error(
        `F3_OVER_CAPACITY_DIRECT_BYPASS subscription_id=${tokenResult.subscriptionId.substring(0, 8)}...`,
      );
      return NextResponse.json(
        {
          code: "CUSTOMER_CEILING_REACHED",
          message: "Astrant is temporarily at capacity. We'll follow up once a slot opens.",
        },
        { status: 503 },
      );
    }
  }

  const subscriptionId = tokenResult.subscriptionId;

  const casResult = await env.CITATION_DB.prepare(
    `UPDATE subscriptions SET audit_fired_at = ? WHERE subscription_id = ? AND audit_fired_at IS NULL`,
  )
    .bind(now, subscriptionId)
    .run();

  if (casResult.meta.changes === 1) {
    const sub = await env.CITATION_DB.prepare(
      `SELECT customer_email FROM subscriptions WHERE subscription_id = ?`,
    )
      .bind(subscriptionId)
      .first<{ customer_email: string }>();

    if (!sub) {
      console.error(`F3_AUDIT_FIRE_NO_SUBSCRIPTION subscription_id=${subscriptionId}`);
    } else {
      const apSessionId = `ap-${subscriptionId}-${now}`;
      const sessionRecord: SessionRecord = {
        session_id: apSessionId,
        url: domain,
        email: sub.customer_email,
        status: "fulfilling",
        created_at: now,
      };
      await env.SESSIONS.put(
        `audit:${apSessionId}`,
        JSON.stringify(sessionRecord),
        { expirationTtl: 30 * 24 * 60 * 60 },
      );

      const auditFulfillUrl = new URL("/api/audit-fulfill", request.url).toString();
      ctx.waitUntil(
        fetch(auditFulfillUrl, {
          method: "POST",
          headers: {
            "x-internal-fulfill-key": env.INTERNAL_FULFILL_KEY,
            "content-type": "application/json",
          },
          body: JSON.stringify({ session_id: apSessionId }),
        }).catch((err) =>
          console.error(`F3_AUDIT_FULFILL_FIRE_FAILED session_id=${apSessionId}`, err),
        ),
      );
    }
  } else {
    const existing = await env.CITATION_DB.prepare(
      `SELECT subscription_id, audit_fired_at FROM subscriptions WHERE subscription_id = ?`,
    )
      .bind(subscriptionId)
      .first<{ subscription_id: string; audit_fired_at: number | null }>();
    if (!existing) {
      console.warn(
        `F3_AUDIT_FIRE_NO_SUB subscription_id=${subscriptionId} cas_changes=0 reason=subscription_row_absent`,
      );
    }
  }

  // 303 See Other: standard pattern for POST → GET redirect after form submit.
  // Browser navigates to /onboarding/done; back-button won't re-trigger the POST.
  return NextResponse.redirect(new URL("/onboarding/done", request.url), 303);
}
