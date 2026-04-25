export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  AI: Ai;
}

export type SubCheck = {
  id: string;
  name: string;
  weight: number;
  score: number;
  passed: boolean;
  notes: string;
};

export type DimensionResult = {
  dimension_id: number;
  dimension_name: string;
  score: number;
  grade: string;
  sub_checks: SubCheck[];
};

export type Composite = {
  score: number;
  grade: string;
};

export type ScanResult = {
  id: string;
  url: string;
  composite: Composite;
  dimensions: DimensionResult[];
  dimensions_scored: number;
  dimensions_total: number;
  created_at: number;
};
