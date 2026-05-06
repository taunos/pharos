CREATE TABLE probe_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'perplexity', 'gemini')),
  prompt_id TEXT NOT NULL,
  prompt_axis TEXT NOT NULL CHECK (prompt_axis IN ('aeo_category', 'methodology', 'seo_transition', 'mcp_infra', 'prospect_intent')),
  response_excerpt TEXT,
  d1a_url_cite INTEGER NOT NULL CHECK (d1a_url_cite IN (0, 1)),
  d1b_brand_mention INTEGER NOT NULL CHECK (d1b_brand_mention IN (0, 1)),
  d2_term_of_art INTEGER NOT NULL CHECK (d2_term_of_art IN (0, 1)),
  d3_competitors_cited TEXT,
  probe_run_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'rate_limit', 'timeout', 'error', 'partial_coverage')),
  error_message TEXT,
  http_status INTEGER
);
CREATE INDEX idx_provider_prompt_time ON probe_runs (provider, prompt_id, timestamp);
CREATE INDEX idx_axis_time ON probe_runs (prompt_axis, timestamp);
CREATE INDEX idx_probe_run_id ON probe_runs (probe_run_id);
