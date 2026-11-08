// Free-tier half of the report panel (run.mjs --tier free). Runs the scanner's
// free-tier runScan and renders the three customer surfaces of the free Score:
//   - the results page /score/[id]: the REAL page component, rendered
//     server-side with react-dom/server (Next shims: next/link -> <a>,
//     next/image -> <img>, getCloudflareContext -> harness env, the scanner
//     client -> the scan in memory; capture state = first-time visitor, no
//     email captured);
//   - the Score PDF: renderScoreReportHTML only (the HTML string; no Browser
//     Rendering call);
//   - the "gap report ready" email: buildGapReportReadyPayload (text + html).
//     Rendered, NEVER sent.
// No AI, D1, KV, R2 or email writes: the scanner D1 is a no-op stub, CACHE is
// an in-memory Map, and nothing here holds a Resend key.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";

// Placeholder values for the rendered email and PDF (never real people).
export const HARNESS_EMAIL = "visitor@example.com";
const HARNESS_ORIGIN = "https://astrant.io";

// ── bundle ───────────────────────────────────────────────────────────────
export async function bundleFree({ REPO, HERE, NODE_PATHS, esbuild }) {
  const tag = crypto.createHash("sha1").update(REPO).digest("hex").slice(0, 8);
  const buildDir = path.join(HERE, "build", `free-${tag}`);
  fs.mkdirSync(buildDir, { recursive: true });
  const src = path.join(REPO, "marketing-site", "src");
  const fwd = (p) => JSON.stringify(p.replace(/\\/g, "/"));
  const stub = (name, body) => {
    const f = path.join(buildDir, name);
    fs.writeFileSync(f, body);
    return f;
  };
  const stubs = {
    "next/link": stub("next-link.tsx",
      `export default function Link({ href, children, prefetch, ...rest }: any) { void prefetch; return <a href={typeof href === "string" ? href : String(href)} {...rest}>{children}</a>; }\n`),
    "next/image": stub("next-image.tsx",
      `export default function Image({ src, alt, priority, ...rest }: any) { void priority; return <img src={typeof src === "string" ? src : src?.src} alt={alt} {...rest} />; }\n`),
    "@opennextjs/cloudflare": stub("opennext.ts",
      `export function getCloudflareContext() { return { env: (globalThis as any).__harnessEnv }; }\n`),
    "@/lib/score-scanner-client": stub("scanner-client.ts",
      [
        `export async function getPublicScan(id: string) { const s = (globalThis as any).__harnessScan; return s && s.id === id ? { ok: true, data: s } : { ok: false, error: "404" }; }`,
        `export async function getScanState() { return (globalThis as any).__harnessState; }`,
        "",
      ].join("\n")),
  };
  const entry = stub("entry-free.tsx", [
    `export * as scanner from ${fwd(path.join(REPO, "scanner/src/run-scan.ts"))};`,
    `export * as pdf from ${fwd(path.join(src, "lib/score-pdf-template.ts"))};`,
    `export * as email from ${fwd(path.join(src, "lib/score-email.ts"))};`,
    `export { default as ScorePage } from ${fwd(path.join(src, "app/score/[id]/page.tsx"))};`,
    `export { renderToStaticMarkup } from "react-dom/server";`,
    "",
  ].join("\n"));
  const plugin = {
    name: "harness-next-shims",
    setup(b) {
      b.onResolve({ filter: /^(next\/link|next\/image|@opennextjs\/cloudflare|@\/lib\/score-scanner-client)$/ }, (a) => ({ path: stubs[a.path] }));
      b.onResolve({ filter: /^@\// }, (a) => {
        const base = path.join(src, a.path.slice(2));
        for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
          if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return { path: base + ext };
        }
        return undefined;
      });
    },
  };
  const outfile = path.join(buildDir, "bundle-free.mjs");
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    jsx: "automatic",
    outfile,
    external: ["cloudflare:*"],
    nodePaths: NODE_PATHS,
    plugins: [plugin],
    logLevel: "error",
    define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  });
  return import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
}

// ── HTML -> visible text (markdown-ish, line oriented for check.mjs) ─────
function removeElements(html, openRe, tag) {
  let out = html;
  for (;;) {
    const m = openRe.exec(out);
    if (!m) return out;
    let depth = 1;
    let i = m.index + m[0].length;
    const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    tagRe.lastIndex = i;
    let t;
    while (depth > 0 && (t = tagRe.exec(out))) {
      depth += t[1] ? -1 : 1;
      i = tagRe.lastIndex;
    }
    out = out.slice(0, m.index) + out.slice(i);
    openRe.lastIndex = 0;
  }
}

export function htmlToText(html) {
  let h = String(html);
  h = h.replace(/<!--[\s\S]*?-->/g, "");
  h = h.replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, "");
  // Hidden from people: aria-hidden blocks (PDF watermark, the EmailGate
  // honeypot). Their text is never read by a visitor.
  h = removeElements(h, /<div\b[^>]*aria-hidden="true"[^>]*>/i, "div");
  // Template-literal indentation between table cells is not visible text.
  h = h.replace(/\s+(?=<(?:t[dh]\b|\/tr>|\/thead>|\/tbody>))/gi, "");
  h = h.replace(/<\/span>/gi, "</span> ");
  h = h.replace(/<h([1-6])\b[^>]*>/gi, (_, n) => `\n${"#".repeat(Number(n))} `);
  h = h.replace(/<li\b[^>]*>/gi, "\n- ");
  h = h.replace(/<tr\b[^>]*>/gi, "\n| ");
  h = h.replace(/<\/t[dh]>/gi, " | ");
  h = h.replace(/<br\s*\/?>/gi, "\n");
  h = h.replace(/<input\b[^>]*placeholder="([^"]*)"[^>]*>/gi, "[input: $1]");
  h = h.replace(/<input\b[^>]*type="checkbox"[^>]*>/gi, "[ ] ");
  h = h.replace(/<\/(p|div|section|ul|ol|table|thead|tbody|footer|header|main|nav|h[1-6]|form|label|button)>/gi, "\n");
  h = h.replace(/<(p|div|section|footer|header|main|form|button)\b[^>]*>/gi, "\n");
  h = h.replace(/<[^>]+>/g, "");
  h = h
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  const lines = h.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim());
  const out = [];
  for (const l of lines) {
    if (l === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    if (l === "|") continue;
    out.push(l);
  }
  return out.join("\n").trim() + "\n";
}

function makeKv() {
  const m = new Map();
  return {
    async get(k, type) {
      const v = m.has(k) ? m.get(k) : null;
      if (v === null) return null;
      return type === "json" || type?.type === "json" ? JSON.parse(v) : v;
    },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
    async list() { return { keys: [...m.keys()].map((name) => ({ name })), list_complete: true }; },
  };
}
function makeNoopD1() {
  const stmt = {
    bind() { return stmt; },
    async run() { return { success: true, meta: {} }; },
    async first() { return null; },
    async all() { return { results: [], success: true }; },
  };
  return { prepare() { return stmt; }, async batch(s) { return s.map(() => ({ success: true })); } };
}

const banner = (surface, what) =>
  `> HARNESS NOTE: free Score ${surface}, ${what}. Lines below are what the visitor reads.`;

/** One site, free tier. Writes scan.json, score.json and the 3 surfaces. */
export async function runSiteFree(F, site, dir, { checkoutOpen = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const env = { DB: makeNoopD1(), CACHE: makeKv(), CF_ACCOUNT_ID: "harness-local", CF_API_TOKEN: "harness-local-placeholder" };
  const scan = await F.scanner.runScan(env, site.url, "free", { useCache: false, throwOnInsertFail: false });
  fs.writeFileSync(path.join(dir, "scan.json"), JSON.stringify(scan, null, 2));
  // check.mjs reads {scan, gaps}; the free Score has no remediation gaps.
  fs.writeFileSync(path.join(dir, "score.json"), JSON.stringify({ scan, gaps: [] }, null, 2));

  // 1. results page (first-time visitor: no email captured, no token).
  globalThis.__harnessScan = scan;
  globalThis.__harnessState = { ok: true, has_email_captured: false, pdf_ready: false, pdf_deferred_until_tomorrow: false };
  globalThis.__harnessEnv = {
    UNSUBSCRIBE_SECRET: "harness-local",
    INTERNAL_SCANNER_ADMIN_KEY: "harness-local",
    AUDIT_CHECKOUT_ENABLED: checkoutOpen ? "true" : "false",
  };
  const pageEl = await F.ScorePage({ params: Promise.resolve({ id: scan.id }), searchParams: Promise.resolve({}) });
  const pageHtml = F.renderToStaticMarkup(pageEl);
  fs.writeFileSync(path.join(dir, "score-page.html"), pageHtml);
  fs.writeFileSync(path.join(dir, "score-page.md"),
    `${banner("results page /score/[id]", "server-rendered from page.tsx (first-time visitor, Audit checkout " + (checkoutOpen ? "open" : "closed") + ")")}\n\n${htmlToText(pageHtml)}`);

  // 2. Score PDF (HTML string only; production prints it with Browser Rendering).
  const pdfHtml = F.pdf.renderScoreReportHTML({
    scan, email: HARNESS_EMAIL, scoringVersion: scan.scoring_version, auditCheckoutEnabled: checkoutOpen,
  });
  fs.writeFileSync(path.join(dir, "score-pdf.html"), pdfHtml);
  fs.writeFileSync(path.join(dir, "score-pdf.md"),
    `${banner("PDF", "text of renderScoreReportHTML (watermark removed)")}\n\n${htmlToText(pdfHtml)}`);

  // 3. "gap report ready" email (built, never sent).
  const payload = F.email.buildGapReportReadyPayload({
    toEmail: HARNESS_EMAIL, scan, scanToken: "HARNESS-TOKEN", unsubscribeToken: "HARNESS-UNSUB",
    origin: HARNESS_ORIGIN, requestedDate: "2026-11-07",
  });
  fs.writeFileSync(path.join(dir, "score-email.html"), payload.html);
  fs.writeFileSync(path.join(dir, "score-email.md"), [
    banner("email", "buildGapReportReadyPayload, rendered and NOT sent"),
    "",
    `Subject: ${payload.subject}`,
    "",
    "## Text part",
    "",
    payload.text,
    "",
    "## HTML part (visible text)",
    "",
    htmlToText(payload.html),
  ].join("\n"));

  return {
    label: site.label, url: site.url, type: site.type, tier: "free",
    composite: scan.composite,
    dims: scan.dimensions.map((d) => ({ id: d.dimension_id, name: d.dimension_name, score: d.score, grade: d.grade, na: !!d.na })),
  };
}
