-- FTS5 external-content table backed by symbols (ADR-012)
CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
  name,
  kind,
  signature,
  file_path,
  content='symbols',
  content_rowid='id'
);

-- Sync triggers: external-content tables require manual sync
CREATE TRIGGER IF NOT EXISTS symbols_ai
AFTER INSERT ON symbols BEGIN
  INSERT INTO symbols_fts(rowid, name, kind, signature, file_path)
  VALUES (new.id, new.name, new.kind, new.signature, new.file_path);
END;

CREATE TRIGGER IF NOT EXISTS symbols_ad
AFTER DELETE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, kind, signature, file_path)
  VALUES ('delete', old.id, old.name, old.kind, old.signature, old.file_path);
END;

-- Update: delete old entry first using old.*, then insert new entry using new.*.
-- NOTE: the write path (Session 4) uses INSERT OR IGNORE only; this trigger is
-- dormant until Session 5+ adds an UPDATE symbols path. Test it then.
CREATE TRIGGER IF NOT EXISTS symbols_au
AFTER UPDATE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, kind, signature, file_path)
  VALUES ('delete', old.id, old.name, old.kind, old.signature, old.file_path);
  INSERT INTO symbols_fts(rowid, name, kind, signature, file_path)
  VALUES (new.id, new.name, new.kind, new.signature, new.file_path);
END;
