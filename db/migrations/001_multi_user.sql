-- Run once against the legacy schema. Bootstrap the resulting `legacy-admin`
-- account immediately after migration; its deliberately invalid hash cannot authenticate.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username_normalized varchar(32) NOT NULL UNIQUE,
 display_name varchar(100) NOT NULL, password_hash text NOT NULL, recovery_code_hash text,
 session_version integer NOT NULL DEFAULT 1 CHECK(session_version > 0), role text NOT NULL CHECK(role IN ('user','admin')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO users(username_normalized,display_name,password_hash,role) VALUES('legacy-admin','Legacy administrator','bootstrap-required','admin');
ALTER TABLE leads ADD COLUMN owner_uuid uuid;
ALTER TABLE activities ADD COLUMN owner_uuid uuid;
UPDATE leads SET owner_uuid=(SELECT id FROM users WHERE username_normalized='legacy-admin') WHERE owner_id='primary';
UPDATE activities SET owner_uuid=(SELECT id FROM users WHERE username_normalized='legacy-admin') WHERE owner_id='primary';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM leads WHERE owner_uuid IS NULL) OR EXISTS(SELECT 1 FROM activities WHERE owner_uuid IS NULL) THEN RAISE EXCEPTION 'Migration stopped: an owner other than primary exists'; END IF; END $$;
ALTER TABLE leads DROP COLUMN owner_id; ALTER TABLE leads RENAME COLUMN owner_uuid TO owner_id;
ALTER TABLE activities DROP COLUMN owner_id; ALTER TABLE activities RENAME COLUMN owner_uuid TO owner_id;
ALTER TABLE leads ALTER COLUMN owner_id SET NOT NULL, ADD CONSTRAINT leads_owner_fk FOREIGN KEY(owner_id) REFERENCES users(id);
ALTER TABLE activities ALTER COLUMN owner_id SET NOT NULL, ADD CONSTRAINT activities_owner_fk FOREIGN KEY(owner_id) REFERENCES users(id);
CREATE TABLE sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash text NOT NULL UNIQUE,session_version integer NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),user_agent varchar(300),ip_address inet);
CREATE INDEX sessions_user_idx ON sessions(user_id,expires_at DESC);
CREATE TABLE registration_invitations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code_hash text NOT NULL UNIQUE,created_by uuid NOT NULL REFERENCES users(id),expires_at timestamptz NOT NULL,consumed_at timestamptz,consumed_by uuid REFERENCES users(id),revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE recovery_attempt_limits(subject_hash text PRIMARY KEY,attempts integer NOT NULL DEFAULT 0,window_started_at timestamptz NOT NULL DEFAULT now(),blocked_until timestamptz);
COMMIT;
