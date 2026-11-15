CREATE TABLE IF NOT EXISTS push_subscriptions (
 device_key TEXT PRIMARY KEY,
 subscription TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS push_reminders (
 device_key TEXT NOT NULL,
 reminder_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 due_at INTEGER NOT NULL,
 PRIMARY KEY(device_key,reminder_id),
 FOREIGN KEY(device_key) REFERENCES push_subscriptions(device_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_push_due ON push_reminders(due_at);
