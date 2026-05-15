// F3 D6.2: post-purchase onboarding form. Token-gated; validates the JWT
// from the welcome email before rendering. Form-submit handler at
// /api/onboarding/submit. See spec v3.2 §6.2.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyOnboardingToken, type OnboardingTokenEnv } from "@/lib/onboarding-token";

// Force dynamic rendering: getCloudflareContext requires runtime env (not available
// during static prerender). Token verification + env access happens per-request.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Set up your Astrant AutoPilot monitoring",
  description: "Tell us what to monitor. Two minutes.",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const env = getCloudflareContext().env as unknown as OnboardingTokenEnv;
  const params = await searchParams;
  const token = params.t ?? "";
  const result = await verifyOnboardingToken(env, token);

  if (!result.ok) {
    return (
      <main style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
        <h1>This setup link is no longer valid</h1>
        <p>
          Your link may have expired (links are good for 7 days) or already been used.
        </p>
        <p>
          Reply to your welcome email to request a fresh link, or contact{" "}
          <a href="mailto:support@astrant.io">support@astrant.io</a>.
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Set up your Astrant AutoPilot monitoring</h1>
      <p>Tell us what to monitor. The setup takes about 2 minutes.</p>
      <form method="POST" action="/api/onboarding/submit">
        <input type="hidden" name="t" value={token} />
        <p>
          <label>
            Brand name (how your brand should be referenced in reports)<br />
            <input type="text" name="brand_name" required maxLength={50} style={{ width: "100%" }} />
          </label>
        </p>
        <p>
          <label>
            Primary domain (e.g., yourbrand.com)<br />
            <input type="text" name="domain" required style={{ width: "100%" }} />
          </label>
        </p>
        <p>
          <label>
            Category<br />
            <select name="category" required style={{ width: "100%" }}>
              <option value="">Choose…</option>
              <option value="saas">SaaS</option>
              <option value="ecommerce">E-commerce</option>
              <option value="fintech">Fintech</option>
              <option value="developer-tools">Developer tools</option>
              <option value="other">Other</option>
            </select>
          </label>
        </p>
        <p>
          <label>
            Competitors (optional; up to 5, comma-separated)<br />
            <input type="text" name="competitors_csv" style={{ width: "100%" }} />
          </label>
        </p>
        <p>
          <button type="submit">Start monitoring</button>
        </p>
      </form>
    </main>
  );
}
