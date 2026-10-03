CREATE TABLE subscribers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL,
 email_verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO subscribers(email,email_verified_at) SELECT email,verified_at FROM digest_subscriptions;
ALTER TABLE digest_subscriptions ADD COLUMN subscriber_id uuid REFERENCES subscribers(id);
UPDATE digest_subscriptions d SET subscriber_id=s.id FROM subscribers s WHERE s.email=d.email;
ALTER TABLE digest_subscriptions ALTER COLUMN subscriber_id SET NOT NULL;
CREATE UNIQUE INDEX digest_subscriber_idx ON digest_subscriptions(subscriber_id);
-- Keep legacy email-based digest writes compatible and identity shared.
CREATE FUNCTION digest_subscriber_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO subscribers(email,email_verified_at) VALUES(NEW.email,NEW.verified_at)
 ON CONFLICT(email) DO UPDATE SET email_verified_at=COALESCE(subscribers.email_verified_at,EXCLUDED.email_verified_at)
 RETURNING id INTO NEW.subscriber_id;
 RETURN NEW;
END $$;
CREATE TRIGGER digest_subscriber_identity BEFORE INSERT OR UPDATE OF email,verified_at ON digest_subscriptions FOR EACH ROW EXECUTE FUNCTION digest_subscriber_identity();
CREATE TABLE subscriber_magic_links (
 token_hash text PRIMARY KEY, subscriber_id uuid NOT NULL REFERENCES subscribers(id),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE subscriber_sessions (
 token_hash text PRIMARY KEY, subscriber_id uuid NOT NULL REFERENCES subscribers(id),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriber_session_expiry ON subscriber_sessions(expires_at);
CREATE TABLE subscriber_rate_limits(key text PRIMARY KEY, hits integer NOT NULL DEFAULT 1, window_started_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE push_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subscriber_id uuid NOT NULL REFERENCES subscribers(id), endpoint text UNIQUE NOT NULL,
 p256dh text NOT NULL, auth text NOT NULL, user_agent text, device_label text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE INDEX push_subscriber_idx ON push_subscriptions(subscriber_id);
CREATE TABLE fuel_events (
 id bigserial PRIMARY KEY, station_id uuid NOT NULL REFERENCES stations(id), fuel_type_id smallint NOT NULL REFERENCES fuel_types(id),
 type text NOT NULL CHECK(type IN ('PRICE_DECREASED','PRICE_INCREASED','BECAME_AVAILABLE','BECAME_UNAVAILABLE')),
 previous_price_milli_eur integer, current_price_milli_eur integer,
 previous_availability fuel_availability NOT NULL, current_availability fuel_availability NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), processed_at timestamptz
);
CREATE INDEX fuel_events_pending_idx ON fuel_events(id) WHERE processed_at IS NULL;
CREATE INDEX fuel_events_station_idx ON fuel_events(station_id,fuel_type_id,id);
CREATE TABLE alert_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subscriber_id uuid NOT NULL REFERENCES subscribers(id),
 station_id uuid NOT NULL REFERENCES stations(id), fuel_type_id smallint NOT NULL REFERENCES fuel_types(id),
 event_type text NOT NULL CHECK(event_type IN ('FUEL_AVAILABLE','PRICE_DROP')),
 frequency text NOT NULL CHECK(frequency IN ('ONCE','RECURRING')),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED','COMPLETED')),
 price_drop_armed boolean, after_event_id bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(subscriber_id,station_id,fuel_type_id,event_type)
);
CREATE INDEX alert_rules_match_idx ON alert_rules(station_id,fuel_type_id,status);
CREATE TABLE notification_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subscriber_id uuid NOT NULL REFERENCES subscribers(id),
 alert_rule_id uuid NOT NULL REFERENCES alert_rules(id), fuel_event_id bigint NOT NULL REFERENCES fuel_events(id),
 type text NOT NULL, title text NOT NULL, body text NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(alert_rule_id,fuel_event_id)
);
CREATE TABLE push_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), notification_event_id uuid NOT NULL REFERENCES notification_events(id),
 push_subscription_id uuid NOT NULL REFERENCES push_subscriptions(id),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENT','FAILED')),
 attempt_count integer NOT NULL DEFAULT 0, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz, failed_at timestamptz, next_attempt_at timestamptz, UNIQUE(notification_event_id,push_subscription_id)
);
CREATE INDEX push_delivery_pending_idx ON push_deliveries(status,next_attempt_at);
-- A DB trigger keeps official state/history/event commits atomic for scheduled and CLI imports.
-- Initial INSERTs deliberately do not emit events.
CREATE FUNCTION record_official_fuel_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kinds text[] := ARRAY[]::text[]; kind text;
BEGIN
 IF OLD.price_milli_eur IS NOT NULL AND NEW.price_milli_eur IS NOT NULL THEN
  IF NEW.price_milli_eur<OLD.price_milli_eur THEN kinds:=array_append(kinds,'PRICE_DECREASED'); END IF;
  IF NEW.price_milli_eur>OLD.price_milli_eur THEN kinds:=array_append(kinds,'PRICE_INCREASED'); END IF;
 END IF;
 IF OLD.availability IN ('UNAVAILABLE','TEMPORARILY_UNAVAILABLE','PERMANENTLY_UNAVAILABLE') AND NEW.availability='AVAILABLE' THEN kinds:=array_append(kinds,'BECAME_AVAILABLE'); END IF;
 IF OLD.availability='AVAILABLE' AND NEW.availability IN ('UNAVAILABLE','TEMPORARILY_UNAVAILABLE','PERMANENTLY_UNAVAILABLE') THEN kinds:=array_append(kinds,'BECAME_UNAVAILABLE'); END IF;
 FOREACH kind IN ARRAY kinds LOOP
  INSERT INTO fuel_events(station_id,fuel_type_id,type,previous_price_milli_eur,current_price_milli_eur,previous_availability,current_availability)
  VALUES(NEW.station_id,NEW.fuel_type_id,kind,OLD.price_milli_eur,NEW.price_milli_eur,OLD.availability,NEW.availability);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER official_fuel_events AFTER UPDATE ON station_fuels FOR EACH ROW EXECUTE FUNCTION record_official_fuel_event();
