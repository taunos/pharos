-- Outreach slice (spec §6.2 item 3): provenance column on scans.
-- NULL = not an outreach scan. 'outreach' = written by the ProspectScan RPC
-- entrypoint (pharos-outreach). NULL does NOT mean "human": audit-pipeline
-- paid scans, the mcp-server score_url tool and internal test scans also
-- write NULL. Funnel queries add: AND (source IS NULL OR source <> 'outreach').
--
-- APPLY ALONE (0003/0004 are not applied in production):
--   npx wrangler d1 execute pharos-scanner --remote --file migrations/0005_scans_source.sql
-- `execute --file` does NOT record this in d1_migrations. Whoever next runs
-- `migrations apply` on the scanner must first insert the 0005 row into
-- d1_migrations by hand, or the apply re-runs this file and fails on the
-- duplicate column.
--
-- Must be applied BEFORE pharos-outreach calls ProspectScan.scan(): the RPC
-- INSERT names the `source` column and throws without it. The public
-- /api/scan INSERT does not name it and is unaffected.
ALTER TABLE scans ADD COLUMN source TEXT CHECK (source IN ('outreach') OR source IS NULL);
CREATE INDEX IF NOT EXISTS idx_scans_source ON scans(source);
