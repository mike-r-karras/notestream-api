PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE,
  email TEXT NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'regular' CHECK (type IN ('admin', 'regular')),
  created_datetime TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  modified_datetime TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  modified_by INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  avatar BLOB,
  avatar_content_type TEXT,
  CONSTRAINT uq_users_username UNIQUE (username),
  CONSTRAINT uq_users_email UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_datetime TEXT NOT NULL,
  created_datetime TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_score_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  folder_name TEXT NOT NULL,
  folder_parent INTEGER,
  created_datetime TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  modified_datetime TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_parent) REFERENCES user_score_folders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  folder_id INTEGER,
  title TEXT NOT NULL,
  instrument TEXT,
  author TEXT,
  score_representation TEXT,
  created_datetime TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  modified_datetime TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  modified_by INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES user_score_folders(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS student_score_stats (
  student_id TEXT NOT NULL,
  score_id TEXT NOT NULL,
  first_practiced_at INTEGER,
  last_practiced_at INTEGER,
  total_practice_ms INTEGER NOT NULL DEFAULT 0,
  session_count INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  notes_expected INTEGER NOT NULL DEFAULT 0,
  notes_correct INTEGER NOT NULL DEFAULT 0,
  timing_error_sum_ms REAL NOT NULL DEFAULT 0,
  timing_error_sq_sum REAL NOT NULL DEFAULT 0,
  current_tempo_bpm REAL,
  best_tempo_bpm REAL,
  mastery_score REAL NOT NULL DEFAULT 0,
  stats_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (student_id, score_id)
);

CREATE TABLE IF NOT EXISTS practice_session (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  score_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_ms INTEGER,
  instrument TEXT,
  input_method TEXT,
  app_version TEXT,
  starting_tempo_bpm REAL,
  ending_tempo_bpm REAL,
  overall_accuracy REAL,
  timing_rmse_ms REAL,
  FOREIGN KEY (student_id, score_id)
    REFERENCES student_score_stats(student_id, score_id)
);

CREATE TABLE IF NOT EXISTS practice_attempt (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  start_measure INTEGER NOT NULL,
  end_measure INTEGER NOT NULL,
  tempo_bpm REAL,
  practice_mode TEXT NOT NULL,
  expected_note_count INTEGER NOT NULL DEFAULT 0,
  correct_note_count INTEGER NOT NULL DEFAULT 0,
  missed_note_count INTEGER NOT NULL DEFAULT 0,
  extra_note_count INTEGER NOT NULL DEFAULT 0,
  onset_error_sum_ms REAL NOT NULL DEFAULT 0,
  onset_error_sq_sum REAL NOT NULL DEFAULT 0,
  duration_error_sum_ms REAL NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES practice_session(id)
);

CREATE TABLE IF NOT EXISTS performance_event (
  attempt_id TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  score_event_id TEXT,
  measure_index INTEGER NOT NULL,
  beat_position REAL NOT NULL,
  part_id TEXT,
  staff_number INTEGER,
  voice_number INTEGER,
  expected_pitches TEXT,
  performed_pitches TEXT,
  result TEXT NOT NULL,
  expected_onset_ms INTEGER,
  performed_onset_ms INTEGER,
  onset_error_ms INTEGER,
  expected_duration_ms INTEGER,
  performed_duration_ms INTEGER,
  duration_error_ms INTEGER,
  pitch_error_cents REAL,
  confidence REAL,
  PRIMARY KEY (attempt_id, event_index),
  FOREIGN KEY (attempt_id) REFERENCES practice_attempt(id)
);

CREATE TABLE IF NOT EXISTS student_segment_stats (
  student_id TEXT NOT NULL,
  score_id TEXT NOT NULL,
  segment_type TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  expected_note_count INTEGER NOT NULL DEFAULT 0,
  correct_note_count INTEGER NOT NULL DEFAULT 0,
  missed_note_count INTEGER NOT NULL DEFAULT 0,
  extra_note_count INTEGER NOT NULL DEFAULT 0,
  onset_error_sum_ms REAL NOT NULL DEFAULT 0,
  onset_error_sq_sum REAL NOT NULL DEFAULT 0,
  success_streak INTEGER NOT NULL DEFAULT 0,
  failure_streak INTEGER NOT NULL DEFAULT 0,
  best_tempo_bpm REAL,
  reliable_tempo_bpm REAL,
  mastery_score REAL NOT NULL DEFAULT 0,
  last_attempted_at INTEGER,
  last_success_at INTEGER,
  PRIMARY KEY (student_id, score_id, segment_type, segment_id)
);

CREATE TABLE IF NOT EXISTS student_skill_stats (
  student_id TEXT NOT NULL,
  skill_code TEXT NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  difficulty_sum REAL NOT NULL DEFAULT 0,
  mastery_score REAL NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  last_observed_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (student_id, skill_code)
);

CREATE TABLE IF NOT EXISTS practice_exercise (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  score_id TEXT NOT NULL,
  segment_type TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  exercise_type TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exercise_result (
  exercise_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  before_accuracy REAL,
  after_accuracy REAL,
  before_timing_rmse_ms REAL,
  after_timing_rmse_ms REAL,
  before_tempo_bpm REAL,
  after_tempo_bpm REAL,
  completed INTEGER NOT NULL,
  helpful_rating INTEGER,
  PRIMARY KEY (exercise_id, attempt_id)
);

CREATE INDEX IF NOT EXISTS idx_session_student_score_time
  ON practice_session(student_id, score_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempt_session
  ON practice_attempt(session_id, started_at);
CREATE INDEX IF NOT EXISTS idx_event_attempt_measure
  ON performance_event(attempt_id, measure_index);
CREATE INDEX IF NOT EXISTS idx_segment_weakness
  ON student_segment_stats(
    student_id,
    score_id,
    mastery_score,
    last_attempted_at
  );
