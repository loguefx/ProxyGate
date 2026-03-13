-- ProxyGate initial schema migration
-- Run once on first launch via tauri-plugin-sql migrations

CREATE TABLE IF NOT EXISTS routes (
  id               TEXT PRIMARY KEY,
  match_type       TEXT NOT NULL DEFAULT 'subdomain',
  hostname         TEXT NOT NULL,
  path_prefix      TEXT,
  strip_path       INTEGER NOT NULL DEFAULT 0,
  service_group_id TEXT NOT NULL,
  tls              TEXT NOT NULL DEFAULT 'acme',
  middleware       TEXT NOT NULL DEFAULT '[]',
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_groups (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,
  colour                TEXT NOT NULL DEFAULT '#3dd68c',
  load_balancer         TEXT NOT NULL DEFAULT 'round-robin',
  health_check_path     TEXT NOT NULL DEFAULT '/health',
  health_check_interval TEXT NOT NULL DEFAULT '30s',
  health_check_timeout  TEXT NOT NULL DEFAULT '5s',
  passive_health_check  INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upstreams (
  id               TEXT PRIMARY KEY,
  service_group_id TEXT NOT NULL REFERENCES service_groups(id) ON DELETE CASCADE,
  address          TEXT NOT NULL,
  weight           INTEGER NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'unknown',
  latency_ms       INTEGER,
  last_checked     TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS middleware_configs (
  id      TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  config  TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS tls_config (
  id                  INTEGER PRIMARY KEY DEFAULT 1,
  mode                TEXT NOT NULL DEFAULT 'acme',
  acme_email          TEXT,
  acme_challenge_type TEXT DEFAULT 'HTTP-01',
  certs               TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO app_settings VALUES
  ('public_ip',''),('http_port','8080'),('https_port','443'),
  ('admin_port','8080'),('log_level','INFO'),
  ('config_path','/etc/proxygate/traefik.yml'),
  ('cf_proxy','false'),('ha_enabled','false'),
  ('ha_role','primary'),('ha_vip',''),
  ('ha_peer_ip',''),('ha_interface','eth0');

INSERT OR IGNORE INTO middleware_configs VALUES
  ('rate-limit',    0, '{"ratePerSecond":100}'),
  ('basic-auth',    0, '{"users":[]}'),
  ('cors',          0, '{"allowOrigins":["*"]}'),
  ('gzip',          1, '{}'),
  ('ip-whitelist',  0, '{"cidrs":[]}'),
  ('https-redirect',1, '{}'),
  ('custom-headers',0, '{"set":{},"remove":[]}');

INSERT OR IGNORE INTO tls_config (id, mode, acme_challenge_type, certs)
  VALUES (1, 'acme', 'HTTP-01', '[]');
