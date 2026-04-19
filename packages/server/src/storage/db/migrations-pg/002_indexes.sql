-- Variant B indexes for PostgreSQL
CREATE INDEX IF NOT EXISTS idx_symbols_index_id ON symbols(index_id);
CREATE INDEX IF NOT EXISTS idx_symbols_file     ON symbols(index_id, file_path);
CREATE INDEX IF NOT EXISTS idx_symbols_name     ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_name_tsv ON symbols USING GIN (name_tsv);
CREATE INDEX IF NOT EXISTS idx_occ_index_id     ON occurrences(index_id);
CREATE INDEX IF NOT EXISTS idx_occ_callee       ON occurrences(callee_name);
