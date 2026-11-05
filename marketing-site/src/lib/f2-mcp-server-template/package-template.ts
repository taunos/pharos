// Static package.json template for the customer's mcp-server/ Worker.

export const PACKAGE_TEMPLATE = `{
  "name": "{{worker_name}}",
  "version": "0.1.0",
  "private": true,
  "description": {{description_json}},
  "scripts": {
    "deploy": "wrangler deploy",
    "dev": "wrangler dev"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240909.0",
    "wrangler": "^3.78.0"
  }
}
`;
