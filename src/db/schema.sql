-- ============================================
-- NailsAI Agent - Database Schema (Cloudflare D1)
-- ============================================

-- Clients: Maps WhatsApp phone to client profile
CREATE TABLE IF NOT EXISTS clients (
  phone        TEXT PRIMARY KEY,      -- WhatsApp phone number (e.g. "5511999999999")
  name         TEXT NOT NULL DEFAULT 'Cliente',
  notes        TEXT,                  -- Nail designer's notes about this client
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Appointments: Links Google Calendar event to client phone
CREATE TABLE IF NOT EXISTS appointments (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  google_event_id  TEXT UNIQUE NOT NULL,
  client_phone     TEXT NOT NULL REFERENCES clients(phone),
  service_type     TEXT NOT NULL DEFAULT 'alongamento', -- 'alongamento', 'manutencao', 'banho_gel', 'remocao'
  scheduled_at     TEXT NOT NULL,  -- ISO8601 UTC datetime
  duration_minutes INTEGER NOT NULL DEFAULT 120,
  status           TEXT NOT NULL DEFAULT 'confirmed', -- 'confirmed', 'completed', 'cancelled', 'no_show'
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reminders: Tracks scheduled alarm notifications
CREATE TABLE IF NOT EXISTS reminders (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  appointment_id  TEXT NOT NULL REFERENCES appointments(id),
  client_phone    TEXT NOT NULL,
  reminder_type   TEXT NOT NULL,  -- '24h_before', '30d_maintenance', 'custom'
  send_at         TEXT NOT NULL,  -- ISO8601 UTC when to send
  sent_at         TEXT,           -- NULL = pending, filled when sent
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'failed', 'cancelled'
  message_preview TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Conversation logs for debugging and eval analysis
CREATE TABLE IF NOT EXISTS conversation_logs (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  client_phone TEXT NOT NULL,
  role         TEXT NOT NULL,  -- 'user' | 'assistant' | 'tool'
  content      TEXT NOT NULL,
  tool_name    TEXT,           -- filled when role = 'tool'
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_appointments_client_phone ON appointments(client_phone);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_at ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_reminders_client_phone ON reminders(client_phone);
CREATE INDEX IF NOT EXISTS idx_reminders_send_at ON reminders(send_at, status);
CREATE INDEX IF NOT EXISTS idx_conversation_logs_client ON conversation_logs(client_phone, created_at);
