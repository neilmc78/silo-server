-- +goose Up
-- Second factors for local password sign-in. An account has two-step sign-in
-- while it holds a confirmed authenticator secret or at least one passkey.
-- Provider sign-ins (OIDC, plugins, network) never read these tables.

-- The authenticator (TOTP) secret, encrypted at rest with the data cipher.
-- confirmed_at stays NULL until the holder proves the app with a code;
-- last_step is the newest 30-second step accepted, so a code is never
-- accepted twice.
CREATE TABLE IF NOT EXISTS user_totp (
    user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_enc   TEXT        NOT NULL,
    confirmed_at TIMESTAMPTZ,
    last_step    BIGINT      NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- WebAuthn credentials. credential holds the library's credential record
-- (public key, sign count, flags); credential_id is unique across accounts.
CREATE TABLE IF NOT EXISTS user_passkeys (
    id            BIGSERIAL PRIMARY KEY,
    user_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id BYTEA       NOT NULL UNIQUE,
    credential    JSONB       NOT NULL,
    name          TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS user_passkeys_user_idx ON user_passkeys (user_id);

-- One-time recovery codes, stored as SHA-256 hashes of high-entropy codes.
CREATE TABLE IF NOT EXISTS user_recovery_codes (
    user_id   INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT        NOT NULL,
    used_at   TIMESTAMPTZ,
    PRIMARY KEY (user_id, code_hash)
);

-- Short-lived, single-use challenges: a sign-in waiting for its second step,
-- or a passkey registration or assertion ceremony. Kept in Postgres so any
-- node can finish what another started.
CREATE TABLE IF NOT EXISTS auth_challenges (
    id            TEXT PRIMARY KEY,
    user_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind          TEXT        NOT NULL,
    password_mark TEXT        NOT NULL DEFAULT '',
    ceremony      JSONB,
    failures      INTEGER     NOT NULL DEFAULT 0,
    expires_at    TIMESTAMPTZ NOT NULL,
    used_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS auth_challenges_expires_idx ON auth_challenges (expires_at);

-- +goose Down
DROP TABLE IF EXISTS auth_challenges;
DROP TABLE IF EXISTS user_recovery_codes;
DROP TABLE IF EXISTS user_passkeys;
DROP TABLE IF EXISTS user_totp;
