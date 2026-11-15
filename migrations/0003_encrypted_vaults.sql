-- Encrypted opaque vaults: server never receives plaintext medical data or password.
CREATE TABLE IF NOT EXISTS hemocare_encrypted_vaults (
 vault_id TEXT PRIMARY KEY,
 ciphertext TEXT NOT NULL,
 updated_at INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1
);