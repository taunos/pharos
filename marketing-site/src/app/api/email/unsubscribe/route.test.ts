// E9 (code-quality audit 2026-11-05): a bare GET never unsubscribes (mail link
// scanners follow GETs); the confirmation page POSTs back; RFC 8058 one-click
// POST still unsubscribes directly.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSqliteD1, readMigration, type SqliteD1 } from "@/lib/test-support/sqlite-d1";
import { mintUnsubscribeToken } from "@/lib/email-suppressions";

const h = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: h.env }) }));

import { GET, POST } from "./route";
import type { NextRequest } from "next/server";

const KEY = "unsub-signing-key";
let sq: SqliteD1;
const rows = () => (sq.db.prepare("SELECT COUNT(*) AS n FROM email_suppressions").get() as { n: number }).n;
const req = (method: string, token: string | null) =>
  new Request(`https://astrant.io/api/email/unsubscribe${token === null ? "" : `?token=${encodeURIComponent(token)}`}`, {
    method,
    ...(method === "POST" ? { headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" } : {}),
  }) as unknown as NextRequest;

beforeEach(() => {
  sq = createSqliteD1([readMigration("0011_email_suppressions.sql")]);
  h.env = { CITATION_DB: sq.d1, EMAIL_UNSUB_SIGNING_KEY: KEY };
});

describe("E9 — /api/email/unsubscribe is GET-confirm → POST", () => {
  it("GET with a valid token renders a confirmation form and writes NOTHING", async () => {
    const token = await mintUnsubscribeToken({ EMAIL_UNSUB_SIGNING_KEY: KEY }, "jane@example.com");
    const res = await GET(req("GET", token));
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(html).toContain('<form method="POST"');
    expect(html).toContain(`action="/api/email/unsubscribe?token=${encodeURIComponent(token)}"`);
    expect(html).toContain("Yes, unsubscribe me");
    expect(rows()).toBe(0);
  });

  it("POST (form button or RFC 8058 one-click) unsubscribes, idempotently", async () => {
    const token = await mintUnsubscribeToken({ EMAIL_UNSUB_SIGNING_KEY: KEY }, "jane@example.com");
    const res = await POST(req("POST", token));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("You've been unsubscribed.");
    expect(rows()).toBe(1);
    await POST(req("POST", token));
    expect(rows()).toBe(1);
  });

  it("invalid / missing token → 400 on both methods, no write", async () => {
    expect((await GET(req("GET", "bad.token"))).status).toBe(400);
    expect((await POST(req("POST", "bad.token"))).status).toBe(400);
    expect((await GET(req("GET", null))).status).toBe(400);
    expect(rows()).toBe(0);
  });
});
