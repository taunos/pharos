import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import EmailGate from "@/components/score/EmailGate";
import ScorePdfPoller from "@/components/score/ScorePdfPoller";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyScanToken } from "@/lib/score-tokens";
import {
  getPublicScan,
  getScanState,
} from "@/lib/score-scanner-client";
import type { ScanResult } from "@/lib/audit-types";
import {
  dimensionCountPhrase,
  applicableDimensionCount,
  isDim6DemoPreview,
} from "@/lib/score-display";
import { DIM6_DISCLOSURE } from "@/lib/dim6/disclosure";
import ScorePanel from "@/components/ScorePanel";
import {
  SessionResultCleanup,
  SessionResultFallback,
} from "@/components/score/SessionResult";

// Slice 2b Phase 1 — shareable Score results page.
//
// Token-bearing entries (?t=...) come from the email and let the user:
//   - Re-enter their results page from another device.
//   - Trigger the PDF download (with the same scan-bound token).
//   - Re-route through the polling state if PDF generation is in progress
//     or deferred.
//
// Tokenless entries get the email-capture form (EmailGate). The page is
// publicly reachable for anyone with a scan_id, but the gap-report PDF +
// detailed remediation paths are gated behind email capture.
//
// Engine-version banner: when the scan was generated under an older scoring
// engine, render a banner inviting re-scan. Force-test path:
// `?force_old_engine=v1.0.0` query param. Phase 1 will only trip this in
// the forced path (current expectation: no v1.0.0 scans exist).

export const metadata: Metadata = {
  title: "Your Score results — Astrant",
  robots: { index: false, follow: false },
};

const CURRENT_SCORING_VERSION = "1.3.0";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string; force_old_engine?: string }>;
}

interface ScoreEnv {
  UNSUBSCRIBE_SECRET: string;
  INTERNAL_SCANNER_ADMIN_KEY: string;
}

export default async function ScoreResultsPage({
  params,
  searchParams,
}: PageProps) {
  const { id: scanId } = await params;
  const sp = await searchParams;
  const tokenInput = sp.t ?? "";
  const env = getCloudflareContext().env as unknown as ScoreEnv;

  // Validate token (if present).
  const validToken = tokenInput
    ? await verifyScanToken(tokenInput, env.UNSUBSCRIBE_SECRET ?? "")
    : null;
  const tokenIsValid = !!validToken && validToken.scanId === scanId;
  const tokenWasProvided = tokenInput.length > 0;

  // Fetch the public scan record. On a server miss, do NOT 404 immediately: a
  // just-scanned user may carry a sessionStorage stash (the rare best-effort-
  // persist failure). The client fallback shell reads it and renders a degraded
  // score-only view, or the not-found UI if there's nothing stashed.
  const scanFetch = await getPublicScan(scanId);
  if (!scanFetch.ok) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <main>
          <SessionResultFallback scanId={scanId} />
        </main>
        <SiteFooter />
      </div>
    );
  }
  const scan = scanFetch.data as ScanResult;

  // Engine-version banner: actual scoring_version on the row, OR forced via
  // ?force_old_engine= for verification testing.
  const renderedScoringVersion =
    sp.force_old_engine && /^v?\d+\.\d+\.\d+$/.test(sp.force_old_engine)
      ? sp.force_old_engine.replace(/^v/, "")
      : (scan.scoring_version ?? "unknown");
  const showOldEngineBanner =
    renderedScoringVersion !== "unknown" &&
    renderedScoringVersion !== CURRENT_SCORING_VERSION;

  // Capture state via authenticated internal endpoint.
  let captureState: Awaited<ReturnType<typeof getScanState>> | null = null;
  if (env.INTERNAL_SCANNER_ADMIN_KEY) {
    captureState = await getScanState(env, scanId);
  }
  const stateOk = captureState && captureState.ok ? captureState : null;

  // CTA matrix per locked decision 7:
  //   - No token + no email captured: render <EmailGate />
  //   - Valid token + pdf_ready: render PDF download button
  //   - Valid token + pdf_deferred_until_tomorrow: queued message
  //   - Valid token + pdf_ready false: polling state (max 4 minutes)
  //   - Invalid/expired token + email already captured: link-expired message
  let cta: React.ReactNode;
  if (!stateOk) {
    cta = (
      <div className="border border-red-400/40 bg-red-500/5 p-6 text-base">
        <p className="text-red-300">
          Couldn&apos;t load capture state. Try refreshing in a moment.
        </p>
      </div>
    );
  } else if (!stateOk.has_email_captured) {
    cta = (
      <EmailGate
        scanId={scanId}
        scanUrl={scan.url}
        dimensionsLine={dimensionCountPhrase(
          scan.dimensions_applicable,
          scan.dimensions_scored,
          scan.dimensions_total
        )}
      />
    );
  } else if (tokenIsValid && stateOk.pdf_ready) {
    cta = (
      <div className="border border-emerald-500/40 bg-emerald-500/5 p-6">
        <p className="text-base font-semibold text-emerald-300">
          Your gap report PDF is ready.
        </p>
        {/* Logo + Foundation slice: PDF download is the user's primary outcome
            for this flow — keep amber CTA fill (decision 5: primary CTA). */}
        <a
          href={`/api/score/${scanId}/pdf?t=${encodeURIComponent(tokenInput)}`}
          className="mt-4 inline-flex bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
        >
          Download PDF gap report
        </a>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          Filename: <code className="font-mono">astrant-score-{scanId.slice(0, 8)}.pdf</code>
        </p>
      </div>
    );
  } else if (tokenIsValid && stateOk.pdf_deferred_until_tomorrow) {
    cta = (
      // Logo + Foundation slice: amber-400 retained as semantic-warning hue
      // (queued/waiting state — functional status, distinct from --color-accent).
      <div className="border border-amber-400/40 bg-amber-400/5 p-6 text-base">
        <p className="font-semibold text-amber-300">Your PDF is queued.</p>
        <p className="mt-2 text-[var(--color-muted)]">
          We&apos;re generating gap-report PDFs at capacity right now. Yours
          will be ready within 24 hours and we&apos;ll email a fresh download
          link the moment it&apos;s available.
        </p>
      </div>
    );
  } else if (tokenIsValid && !stateOk.pdf_ready) {
    cta = (
      <ScorePdfPoller
        scanId={scanId}
        token={tokenInput}
      />
    );
  } else if (tokenWasProvided && !tokenIsValid) {
    cta = (
      <div className="border border-orange-400/40 bg-orange-400/5 p-6">
        <p className="font-semibold text-orange-300">
          This link has expired or is invalid.
        </p>
        <p className="mt-2 text-[var(--color-muted)]">
          To re-access your gap report, visit{" "}
          {/* Logo + Foundation slice: link demoted accent → fg. */}
          <Link href="/score" className="text-[var(--color-fg)] underline-offset-4 hover:underline">
            /score
          </Link>{" "}
          and re-submit your email — we&apos;ll send a fresh link.
        </p>
      </div>
    );
  } else {
    // No token, but email is already captured for this scan. The user just
    // navigated here without their token. Offer a re-email flow.
    cta = (
      <EmailGate
        scanId={scanId}
        scanUrl={scan.url}
        dimensionsLine={dimensionCountPhrase(
          scan.dimensions_applicable,
          scan.dimensions_scored,
          scan.dimensions_total
        )}
      />
    );
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-6xl px-6 py-16">
          {showOldEngineBanner ? (
            <div className="mb-8 border border-orange-400/40 bg-orange-400/5 p-4 text-sm text-orange-200">
              <strong className="text-orange-300">
                Older scoring engine:
              </strong>{" "}
              this scan was generated with engine v{renderedScoringVersion}. The
              current engine is v{CURRENT_SCORING_VERSION}.{" "}
              {/* Logo + Foundation slice: link demoted accent → fg. */}
              <Link
                href="/score"
                className="text-[var(--color-fg)] underline-offset-4 hover:underline"
              >
                Re-run the scan
              </Link>{" "}
              to get an updated score.
            </div>
          ) : null}

          <p className="text-sm font-mono uppercase tracking-wider text-[var(--color-muted)]">
            Astrant Score · scan {scanId.slice(0, 8)}
          </p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">
            <span className="font-mono text-[var(--color-fg)]">
              {scan.url}
            </span>
          </h1>

          <div className="mt-8">
            <ScorePanel
              composite={scan.composite}
              dimensions={scan.dimensions}
            />
          </div>
          <p className="mt-6 text-sm text-[var(--color-muted)] italic">
            Scored on{" "}
            {dimensionCountPhrase(
              scan.dimensions_applicable,
              scan.dimensions_scored,
              scan.dimensions_total
            )}{" "}
            dimensions
            applicable to this site (engine v{renderedScoringVersion}). Dim 6
            (Citation Visibility) shows a demo preview on free Score; the live
            4-model audit ships with the $79 Audit. See{" "}
            <Link href="/score/methodology" className="text-[var(--color-fg)] underline-offset-4 hover:underline">methodology</Link>.
            {applicableDimensionCount(scan.dimensions_applicable, scan.dimensions_scored) < scan.dimensions_scored
              ? " Some dimensions did not apply to your site (e.g. no API surface for the OpenAPI dimension) and were dropped from the composite."
              : ""}
          </p>

          {/* Normal server path: the row exists, so clear any sessionStorage
              stash from the scan-to-route hop (client-side; server can't). */}
          <SessionResultCleanup scanId={scanId} />

          {/* A7 — "Where you're losing points": per-dimension below-threshold
              gaps (truncated ~80 chars), sectioned out of the clean ScorePanel
              and positioned to feed the email/Audit CTA below. Full gap detail
              stays in the emailed PDF. Heading is hot-class. */}
          {(() => {
            const gapDims = scan.dimensions.filter(
              (d) => !d.na && d.sub_checks.some((s) => !s.na && s.score < 80)
            );
            if (gapDims.length === 0) return null;
            return (
              <>
                <h2 className="mt-14 text-2xl font-bold tracking-tight">
                  Where you&apos;re losing points
                </h2>
                <div className="mt-6 flex flex-col gap-5">
                  {gapDims.map((d) => (
                    <div key={d.dimension_id}>
                      <h3 className="text-base font-semibold">
                        <span className="mr-2 font-mono text-xs text-[var(--color-muted)]">
                          D{d.dimension_id}
                        </span>
                        {d.dimension_name}
                      </h3>
                      <ul className="mt-2 flex flex-col gap-1 text-sm text-[var(--color-muted)]">
                        {d.sub_checks
                          .filter((s) => !s.na && s.score < 80)
                          .slice(0, 3)
                          .map((s) => (
                            <li key={s.id}>
                              <span className="text-[var(--color-fg)]">
                                {s.name}
                              </span>
                              : {s.notes}
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}

          <h2 className="mt-14 text-2xl font-bold tracking-tight">
            Get the full gap report
          </h2>
          <div className="mt-6">{cta}</div>

          {/* Score V2 — three-way Dim 6 narrative gate (D6), keyed off the
              Dim 6 entry in scan.dimensions:
              - ARM 1 (real scored Dim 6 → "How Dim 6 was measured" narrative):
                UNREACHABLE on this surface. getPublicScan returns the free-tier
                record and the free /api/scan never scores Dim 6 live (always
                na:true), so a measured Dim 6 never reaches here. The measured
                narrative is deleted from render (recoverable from git history);
                this comment is the defensive no-op marking arm 1.
              - ARM 2 (Dim 6 demo preview): render the demo-state variant
                (A3 copy + imported DIM6_DISCLOSURE.freeTierPreview).
              - ARM 3 (Dim 6 absent, or na without the demo sub-check incl.
                daily-cap): suppressed — render nothing. Majority path for
                legacy scans. */}
          {(() => {
            const dim6 = scan.dimensions.find((d) => d.dimension_id === 6);
            if (dim6 && isDim6DemoPreview(dim6)) {
              return (
                <>
                  <h2 className="mt-20 text-2xl font-bold tracking-tight">
                    Citation Visibility (dimension 6)
                  </h2>
                  <p className="mt-3 text-sm text-[var(--color-muted)]">
                    Citation Visibility runs live across 4 AI models with the
                    $79 Audit. Below is a static demo preview of that check.
                  </p>
                  <p className="mt-3 text-sm text-[var(--color-muted)]">
                    {DIM6_DISCLOSURE.freeTierPreview}
                  </p>
                </>
              );
            }
            return null;
          })()}

          {/* Audit upsell — the post-result high-intent close. The free PDF
              (email gate above) stays the primary capture; this is the paid
              $79 Audit upsell. Added beyond the locked CTA matrix; that matrix
              is untouched. */}
          <div className="mt-16 border-t border-[var(--color-border)] pt-12">
            <h2 className="text-2xl font-bold tracking-tight">
              Want these gaps fixed, prioritized?
            </h2>
            <p className="mt-4 text-base text-[var(--color-muted)]">
              Your free report shows where you stand. The $79 Audit turns it
              into a prioritized action plan — with live citation data across 4
              AI models and competitor comparison — delivered as a PDF in 60
              seconds.
            </p>
            <div className="mt-6">
              <Link
                href="/audit"
                className="inline-flex bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
              >
                Run your audit →
              </Link>
            </div>
          </div>

          <p className="mt-12 text-sm text-[var(--color-muted)]">
            By using this page you agree to our{" "}
            {/* Logo + Foundation slice: footer-text legal links demoted accent → fg. */}
            <Link href="/privacy" className="text-[var(--color-fg)] underline-offset-4 hover:underline">
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link href="/terms" className="text-[var(--color-fg)] underline-offset-4 hover:underline">
              Terms
            </Link>
            .
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
