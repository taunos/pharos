// F2 v6.1 §3.0.5 — minimal {{key}} substitution. Throws loudly on missing keys.
// No eval; static replacement only.
//
// Used by f2-mcp-server-template/index.ts to render Astrant-authored static
// templates against the LLM-generated JSON config. The LLM never produces
// executable code; the template renderer (this module + worker-template.ts +
// wrangler-template.ts + package-template.ts + readme-template.ts) is the only
// path that emits customer-deployed bytes.

export function renderTemplate(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in ctx)) {
      throw new Error(`Template missing required key: ${key}`);
    }
    return String(ctx[key]);
  });
}
