import type { Customer, CustomerConfig } from './types';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      ...(init?.headers ?? {}),
    },
  });
}

export function wellKnownMcp(customer: Customer): Response {
  const config = JSON.parse(customer.config_json) as CustomerConfig;
  return jsonResponse({
    name: config.brand_name,
    description: config.description,
    mcp: `https://${customer.slug}.mcp.astrant.io/mcp`,
    version: '1.0',
  });
}

export function wellKnownServerCard(customer: Customer): Response {
  const config = JSON.parse(customer.config_json) as CustomerConfig;
  return jsonResponse({
    name: config.brand_name,
    description: config.description,
    version: '1.0',
    tools: [
      { name: 'get_capabilities', summary: `What ${config.brand_name} does.` },
      { name: 'get_pricing', summary: `${config.brand_name} pricing.` },
      { name: 'get_case_studies', summary: `${config.brand_name} case studies.` },
      { name: 'get_contact_tools', summary: `How to engage with ${config.brand_name}.` },
    ],
  });
}
