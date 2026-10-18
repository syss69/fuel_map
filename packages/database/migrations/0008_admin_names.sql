ALTER TABLE stations ADD COLUMN name_managed_by_admin boolean NOT NULL DEFAULT false;
CREATE TYPE name_suggestion_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TABLE admin_sessions (
 token_hash text PRIMARY KEY, username text NOT NULL, credential_version text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE TABLE admin_rate_limits (
 key text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE station_name_suggestions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), station_id uuid NOT NULL REFERENCES stations(id),
 reporter_id uuid NOT NULL, proposed_name text NOT NULL CHECK (char_length(proposed_name) BETWEEN 2 AND 120),
 comment text CHECK (char_length(comment) <= 1000), original_name text,
 status name_suggestion_status NOT NULL DEFAULT 'PENDING',
 created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
 reviewed_by text, decision_reason text, approved_name text
);
CREATE UNIQUE INDEX station_name_suggestions_pending_unique ON station_name_suggestions(station_id, reporter_id) WHERE status = 'PENDING';
CREATE INDEX station_name_suggestions_status_created_idx ON station_name_suggestions(status, created_at);
CREATE INDEX station_name_suggestions_station_idx ON station_name_suggestions(station_id, created_at);
CREATE TABLE station_name_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), station_id uuid NOT NULL REFERENCES stations(id),
 old_name text, new_name text NOT NULL, admin_username text NOT NULL,
 suggestion_id uuid REFERENCES station_name_suggestions(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX station_name_history_station_created_idx ON station_name_history(station_id, created_at);
