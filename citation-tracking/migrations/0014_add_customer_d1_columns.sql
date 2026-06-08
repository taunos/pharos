-- F4.1.2c: add per-customer D1 cite-share columns
ALTER TABLE probe_runs ADD COLUMN d1c_customer_url_cite INTEGER DEFAULT NULL
  CHECK (d1c_customer_url_cite IN (0, 1) OR d1c_customer_url_cite IS NULL);
ALTER TABLE probe_runs ADD COLUMN d1d_customer_brand_mention INTEGER DEFAULT NULL
  CHECK (d1d_customer_brand_mention IN (0, 1) OR d1d_customer_brand_mention IS NULL);
