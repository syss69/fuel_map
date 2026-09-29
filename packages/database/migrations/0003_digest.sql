CREATE TYPE digest_subscription_status AS ENUM ('PENDING', 'ACTIVE', 'UNSUBSCRIBED');
--> statement-breakpoint
CREATE TYPE email_delivery_type AS ENUM ('MORNING_DIGEST', 'VERIFICATION');
--> statement-breakpoint
CREATE TYPE email_delivery_status AS ENUM ('PENDING', 'SENT', 'RETRY', 'FAILED', 'UNKNOWN', 'CANCELLED');
--> statement-breakpoint
CREATE TABLE digest_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
 fuel_type_id smallint NOT NULL REFERENCES fuel_types(id), center geography(Point,4326) NOT NULL,
 radius_meters integer NOT NULL CHECK (radius_meters IN (5000,10000,15000)),
 favorite_station_id uuid REFERENCES stations(id), timezone text NOT NULL DEFAULT 'Europe/Paris' CHECK(timezone='Europe/Paris'),
 send_time time NOT NULL DEFAULT '08:00' CHECK(send_time='08:00'),
 status digest_subscription_status NOT NULL DEFAULT 'PENDING',
 verification_token_hash text, verification_expires_at timestamptz, verified_at timestamptz,
 unsubscribe_token_hash text NOT NULL, unsubscribe_nonce uuid NOT NULL,
 last_confirmation_at timestamptz, last_sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX digest_verification_hash_idx ON digest_subscriptions(verification_token_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX digest_unsubscribe_hash_idx ON digest_subscriptions(unsubscribe_token_hash);
--> statement-breakpoint
CREATE INDEX digest_active_idx ON digest_subscriptions(status, last_sent_at);
--> statement-breakpoint
CREATE TABLE email_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subscription_id uuid NOT NULL REFERENCES digest_subscriptions(id),
 type email_delivery_type NOT NULL, recipient text NOT NULL, provider_message_id text,
 status email_delivery_status NOT NULL DEFAULT 'PENDING', local_date date,
 payload jsonb, attempts integer NOT NULL DEFAULT 0, last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
 UNIQUE(subscription_id,type,local_date)
);
--> statement-breakpoint
CREATE TABLE digest_rate_limits (
 key text PRIMARY KEY, window_started_at timestamptz NOT NULL DEFAULT now(), hits integer NOT NULL DEFAULT 1
);
