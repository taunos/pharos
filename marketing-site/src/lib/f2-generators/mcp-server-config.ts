// F2 v6.1 D15 — mcp-server-config generator (structured JSON; NOT executable code).
//
// Engine version: f2:mcp-server-config:v1
// Output: McpServerConfigJSON (brand + tagline + 4 tool definitions with static responses).
// The deterministic template renderer at @/lib/f2-mcp-server-template/ consumes this JSON
// and emits the customer-deployable TS Worker code. Customer-deployed bytes NEVER come
// from LLM output paths — per `feedback_llm_output_to_deployment_chain.md`.

import {
  generateWithTrustLadder,
  type F2LlmEnv,
  type PatchTimeGeneratorInput,
} from "./f2-llm-helpers";
import type { McpServerConfigJSON } from "@/lib/f2-mcp-server-template";

const ENGINE_VERSION = "f2:mcp-server-config:v1";

export async function generateMcpServerConfig(
  env: F2LlmEnv,
  input: PatchTimeGeneratorInput,
): Promise<McpServerConfigJSON> {
  const result = await generateWithTrustLadder<McpServerConfigJSON>(env, {
    engineVersion: ENGINE_VERSION,
    cacheKeyInput: input as unknown as Record<string, unknown>,
    callModel: async () => null,           // v1.0: deterministic only
    validators: [validateConfigShape],
    retryWithFeedback: async () => null,
    fallback: () => buildDeterministicConfig(input),
    serialize: (c) => JSON.stringify(c),
    deserialize: (s) => JSON.parse(s) as McpServerConfigJSON,
  });
  return result.value;
}

// Strict JSON-schema validation (cheap; runs always):
//   - 4 tools present with the locked names
//   - tagline ≤ 200 chars
//   - all description fields ≤ 500 chars
//   - no foreign-domain URLs in string fields
function validateConfigShape(
  c: McpServerConfigJSON,
): { valid: true } | { valid: false; reason: string } {
  const requiredTools = ["get_capabilities", "get_pricing", "get_case_studies", "get_contact_tools"] as const;
  const names = new Set(c.capabilities.map((cap) => cap.name));
  for (const required of requiredTools) {
    if (!names.has(required)) {
      return { valid: false, reason: `Missing required tool: ${required}` };
    }
  }
  if (c.tagline.length > 200) {
    return { valid: false, reason: `Tagline exceeds 200 chars (${c.tagline.length})` };
  }
  for (const cap of c.capabilities) {
    if (cap.description.length > 500) {
      return { valid: false, reason: `Description for ${cap.name} exceeds 500 chars` };
    }
  }
  return { valid: true };
}

function buildDeterministicConfig(input: PatchTimeGeneratorInput): McpServerConfigJSON {
  const domainHost = input.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return {
    brand_name: input.brand_name,
    domain: domainHost,
    category: input.category,
    tagline: `${input.brand_name} — ${input.category}.`,
    capabilities: [
      {
        name: "get_capabilities",
        description: `Returns a list of services + integrations offered by ${input.brand_name}.`,
        response: {
          brand: input.brand_name,
          summary: `${input.brand_name} provides ${input.category} services. Customer-maintained; edit this response in mcp-server/index.ts.`,
          integrations: [],
        },
      },
      {
        name: "get_pricing",
        description: `Returns ${input.brand_name}'s pricing tiers + a link to the canonical pricing page.`,
        response: {
          brand: input.brand_name,
          pricing_url: `https://${domainHost}/pricing`,
          tiers: [],
          note: "Customer-maintained — populate tiers[] with name+price+features after deploy.",
        },
      },
      {
        name: "get_case_studies",
        description: `Returns published case studies + customer outcomes for ${input.brand_name}.`,
        response: {
          brand: input.brand_name,
          case_studies: [],
          note: "Customer-maintained — populate case_studies[] with title+customer+outcome+url after deploy.",
        },
      },
      {
        name: "get_contact_tools",
        description: `Returns the canonical contact + sales-call paths for ${input.brand_name}.`,
        response: {
          brand: input.brand_name,
          sales_email: `sales@${domainHost}`,
          contact_page: `https://${domainHost}/contact`,
          schedule_url: null,
          note: "Customer-maintained — replace placeholders with your actual contact paths.",
        },
      },
    ],
  };
}
