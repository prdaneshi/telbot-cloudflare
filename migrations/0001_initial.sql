-- Generic test engine schema. Test content is data-driven.

CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS test_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL,
  instructions TEXT,
  question_count INTEGER,
  scale_min REAL NOT NULL DEFAULT 0,
  scale_max REAL NOT NULL DEFAULT 4,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(test_id, version_label)
);

CREATE TABLE IF NOT EXISTS dimensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_version_id INTEGER NOT NULL REFERENCES test_versions(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(test_version_id, key)
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_version_id INTEGER NOT NULL REFERENCES test_versions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  UNIQUE(test_version_id, position)
);

CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_version_id INTEGER NOT NULL REFERENCES test_versions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  value REAL NOT NULL,
  UNIQUE(test_version_id, position)
);

CREATE TABLE IF NOT EXISTS question_scoring (
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  dimension_id INTEGER NOT NULL REFERENCES dimensions(id) ON DELETE CASCADE,
  weight REAL NOT NULL DEFAULT 1,
  reverse_scored INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(question_id, dimension_id)
);

CREATE TABLE IF NOT EXISTS test_sessions (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  test_version_id INTEGER NOT NULL REFERENCES test_versions(id),
  status TEXT NOT NULL CHECK(status IN ('in_progress', 'completed', 'cancelled')),
  current_position INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_chat_status ON test_sessions(chat_id, status);

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  option_position INTEGER NOT NULL,
  option_value REAL NOT NULL,
  answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, question_id)
);

CREATE TABLE IF NOT EXISTS result_interpretations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_version_id INTEGER NOT NULL REFERENCES test_versions(id) ON DELETE CASCADE,
  dimension_id INTEGER NOT NULL REFERENCES dimensions(id) ON DELETE CASCADE,
  min_score REAL NOT NULL,
  max_score REAL NOT NULL,
  level TEXT,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
  dimension_key TEXT NOT NULL,
  raw_score REAL NOT NULL,
  level TEXT,
  interpretation TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_session ON results(session_id);
