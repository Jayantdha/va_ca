CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE,
  role TEXT NOT NULL,
  name TEXT,
  bio TEXT,
  niche TEXT,
  gstin TEXT,
  kyc_note TEXT,
  verif TEXT NOT NULL DEFAULT 'pending',
  pass_hash TEXT,
  reveal_at BIGINT,
  consent_v TEXT,
  consent_at BIGINT,
  deleted INTEGER NOT NULL DEFAULT 0,
  created BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS otps (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  exp BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  access_hash TEXT UNIQUE NOT NULL,
  access_exp BIGINT NOT NULL,
  refresh_hash TEXT UNIQUE NOT NULL,
  refresh_exp BIGINT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  device TEXT,
  created BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS used_refresh (
  hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS likes (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  created BIGINT NOT NULL,
  PRIMARY KEY (from_id, to_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  order_id TEXT UNIQUE NOT NULL,
  amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL,
  paid_at BIGINT,
  created BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  a_id TEXT NOT NULL,
  b_id TEXT NOT NULL,
  created BIGINT NOT NULL,
  UNIQUE(a_id, b_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  body TEXT NOT NULL,
  has_link INTEGER NOT NULL DEFAULT 0,
  created BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  file TEXT NOT NULL,
  status TEXT NOT NULL,
  created BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker TEXT NOT NULL,
  blocked TEXT NOT NULL,
  PRIMARY KEY (blocker, blocked)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter TEXT NOT NULL,
  target TEXT NOT NULL,
  message_id TEXT,
  reason TEXT NOT NULL,
  created BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
);

CREATE INDEX IF NOT EXISTS idx_users_role_verif ON users(role, verif);
CREATE INDEX IF NOT EXISTS idx_likes_to_id ON likes(to_id, created);
CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, revoked);
