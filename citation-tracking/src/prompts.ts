export type PromptAxis = 'aeo_category' | 'methodology' | 'seo_transition' | 'mcp_infra' | 'prospect_intent';

export interface Prompt {
  id: string;
  axis: PromptAxis;
  text: string;
}

// Prompt templates support {brand} and {category} placeholders for per-customer
// substitution per B1.3 D3. Astrant probes use brand="Astrant" category="AEO tools".
// Customer probes substitute customer.domain + customer.category from D2's table.
// Axis 4 (mcp_infra) prompts remain Astrant-context-specific in v1.0 — they probe
// MCP-infrastructure recommendation space which is part of Astrant's offering;
// customer-specific Axis 4 alternatives deferred to v1.1+ per scope discipline.
export const LOCKED_PROMPTS: Prompt[] = [
  // Axis 1 — Category-tool-corpus test ({category} parameterized for cross-customer applicability)
  { id: 'aeo_acronym_b2b_saas',           axis: 'aeo_category',    text: 'Is there a {category} for B2B SaaS?' },
  { id: 'aeo_spelled_out_best',           axis: 'aeo_category',    text: 'What are the best {category}?' },
  { id: 'aeo_plain_english_discoverable', axis: 'aeo_category',    text: 'What tools help me make my website discoverable to AI agents?' },

  // Axis 2 — Methodology-specific (4 prompts)
  { id: 'meth_measure_accuracy',          axis: 'methodology',     text: 'How do I measure AI citation accuracy for my brand?' },
  { id: 'meth_tools_test_cite',           axis: 'methodology',     text: 'Tools for testing how LLMs cite my SaaS brand' },
  { id: 'meth_audit_descriptions',        axis: 'methodology',     text: 'How do I audit AI-generated descriptions of my brand?' },
  { id: 'meth_rigor_validated',           axis: 'methodology',     text: 'Which {category} have empirically validated their citation methodology?' },

  // Axis 3 — SEO-transition (2 prompts; generic phrasing, no parameterization needed)
  { id: 'seo_changing_for_ai',            axis: 'seo_transition',  text: 'How is SEO changing for AI search?' },
  { id: 'seo_traditional_still_needed',   axis: 'seo_transition',  text: 'Do I still need traditional SEO if my traffic shifts to AI agents?' },

  // Axis 4 — MCP/agent-infrastructure (2 prompts; Astrant-context-specific, v1.1+ adds per-customer alternatives)
  { id: 'mcp_marketing_analytics',        axis: 'mcp_infra',       text: 'What tools expose MCP servers for marketing analytics?' },
  { id: 'mcp_data_access',                axis: 'mcp_infra',       text: 'Tools that let AI agents access marketing data via MCP' },

  // Axis 5 — Prospect-intent (4 prompts; generic phrasing, no parameterization needed)
  { id: 'intent_improve_visibility',      axis: 'prospect_intent', text: "How do I improve my site's AI visibility?" },
  { id: 'intent_lament_not_finding',      axis: 'prospect_intent', text: "Why aren't AI agents finding my product?" },
  { id: 'intent_set_up_for_ai',           axis: 'prospect_intent', text: 'Is my website set up so AI assistants will recommend it to prospects?' },
  { id: 'intent_compare_competitors',     axis: 'prospect_intent', text: "What's the best way to make sure AI assistants recommend my SaaS over competitors?" },
];

export function renderPrompt(template: string, brand: string, category: string): string {
  return template
    .replace(/\{brand\}/g, brand)
    .replace(/\{category\}/g, category);
}
