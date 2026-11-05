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
  // template's tools/list (and discovery card) listing.
  const toolResponses: Record<string, Record<string, unknown>> = {};
  for (const cap of config.capabilities) {
    toolResponses[cap.name] = {
      ...cap.response,
      _description: cap.description,
    };
  }
  const tool_responses_json = JSON.stringify(toolResponses, null, 2);

  // Each slot is encoded for where it lands: *_js are complete JSON string
  // literals (valid JS/TS and JSON), *_comment / *_md are single-line text.
  const ctx: Record<string, string> = {
    brand_name_comment: singleLine(config.brand_name),
    tagline_comment: singleLine(config.tagline),
    brand_name_md: singleLine(config.brand_name),
    domain_md: singleLine(config.domain),
    brand_name_js: JSON.stringify(config.brand_name),
    domain_js: JSON.stringify(config.domain),
    category_js: JSON.stringify(config.category),
    tagline_js: JSON.stringify(config.tagline),
    description_json: JSON.stringify(`Astrant-generated MCP server for ${config.brand_name}`),
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

// Collapse every line terminator JS recognises (LF, CR, U+2028, U+2029) so a
// value can never end a `//` comment or a Markdown line early.
const LINE_TERMINATORS = new RegExp("[" + String.fromCharCode(10, 13, 0x2028, 0x2029) + "]+", "g");

function singleLine(s: string): string {
  return s.replace(LINE_TERMINATORS, " ");
}
