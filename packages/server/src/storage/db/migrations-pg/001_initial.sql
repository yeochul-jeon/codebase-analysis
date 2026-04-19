-- Variant B initial schema for PostgreSQL (ADR-022, ADR-023)
-- Using SERIAL (int4) to avoid pg bigint<->JS number mismatch without type parsers.
-- FTS: tsvector GENERATED ALWAYS AS STORED (to_tsvector 'simple') instead of FTS5 triggers.

CREATE TABLE IF NOT EXISTS repos (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  default_branch TEXT NOT NULL DEFAULT 'main',
  created_at     BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM now())::BIGINT
);

CREATE TABLE IF NOT EXISTS indexes (
  id         SERIAL PRIMARY KEY,
  repo_id    INTEGER NOT NULL REFERENCES repos(id),
  commit_sha TEXT NOT NULL,
  branch     TEXT,
  status     TEXT NOT NULL DEFAULT 'uploading',
  file_count INTEGER,
  created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM now())::BIGINT,
  UNIQUE(repo_id, commit_sha)
);

CREATE TABLE IF NOT EXISTS repo_head (
  repo_id  INTEGER NOT NULL REFERENCES repos(id),
  branch   TEXT NOT NULL,
  index_id INTEGER NOT NULL REFERENCES indexes(id),
  PRIMARY KEY(repo_id, branch)
);

CREATE TABLE IF NOT EXISTS symbols (
  id          SERIAL PRIMARY KEY,
  index_id    INTEGER NOT NULL REFERENCES indexes(id),
  symbol_key  TEXT NOT NULL UNIQUE,
  file_path   TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  signature   TEXT,
  parent_key  TEXT,
  start_line  INTEGER NOT NULL,
  end_line    INTEGER NOT NULL,
  modifiers   TEXT,
  annotations TEXT,
  -- ADR-022: tsvector GENERATED for prefix FTS (to_tsquery 'simple' avoids stemmer)
  name_tsv    tsvector GENERATED ALWAYS AS (to_tsvector('simple', name)) STORED
);

CREATE TABLE IF NOT EXISTS occurrences (
  id          SERIAL PRIMARY KEY,
  index_id    INTEGER NOT NULL REFERENCES indexes(id),
  caller_key  TEXT,
  callee_name TEXT NOT NULL,
  kind        TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  line        INTEGER NOT NULL
);
