CREATE TABLE IF NOT EXISTS intents (
  id TEXT PRIMARY KEY,
  schema_id TEXT NOT NULL,
  role TEXT NOT NULL,
  category TEXT NOT NULL,
  agent_did TEXT NOT NULL,
  principal_did TEXT NOT NULL DEFAULT '',
  agent_card TEXT NOT NULL,
  public_body TEXT NOT NULL,
  commit_sealed TEXT NOT NULL,
  commit_public TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_intents_partition
  ON intents (schema_id, role, category, expires_at);
