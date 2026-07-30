CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username_normalized varchar(32) NOT NULL UNIQUE,
  display_name varchar(100) NOT NULL,
  password_hash text NOT NULL,
  recovery_code_hash text,
  session_version integer NOT NULL DEFAULT 1 CHECK (session_version > 0),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, session_version integer NOT NULL, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), user_agent varchar(300), ip_address inet
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id, expires_at DESC);
CREATE TABLE IF NOT EXISTS registration_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL,
  consumed_at timestamptz, consumed_by uuid REFERENCES users(id), revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS recovery_attempt_limits (
  subject_hash text PRIMARY KEY, attempts integer NOT NULL DEFAULT 0, window_started_at timestamptz NOT NULL DEFAULT now(), blocked_until timestamptz
);

CREATE TABLE IF NOT EXISTS leads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 name text NOT NULL, phone text NOT NULL, email text, location text NOT NULL, referral_source text, condition text NOT NULL,
 status text NOT NULL CHECK (status IN ('New inquiry','Contacted','Waiting for reply','Booked','Completed','Lost')),
 priority text NOT NULL CHECK (priority IN ('Low','Medium','High')), lead_type text NOT NULL CHECK (lead_type IN ('New patient','Returning patient')),
 next_follow_up date, next_action text, last_contacted_at timestamptz, last_contact_method text, booked_at timestamptz, notes text
);
CREATE TABLE IF NOT EXISTS activities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE, owner_id uuid NOT NULL REFERENCES users(id), type text NOT NULL, activity_at timestamptz NOT NULL DEFAULT now(), contact_method text, note text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS leads_owner_status_idx ON leads(owner_id, lower(status));
CREATE INDEX IF NOT EXISTS leads_owner_follow_up_idx ON leads(owner_id, next_follow_up);
CREATE INDEX IF NOT EXISTS leads_owner_phone_idx ON leads(owner_id, regexp_replace(phone, '\\D', '', 'g'));
CREATE INDEX IF NOT EXISTS leads_owner_email_idx ON leads(owner_id, lower(trim(email)));
CREATE INDEX IF NOT EXISTS activities_owner_lead_idx ON activities(owner_id, lead_id, activity_at DESC);
