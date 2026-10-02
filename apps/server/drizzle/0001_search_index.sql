-- Global full-text search index (SQLite FTS5).
-- Rows are maintained by the application's search service, one per searchable record.
-- unicode61 + remove_diacritics handles English and Arabic (tashkeel is ignored).
CREATE VIRTUAL TABLE `search_index` USING fts5(
  `entity_type` UNINDEXED,
  `entity_id` UNINDEXED,
  `workspace_id` UNINDEXED,
  `title`,
  `body`,
  `tags`,
  tokenize = 'unicode61 remove_diacritics 2'
);
