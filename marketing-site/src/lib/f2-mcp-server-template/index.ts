// F2 v6.1 D15 deterministic template renderer.
//
// Consumes the LLM-generated JSON config (per `f2-generators/mcp-server-config.ts`)
// and emits the 4 customer-deployable files. Customer-deployed bytes never come
// from LLM output paths — only from the static templates in this directory.
//
// Per `feedback_llm_output_to_deployment_chain.md` discipline.

import { renderTemplate } from "./template-engine";
import { WORKER_TEMPLATE } from "./worker-template";
import { WRANGLER_TEMPLATE } from "./wrangler-template";
import { PACKAGE_TEMPLATE } from "./package-template";
import { README_TEMPLATE } from "./readme-template";

export interface ToolDefinition {
  name: "get_capabilities" | "get_pricing" | "get_case_studies" | "get_contact_tools";
  description: string;
  response: Record<string, unknown>;  // Static response body
}

export interface McpServerConfigJSON {
  brand_name: string;
  domain: string;
  category: string;
  tagline: string;
  capabilities: ToolDefinition[];
}

export interface RenderedMcpServerArtifacts {
  "mcp-server/index.ts": string;
  "mcp-server/wrangler.jsonc": string;
  "mcp-server/package.json": string;
  "mcp-server/README.md": string;
}

export function renderMcpServerWorker(config: McpServerConfigJSON): RenderedMcpServerArtifacts {
  const worker_name = `astrant-mcp-${normalizeDomain(config.domain)}`;

  // Build the TOOL_RESPONSES object: keyed by tool name, each value carries
  // the tool's static response + an _description meta field consumed by the
  // template's MCP_DISCOVERY tools listing.
  const toolResponses: Record<string, Record<string, unknown>> = {};
  for (const cap of config.capabilities) {
    toolResponses[cap.name] = {
      ...cap.response,
      _description: cap.description,
    };
  }
  const tool_responses_json = JSON.stringify(toolResponses, null, 2);

  const ctx: Record<string, string> = {
    brand_name: escapeForJsonString(config.brand_name),
    domain: escapeForJsonString(config.domain),
    category: escapeForJsonString(config.category),
    tagline: escapeForJsonString(config.tagline),
    worker_name,
    tool_responses_json,
  };

  return {
    "mcp-server/index.ts": renderTemplate(WORKER_TEMPLATE, ctx),
    "mcp-server/wrangler.jsonc": renderTemplate(WRANGLER_TEMPLATE, ctx),
    "mcp-server/package.json": renderTemplate(PACKAGE_TEMPLATE, ctx),
    "mcp-server/README.md": renderTemplate(README_TEMPLATE, ctx),
  };
}

// Domain normalization for worker_name:
//   acme.com         → acme
//   acme-corp.io     → acme-corp
//   example.co.uk    → example-co
function normalizeDomain(domain: string): string {
  return domain
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.[a-z]+$/i, "")  // strip terminal TLD
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);  // CF Worker name length cap
}

// Escape a string so it can safely interpolate into a JSON string literal in the
// template. Templates use these for fields like brand_name in HTML attributes
// or JSON literals; defending against `"`, `\`, `</`, and template-literal `${}`.
function escapeForJsonString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${")
    .replace(/<\//g, "<\\/");
}
