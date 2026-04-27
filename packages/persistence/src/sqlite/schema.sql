CREATE TABLE IF NOT EXISTS users (
  user_id        TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id     TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS user_agent_configs (
  agent_config_id    TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  agent_name         TEXT NOT NULL,
  endpoint_url       TEXT NOT NULL,
  auth_header_name   TEXT,
  auth_header_value  TEXT,
  timeout_ms         INTEGER NOT NULL,
  description        TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_agent_configs_user_id ON user_agent_configs(user_id);

CREATE TABLE IF NOT EXISTS tables (
  table_id    TEXT PRIMARY KEY,
  json        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hands (
  hand_id       TEXT PRIMARY KEY,
  table_id      TEXT NOT NULL,
  json          TEXT NOT NULL,
  completed_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hands_table_id ON hands(table_id);

CREATE TABLE IF NOT EXISTS replay_events (
  event_id    TEXT PRIMARY KEY,
  hand_id     TEXT NOT NULL,
  sequence    INTEGER NOT NULL,
  json        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_replay_events_hand_seq ON replay_events(hand_id, sequence);
