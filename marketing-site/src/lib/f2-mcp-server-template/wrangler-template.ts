// Static wrangler.jsonc template — customer fills in their CF account_id before first deploy
// (wrangler prompts on `wrangler deploy` if not set).

export const WRANGLER_TEMPLATE = `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "{{worker_name}}",
  "main": "index.ts",
  "compatibility_date": "2024-11-01",
  "compatibility_flags": ["nodejs_compat"]
}
`;
