CREATE TABLE IF NOT EXISTS repos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL UNIQUE,
  default_branch TEXT    NOT NULL DEFAULT 'main',
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS indexes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id    INTEGER NOT NULL REFERENCES repos(id),
  commit_sha TEXT    NOT NULL,
  branch     TEXT,
  status     TEXT    NOT NULL DEFAULT 'uploading',
  file_count INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(repo_id, commit_sha)
);

CREATE TABLE IF NOT EXISTS repo_head (
  repo_id  INTEGER NOT NULL REFERENCES repos(id),
  branch   TEXT    NOT NULL,
  index_id INTEGER NOT NULL REFERENCES indexes(id),
  PRIMARY KEY(repo_id, branch)
);

CREATE TABLE IF NOT EXISTS symbols (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  index_id    INTEGER NOT NULL REFERENCES indexes(id),
  symbol_key  TEXT    NOT NULL UNIQUE,
  file_path   TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  signature   TEXT,
  parent_key  TEXT,
  start_line  INTEGER NOT NULL,
  end_line    INTEGER NOT NULL,
  modifiers   TEXT,
  annotations TEXT
);

CREATE TABLE IF NOT EXISTS occurrences (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  index_id    INTEGER NOT NULL REFERENCES indexes(id),
  caller_key  TEXT,
  callee_name TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  file_path   TEXT    NOT NULL,
  line        INTEGER NOT NULL
);
