// F2 v6.1 D15 — JSON-LD schema generator.
//
// Engine version: f2:jsonld:v1
// Output: JSON-LD `<script>` content as a string for root-layout injection
// v1.0: deterministic only. Customer extends per published case studies / pricing post-deploy.

import {
  generateWithTrustLadder,
  type F2LlmEnv,
  type PatchTimeGeneratorInput,
} from "./f2-llm-helpers";

const ENGINE_VERSION = "f2:jsonld:v1";

export async function generateJsonLd(
  env: F2LlmEnv,
  input: PatchTimeGeneratorInput,
): Promise<string> {
  const result = await generateWithTrustLadder<string>(env, {
    engineVersion: ENGINE_VERSION,
    cacheKeyInput: input as unknown as Record<string, unknown>,
    callModel: async () => null,           // v1.0: deterministic only
    validators: [],
    retryWithFeedback: async () => null,
    fallback: () => buildDeterministicJsonLd(input),
    serialize: (s) => s,
    deserialize: (s) => s,
  });
  return result.value;
}

function buildDeterministicJsonLd(input: PatchTimeGeneratorInput): string {
  const domainHost = input.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const orgLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: input.brand_name,
    url: `https://${domainHost}/`,
    description: `${input.brand_name} provides ${input.category} services.`,
  };
  const serviceLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: input.brand_name,
    provider: { "@type": "Organization", name: input.brand_name },
    serviceType: input.category,
    areaServed: "Worldwide",
    url: `https://${domainHost}/`,
  };
  // The marker comment pair enables re-apply detection (v1.1+ refresh flows).
  return `<!-- astrant-jsonld:begin -->
<script type="application/ld+json">
${JSON.stringify(orgLd, null, 2)}
</script>
<script type="application/ld+json">
${JSON.stringify(serviceLd, null, 2)}
</script>
<!-- astrant-jsonld:end -->
`;
}
