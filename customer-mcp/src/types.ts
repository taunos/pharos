export interface Env {
  CUSTOMER_DB: D1Database;
  CONFIG_CACHE: KVNamespace;
  INTERNAL_PROVISION_KEY: string;
}

export interface Customer {
  id: number;
  slug: string;
  customer_id: string;
  domain: string;
  paid_tier: 'implementation' | 'autopilot' | 'concierge';
  status: 'active' | 'cancelled' | 'expired';
  period_end: number | null;
  created_at: number;
  updated_at: number;
  config_json: string;
}

export interface CustomerConfig {
  _schema_version: string;
  brand_name: string;
  description: string;
  capabilities?: unknown[];
  pricing?: unknown[];
  case_studies?: unknown[];
  contact_tools?: unknown[];
}
