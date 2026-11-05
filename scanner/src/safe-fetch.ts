/**
 * Hardened fetching of user-supplied third-party sites (security pass
 * 2026-11-04). Logic copied from mcp-server/src/site-fetch.ts (reviewed);
 * Workers do not import from each other.
 *
 * - validateTargetUrl: http/https on ports 80/443 only; no credentials, no IP
 *   literals (v4 in any notation, v6), no localhost / single-label / internal
 *   or reserved-suffix hosts (BLOCKED_HOST_SUFFIXES), no empty labels, no
 *   characters outside [a-z0-9-] in a label. DNS names that resolve to
 *   private addresses are left to the Workers network
 *   (global_fetch_strictly_public).
 * - safeFetch: manual redirects (max 3), every hop re-validated, one overall
 *   deadline shared by every hop AND the body read.
 * - SafeResponse.body(): streaming read with a byte cap; cancels the stream
 *   (fire-and-forget) on cap, deadline or error instead of buffering an
 *   unbounded body. Never throws.
 */

export const MAX_REDIRECTS = 3;
/** HTML pages. */
export const MAX_HTML_BYTES = 2 * 1024 * 1024;
/** Plain-text files (llms.txt and the pages it links). */
export const MAX_TEXT_BYTES = 512 * 1024;
/** Small JSON documents (MCP card, OAuth metadata, DoH, tools/list). */
export const MAX_JSON_BYTES = 2 * 1024 * 1024;
/** OpenAPI specs: large real-world specs (several MB) must still parse. */
export const MAX_SPEC_BYTES = 10 * 1024 * 1024;

export class UnsafeUrlError extends Error {}

// E14 (code-quality audit 2026-11-05): the strictest list of the four copies
// (outreach's). A name matches when it IS the suffix or ends with "." + it.
// Kept in parity with parity/ssrf-guard-cases.json by ssrf-parity.test.ts.
const BLOCKED_HOST_SUFFIXES = [
  "localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "corp", "private",
  "test", "example", "invalid", "onion", "arpa",
];
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Throws UnsafeUrlError unless `raw` is a public http(s) URL on port 80/443. */
export function validateTargetUrl(raw: string | URL): URL {
  let u: URL;
  try {
    u = new URL(raw.toString());
  } catch {
    throw new UnsafeUrlError("URL is not valid.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https URLs are allowed.");
  }
  // WHATWG URL drops the scheme's default port, so "" means 80/443.
  if (u.port !== "" && u.port !== "80" && u.port !== "443") {
    throw new UnsafeUrlError("Only ports 80 and 443 are allowed.");
  }
  if (u.username !== "" || u.password !== "") {
    throw new UnsafeUrlError("URLs with credentials are not allowed.");
  }
  // IPv6 literals keep their brackets in .hostname. IPv4 literals in any
  // notation (decimal, hex, octal, short forms) are normalized to dotted quad
  // by the URL parser, so one pattern covers them all.
  const rawHost = u.hostname.toLowerCase();
  if (rawHost.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}\.?$/.test(rawHost)) {
    throw new UnsafeUrlError("IP address URLs are not allowed; use a domain name.");
  }
  // Strip every trailing dot ("localhost.." is still localhost), then refuse
  // empty labels anywhere else ("example..com") and non-hostname characters.
  const host = rawHost.replace(/\.+$/, "");
  const labels = host.split(".");
  if (
    host === "" ||
    rawHost.endsWith("..") || // E14: at most one trailing dot ("example.com." is fine)
    labels.length < 2 ||
    labels.some((label) => !LABEL_RE.test(label)) ||
    !/[a-z]/.test(labels[labels.length - 1]) ||
    BLOCKED_HOST_SUFFIXES.some((s) => host === s || host.endsWith("." + s))
  ) {
    throw new UnsafeUrlError("Local or internal hostnames are not allowed.");
  }
  return u;
}

/** true when `raw` passes validateTargetUrl. */
export function isSafeTargetUrl(raw: string | URL): boolean {
  try {
    validateTargetUrl(raw);
    return true;
  } catch {
    return false;
  }
}

export class DeadlineError extends Error {}

/** Shared overall deadline: one AbortController plus a promise that rejects at expiry. */
export class Deadline {
  readonly controller = new AbortController();
  private timer!: ReturnType<typeof setTimeout>;
  private expired: Promise<never>;

  constructor(ms: number) {
    this.expired = new Promise<never>((_, reject) => {
      this.timer = setTimeout(() => {
        const err = new DeadlineError(`Timed out after ${ms} ms.`);
        this.controller.abort(err);
        reject(err);
      }, ms);
    });
    this.expired.catch(() => {});
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Races `p` against the deadline, so a fetch impl that ignores the signal still stops. */
  race<T>(p: Promise<T>): Promise<T> {
    return Promise.race([p, this.expired]);
  }

  clear(): void {
    clearTimeout(this.timer);
  }
}

/** Fire-and-forget cancel: a hostile stream whose cancel() never settles must not block us. */
function cancelQuietly(c: { cancel(): Promise<void> } | null | undefined): void {
  try {
    c?.cancel().catch(() => {});
  } catch {
    // cancel() threw synchronously (e.g. locked stream); nothing to release.
  }
}

export interface CappedBody {
  /** Decoded text: the first maxBytes on truncation, "" on a read error. */
  text: string;
  /** Bytes seen on the wire (can exceed text's bytes when countUpTo is used). */
  bytes: number;
  /** The byte cap was hit; text is a prefix of the body. */
  truncated: boolean;
  /** The WHOLE body was read without error and without truncation. */
  complete: boolean;
}

export interface BodyOpts {
  maxBytes: number;
  /**
   * Keep reading (and counting, without buffering) past maxBytes up to this
   * many bytes, so a caller can size a body it will not hold in memory.
   */
  countUpTo?: number;
}

async function readCapped(res: Response, deadline: Deadline, opts: BodyOpts): Promise<CappedBody> {
  const failed: CappedBody = { text: "", bytes: 0, truncated: false, complete: false };
  const maxBytes = opts.maxBytes;
  const countUpTo = Math.max(opts.countUpTo ?? maxBytes, maxBytes);
  const stream = (res as { body?: ReadableStream<Uint8Array> | null }).body;
  if (!stream) {
    // No stream: a null-body Response (text() is ""), or a minimal stub.
    try {
      const t = await deadline.race(res.text());
      const enc = new TextEncoder().encode(t);
      if (enc.byteLength <= maxBytes) return { text: t, bytes: enc.byteLength, truncated: false, complete: true };
      return {
        text: new TextDecoder().decode(enc.subarray(0, maxBytes)),
        bytes: Math.min(enc.byteLength, countUpTo),
        truncated: true,
        complete: false,
      };
    } catch {
      return failed;
    }
  }
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = stream.getReader();
  } catch {
    return failed;
  }
  const chunks: Uint8Array[] = [];
  let kept = 0;
  let seen = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await deadline.race(reader.read());
      if (done) break;
      seen += value.byteLength;
      if (kept < maxBytes) {
        const room = maxBytes - kept;
        const part = value.byteLength > room ? value.subarray(0, room) : value;
        chunks.push(part);
        kept += part.byteLength;
      }
      if (seen > maxBytes) truncated = true;
      if (seen >= countUpTo && truncated) {
        seen = countUpTo;
        break;
      }
    }
  } catch {
    cancelQuietly(reader);
    // Past the cap we were only counting: keep the prefix (still truncated).
    if (!truncated) return failed;
  }
  if (truncated) cancelQuietly(reader);
  else {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  const all = new Uint8Array(kept);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return { text: new TextDecoder().decode(all), bytes: seen, truncated, complete: !truncated };
}

export interface SafeResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  /** URL of the final hop (after any followed redirects). */
  url: string;
  redirects: number;
  /** Reads the body under the same deadline, capped. Never throws. Call at most once. */
  body(opts: BodyOpts): Promise<CappedBody>;
  /** Releases an unread body and the deadline. */
  discard(): void;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type FetchLike =(input: string, init?: RequestInit) => Promise<Response>;

export interface SafeFetchOpts {
  /** Overall deadline for every hop plus the body read. */
  timeoutMs: number;
  maxRedirects?: number;
  fetchImpl?: FetchLike;
}

/**
 * fetch with manual redirects. Every hop (including the first) is validated;
 * an unsafe target, a network error or the deadline returns null. When the
 * hop budget is exhausted the last 3xx response is returned as-is. Only
 * 301/302/303/307/308 are followed; any other status (incl. 304) is returned.
 * 307/308 replay the method and body; 303 switches to a bodiless GET (HEAD
 * stays HEAD); 301/302 switch to GET only for POST (the fetch spec's rules).
 */
export async function safeFetch(url: string, init: RequestInit = {}, opts: SafeFetchOpts): Promise<SafeResponse | null> {
  const maxRedirects = Math.min(opts.maxRedirects ?? MAX_REDIRECTS, MAX_REDIRECTS);
  const fetchImpl = opts.fetchImpl ?? ((i: string, n?: RequestInit) => fetch(i, n));
  const deadline = new Deadline(opts.timeoutMs);
  let method = (init.method ?? "GET").toUpperCase();
  let reqBody = init.body;
  const headers = new Headers(init.headers);
  try {
    let target = validateTargetUrl(url).toString();
    let redirects = 0;
    for (;;) {
      const res = await deadline.race(
        fetchImpl(target, {
          ...init,
          headers,
          method,
          body: reqBody,
          redirect: "manual",
          signal: deadline.signal,
        })
      );
      // Only the five redirect statuses are followed (not 300/304/305/306).
      const location = REDIRECT_STATUSES.has(res.status) ? res.headers.get("location") : null;
      if (!location || redirects >= maxRedirects) {
        let consumed = false;
        return {
          status: res.status,
          ok: res.ok,
          headers: res.headers,
          url: res.url || target,
          redirects,
          async body(bodyOpts: BodyOpts): Promise<CappedBody> {
            if (consumed) return { text: "", bytes: 0, truncated: false, complete: false };
            consumed = true;
            try {
              return await readCapped(res, deadline, bodyOpts);
            } finally {
              deadline.clear();
            }
          },
          discard(): void {
            if (!consumed) {
              consumed = true;
              cancelQuietly((res as { body?: ReadableStream | null }).body);
            }
            deadline.clear();
          },
        };
      }
      cancelQuietly((res as { body?: ReadableStream | null }).body);
      const next = validateTargetUrl(new URL(location, target));
      if (next.origin !== new URL(target).origin && headers.has("authorization")) {
        // Never forward credentials to another origin (fetch's own rule).
        headers.delete("authorization");
      }
      target = next.toString();
      // Fetch-spec method rewriting: 303 -> GET (HEAD stays HEAD); 301/302 ->
      // GET only for POST; 307/308 keep method and body.
      if ((res.status === 303 && method !== "HEAD") || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        reqBody = undefined;
      }
      redirects++;
    }
  } catch {
    deadline.clear();
    return null;
  }
}
