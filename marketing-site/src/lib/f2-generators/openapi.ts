// F2 v6.1 D15 — OpenAPI spec generator.
//
// Engine version: f2:openapi:v2
// Output: OpenAPI 3.1 YAML (text), or null when there is nothing to describe.
// The public promise is "Generated from your public API if detectable; skipped
// otherwise": with no operations the artifact is skipped (null), never shipped
// as an empty `paths: {}` scaffold. No API detection feeds this yet, so
// impl-fulfill-run passes no operations and the patch carries no OpenAPI file.
//
// v2: every scalar that carries a customer value is a double-quoted YAML
// scalar (see yamlString), so brand names with ": ", " #", quotes, newlines or
// a leading "-" / "*" stay valid YAML.

import {
  generateWithTrustLadder,
  type F2LlmEnv,
  type PatchTimeGeneratorInput,
} from "./f2-llm-helpers";

const ENGINE_VERSION = "f2:openapi:v2";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

/** One operation of the customer's public API (path starts with "/"). */
export interface OpenApiOperation {
  method: (typeof HTTP_METHODS)[number];
  path: string;
  summary?: string;
}

export async function generateOpenApi(
  env: F2LlmEnv,
  input: PatchTimeGeneratorInput,
  operations: readonly OpenApiOperation[] = [],
): Promise<string | null> {
  const ops = usableOperations(operations);
  if (ops.length === 0) return null;
  const result = await generateWithTrustLadder<string>(env, {
    engineVersion: ENGINE_VERSION,
    cacheKeyInput: { ...input, operations: ops } as unknown as Record<string, unknown>,
    callModel: async () => null,           // deterministic only
    validators: [],
    retryWithFeedback: async () => null,
    fallback: () => buildDeterministicOpenApi(input, ops),
    serialize: (s) => s,
    deserialize: (s) => s,
  });
  return result.value;
}

/** Drops entries with an unknown method or a path not starting with "/", and duplicates. */
function usableOperations(operations: readonly OpenApiOperation[]): OpenApiOperation[] {
  const seen = new Set<string>();
  const out: OpenApiOperation[] = [];
  for (const op of operations) {
    if (!(HTTP_METHODS as readonly string[]).includes(op.method) || !op.path.startsWith("/")) continue;
    const key = `${op.method} ${op.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(op);
  }
  return out;
}

function buildDeterministicOpenApi(input: PatchTimeGeneratorInput, ops: OpenApiOperation[]): string {
  const domainHost = input.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const byPath = new Map<string, OpenApiOperation[]>();
  for (const op of ops) byPath.set(op.path, [...(byPath.get(op.path) ?? []), op]);
  const paths: string[] = [];
  for (const [path, pathOps] of byPath) {
    paths.push(`  ${yamlString(path)}:`);
    for (const op of pathOps) {
      paths.push(`    ${op.method}:`);
      if (op.summary) paths.push(`      summary: ${yamlString(op.summary)}`);
    }
  }
  return `openapi: 3.1.0
info:
  title: ${yamlString(`${input.brand_name} API`)}
  version: 0.1.0
  description: |
    Auto-generated scaffold from Astrant Implementation. Customer-maintained
    after deploy — extend paths[] with actual API endpoints + schemas. The
    Astrant scoring rubric checks for presence + parseability + info-block
    completeness; populating paths[] improves your Dimension 3 score.
servers:
  - url: ${yamlString(`https://${domainHost}`)}
    description: Production
paths:
${paths.join("\n")}
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: Customer-maintained — swap for your actual auth scheme.
`;
}

// Built from code points: escape sequences for these characters have been
// turned into raw bytes by editing pipelines before.
const cc = (...codes: number[]) => String.fromCharCode(...codes);
const HIGH = `[${cc(0xd800)}-${cc(0xdbff)}]`;
const LOW = `[${cc(0xdc00)}-${cc(0xdfff)}]`;
const LONE_SURROGATE = new RegExp(`${HIGH}(?!${LOW})|(?<!${HIGH})${LOW}`, "g");
const REPLACEMENT_CHAR = cc(0xfffd);
// Valid in a JSON string but not printable in a YAML double-quoted scalar
// (C1 controls incl. NEL, DEL, LS/PS, BOM, U+FFFE/U+FFFF).
const YAML_UNPRINTABLE = new RegExp(`[${cc(0x7f)}-${cc(0x9f)}${cc(0x2028, 0x2029, 0xfeff, 0xfffe, 0xffff)}]`, "g");

/**
 * A YAML double-quoted scalar for any string. JSON string syntax is a subset
 * of YAML's double-quoted style; the characters JSON leaves raw but YAML does
 * not allow are escaped as \uXXXX, and lone surrogates become U+FFFD.
 */
export function yamlString(s: string): string {
  return JSON.stringify(s.replace(LONE_SURROGATE, REPLACEMENT_CHAR)).replace(
    YAML_UNPRINTABLE,
    (c) => "\\u" + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"),
  );
}
