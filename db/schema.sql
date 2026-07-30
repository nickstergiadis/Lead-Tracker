CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS leads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 name text NOT NULL, phone text NOT NULL, email text, location text NOT NULL, referral_source text, condition text NOT NULL,
 status text NOT NULL CHECK (status IN ('New inquiry','Contacted','Waiting for reply','Booked','Completed','Lost')),
 priority text NOT NULL CHECK (priority IN ('Low','Medium','High')), lead_type text NOT NULL CHECK (lead_type IN ('New patient','Returning patient')),
 next_follow_up date, next_action text, last_contacted_at timestamptz, last_contact_method text, booked_at timestamptz, notes text
);
CREATE TABLE IF NOT EXISTS activities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE, owner_id text NOT NULL, type text NOT NULL, activity_at timestamptz NOT NULL DEFAULT now(), contact_method text, note text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS leads_owner_status_idx ON leads(owner_id, lower(status));
CREATE INDEX IF NOT EXISTS leads_owner_follow_up_idx ON leads(owner_id, next_follow_up);
CREATE INDEX IF NOT EXISTS leads_owner_phone_idx ON leads(owner_id, regexp_replace(phone, '\\D', '', 'g'));
CREATE INDEX IF NOT EXISTS leads_owner_email_idx ON leads(owner_id, lower(trim(email)));
CREATE INDEX IF NOT EXISTS activities_owner_lead_idx ON activities(owner_id, lead_id, activity_at DESC);
