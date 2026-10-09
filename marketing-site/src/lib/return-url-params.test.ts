import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { stripDodoReturnParams } from "./return-url-params";
import { middleware, config } from "../middleware";

describe("stripDodoReturnParams", () => {
  it("removes email, payment_id and status", () => {
    const out = stripDodoReturnParams(
      new URL("https://astrant.io/audit-results/abc?payment_id=pay_1&status=succeeded&email=a%40b.com"),
    );
    expect(out?.toString()).toBe("https://astrant.io/audit-results/abc");
  });

  it("keeps other params", () => {
    const out = stripDodoReturnParams(
      new URL("https://astrant.io/f2-success?utm=x&email=a%40b.com&keep=1"),
    );
    expect(out?.pathname).toBe("/f2-success");
    expect(out?.search).toBe("?utm=x&keep=1");
  });

  it("strips a single param on its own", () => {
    expect(stripDodoReturnParams(new URL("https://astrant.io/f2-success?status=failed"))?.toString())
      .toBe("https://astrant.io/f2-success");
  });

  it("returns null when none of the params are present", () => {
    expect(stripDodoReturnParams(new URL("https://astrant.io/audit-results/abc"))).toBeNull();
    expect(stripDodoReturnParams(new URL("https://astrant.io/audit-results/abc?utm=x"))).toBeNull();
  });

  it("does not mutate the input URL", () => {
    const input = new URL("https://astrant.io/audit-results/abc?email=a%40b.com");
    stripDodoReturnParams(input);
    expect(input.searchParams.get("email")).toBe("a@b.com");
  });
});

describe("middleware: Dodo return params", () => {
  it("303-redirects /audit-results/<id> to the cleaned URL with Referrer-Policy: no-referrer", () => {
    const res = middleware(
      new NextRequest("https://astrant.io/audit-results/abc?payment_id=p&status=succeeded&email=a%40b.com&x=1"),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://astrant.io/audit-results/abc?x=1");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("303-redirects /f2-success the same way", () => {
    const res = middleware(new NextRequest("https://astrant.io/f2-success?email=a%40b.com"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://astrant.io/f2-success");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("passes through a clean results URL", () => {
    const res = middleware(new NextRequest("https://astrant.io/audit-results/abc"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("matcher covers the two Dodo return paths", () => {
    expect(config.matcher).toContain("/audit-results/:sessionId");
    expect(config.matcher).toContain("/f2-success");
  });
});
