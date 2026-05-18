// F2 v6.1 D15 — OpenAPI spec generator.
//
// Engine version: f2:openapi:v1
// Output: OpenAPI 3.1 YAML (text)
// v1.0: deterministic-only minimal scaffold. Customer fills in real paths post-deploy.

import {
  generateWithTrustLadder,
  type F2LlmEnv,
  type PatchTimeGeneratorInput,
} from "./f2-llm-helpers";

const ENGINE_VERSION = "f2:openapi:v1";

export async function generateOpenApi(
  env: F2LlmEnv,
  input: PatchTimeGeneratorInput,
): Promise<string> {
  const result = await generateWithTrustLadder<string>(env, {
    engineVersion: ENGINE_VERSION,
    cacheKeyInput: input as unknown as Record<string, unknown>,
    callModel: async () => null,           // v1.0: deterministic only
    validators: [],
    retryWithFeedback: async () => null,
    fallback: () => buildDeterministicOpenApi(input),
    serialize: (s) => s,
    deserialize: (s) => s,
  });
  return result.value;
}

function buildDeterministicOpenApi(input: PatchTimeGeneratorInput): string {
  const domainHost = input.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  // Minimal-but-valid OpenAPI 3.1 scaffold. Customer extends paths[] post-deploy.
  return `openapi: 3.1.0
info:
  title: ${input.brand_name} API
  version: 0.1.0
  description: |
    Auto-generated scaffold from Astrant Implementation. Customer-maintained
    after deploy — extend paths[] with actual API endpoints + schemas. The
    Astrant scoring rubric checks for presence + parseability + info-block
    completeness; populating paths[] improves your Dimension 3 score.
servers:
  - url: https://${domainHost}
    description: Production
paths: {}
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: Customer-maintained — swap for your actual auth scheme.
`;
}
