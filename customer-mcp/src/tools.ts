import type { Customer, CustomerConfig } from './types';

export const CUSTOMER_TOOLS = [
  {
    name: 'get_capabilities',
    description: "What this product does. Returns the customer's capabilities array.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_pricing',
    description: "Pricing for this product. Returns the customer's pricing array.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_case_studies',
    description: "Customer case studies and proof points. Returns the customer's case_studies array.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_contact_tools',
    description: "Ways to engage with this product further (book a demo, contact sales, signup). Returns the customer's contact_tools array.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export function executeTool(name: string, customer: Customer): unknown {
  const config = JSON.parse(customer.config_json) as CustomerConfig;
  switch (name) {
    case 'get_capabilities':
      return { capabilities: config.capabilities ?? [] };
    case 'get_pricing':
      return { pricing: config.pricing ?? [] };
    case 'get_case_studies':
      return { case_studies: config.case_studies ?? [] };
    case 'get_contact_tools':
      return { contact_tools: config.contact_tools ?? [] };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
