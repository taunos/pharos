import { describe, it, expect } from "vitest";
import {
  hmacIp,
  checkTriageIpRateLimit,
  checkDeleteMeRateLimit,
  checkF2CheckoutCreateRateLimit,
} from "./rate-limit-kv";

describe("hmacIp — IP pseudonymization (OD#7)", () => {
  it("is deterministic for the same IP + secret", async () => {
    expect(await hmacIp("secret", "203.0.113.5")).toBe(await hmacIp("secret", "203.0.113.5"));
  });
  it("never contains the raw IP and is 64-hex", async () => {
    const h = await hmacIp("secret", "203.0.113.5");
    expect(h).not.toContain("203.0.113.5");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it("normalizes surrounding whitespace and case", async () => {
    expect(await hmacIp("s", " 203.0.113.5 ")).toBe(await hmacIp("s", "203.0.113.5"));
    expect(await hmacIp("s", "2001:DB8::1")).toBe(await hmacIp("s", "2001:db8::1"));
  });
  it("differs by IP and by secret", async () => {
    expect(await hmacIp("s", "1.1.1.1")).not.toBe(await hmacIp("s", "1.1.1.2"));
    expect(await hmacIp("s1", "1.1.1.1")).not.toBe(await hmacIp("s2", "1.1.1.1"));
  });
});

describe("rate limiters fail closed when the hash secret is absent", () => {
  // KV that throws if touched — proves no raw-IP key is written on the fail-closed path.
  const kv = {
    get: () => { throw new Error("KV must not be touched when failing closed"); },
    put: () => { throw new Error("KV must not be touched when failing closed"); },
  } as unknown as KVNamespace;

  it("triage denies and flags misconfigured (→ caller returns 503, not 429)", async () => {
    const r = await checkTriageIpRateLimit(kv, "1.1.1.1", undefined);
    expect(r.allowed).toBe(false);
    expect(r.misconfigured).toBe(true);
  });
  it("delete-me denies and flags misconfigured", async () => {
    const r = await checkDeleteMeRateLimit(kv, "1.1.1.1", "eh", undefined);
    expect(r.allowed).toBe(false);
    expect(r.misconfigured).toBe(true);
  });
  it("f2-checkout denies and flags misconfigured", async () => {
    const r = await checkF2CheckoutCreateRateLimit(kv, "1.1.1.1", undefined);
    expect(r.allowed).toBe(false);
    expect(r.misconfigured).toBe(true);
  });
});
