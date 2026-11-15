-- Versioned push tables avoid collisions with earlier D1 schemas.
CREATE TABLE IF NOT EXISTS hemocare_push_subscriptions_v2 (
 device_key TEXT PRIMARY KEY,
 subscription TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hemocare_push_reminders_v2 (
 device_key TEXT NOT NULL,
 reminder_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 due_at INTEGER NOT NULL,
 PRIMARY KEY(device_key,reminder_id),
 FOREIGN KEY(device_key) REFERENCES hemocare_push_subscriptions_v2(device_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_hemocare_push_v2_due ON hemocare_push_reminders_v2(due_at);
