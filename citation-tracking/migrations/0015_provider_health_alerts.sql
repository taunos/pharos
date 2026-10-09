-- citation-tracking/migrations/0015_provider_health_alerts.sql
-- H1 hygiene: dedupe ledger for PROVIDER_CYCLE_ALL_FAILED operator alerts.
-- At most one alert per provider per UTC day; the PRIMARY KEY is the claim.

CREATE TABLE IF NOT EXISTS provider_health_alerts (
  provider TEXT NOT NULL,
  alert_date TEXT NOT NULL,      -- UTC YYYY-MM-DD
  fired_at INTEGER NOT NULL,
  PRIMARY KEY (provider, alert_date)
);
