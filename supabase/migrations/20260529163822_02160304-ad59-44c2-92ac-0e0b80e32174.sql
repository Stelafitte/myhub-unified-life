-- Enable scheduling + HTTP from Postgres for cron-based sync
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;