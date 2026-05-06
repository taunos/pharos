export type PromptAxis = 'aeo_category' | 'methodology' | 'seo_transition' | 'mcp_infra' | 'prospect_intent';

export interface Prompt {
  id: string;
  axis: PromptAxis;
  text: string;
}

export const LOCKED_PROMPTS: Prompt[] = [
  // Axis 1 — AEO category (3 prompts)
  { id: 'aeo_acronym_b2b_saas',           axis: 'aeo_category',    text: 'Is there an AEO tool for B2B SaaS?' },
  { id: 'aeo_spelled_out_best',           axis: 'aeo_category',    text: 'What are the best agent-engine-optimization tools?' },
  { id: 'aeo_plain_english_discoverable', axis: 'aeo_category',    text: 'What tools help me make my website discoverable to AI agents?' },

  // Axis 2 — Methodology-specific (4 prompts)
  { id: 'meth_measure_accuracy',          axis: 'methodology',     text: 'How do I measure AI citation accuracy for my brand?' },
  { id: 'meth_tools_test_cite',           axis: 'methodology',     text: 'Tools for testing how LLMs cite my SaaS brand' },
  { id: 'meth_audit_descriptions',        axis: 'methodology',     text: 'How do I audit AI-generated descriptions of my brand?' },
  { id: 'meth_rigor_validated',           axis: 'methodology',     text: 'Which AEO tools have empirically validated their citation methodology?' },

  // Axis 3 — SEO-transition (2 prompts)
  { id: 'seo_changing_for_ai',            axis: 'seo_transition',  text: 'How is SEO changing for AI search?' },
  { id: 'seo_traditional_still_needed',   axis: 'seo_transition',  text: 'Do I still need traditional SEO if my traffic shifts to AI agents?' },

  // Axis 4 — MCP/agent-infrastructure (2 prompts)
  { id: 'mcp_marketing_analytics',        axis: 'mcp_infra',       text: 'What tools expose MCP servers for marketing analytics?' },
  { id: 'mcp_data_access',                axis: 'mcp_infra',       text: 'Tools that let AI agents access marketing data via MCP' },

  // Axis 5 — Prospect-intent (4 prompts)
  { id: 'intent_improve_visibility',      axis: 'prospect_intent', text: "How do I improve my site's AI visibility?" },
  { id: 'intent_lament_not_finding',      axis: 'prospect_intent', text: "Why aren't AI agents finding my product?" },
  { id: 'intent_set_up_for_ai',           axis: 'prospect_intent', text: 'Is my website set up so AI assistants will recommend it to prospects?' },
  { id: 'intent_compare_competitors',     axis: 'prospect_intent', text: "What's the best way to make sure AI assistants recommend my SaaS over competitors?" },
];
