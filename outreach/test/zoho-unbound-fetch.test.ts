import { afterEach, describe, expect, it, vi } from "vitest";
import { zohoFromEnv } from "../src/mail/zoho";

// Live bug 2026-11-05: the production client (built by zohoFromEnv, no injected
// fetch) called the global fetch as a method, and Workers threw "Illegal
// invocation" on the first scheduled tick. Reproduce Workers' this-check.
describe("zohoFromEnv default fetch", () => {
  const real = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = real;
  });

  it("calls the global fetch unbound (no Illegal invocation)", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(function (this: unknown, input: RequestInfo | URL) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      calls.push(String(input));
      return Promise.resolve(new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 }));
    }) as unknown as typeof fetch;

    const c = zohoFromEnv({
      MAIL_OAUTH_CLIENT_ID: "id",
      MAIL_OAUTH_CLIENT_SECRET: "secret",
      MAIL_OAUTH_REFRESH_TOKEN: "refresh",
      MAIL_FROM: "bruno@getastrant.com",
    });
    expect(c).not.toBeNull();
    // drainInbox refreshes the token first; later calls may fail on the fake
    // response shape, which is fine: only the unbound call matters here.
    await c!.drainInbox(null, 1).catch(() => undefined);
    expect(calls.some((u) => u.startsWith("https://accounts.zoho.com/oauth/v2/token"))).toBe(true);
  });
});
