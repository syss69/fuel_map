CREATE TYPE community_fuel_availability AS ENUM ('AVAILABLE', 'UNAVAILABLE');
--> statement-breakpoint
CREATE TABLE station_data_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES stations(id),
  reporter_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '3 hours'),
  CONSTRAINT station_data_confirmations_unique UNIQUE (station_id, reporter_id)
);
--> statement-breakpoint
CREATE INDEX station_data_confirmations_active_idx ON station_data_confirmations(station_id, expires_at);
--> statement-breakpoint
CREATE TABLE fuel_change_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES stations(id),
  fuel_type_id smallint NOT NULL REFERENCES fuel_types(id),
  reporter_id uuid NOT NULL,
  reported_price_milli_eur integer,
  reported_availability community_fuel_availability,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '3 hours'),
  CONSTRAINT fuel_change_reports_unique UNIQUE(station_id, fuel_type_id, reporter_id),
  CONSTRAINT fuel_change_reports_has_value CHECK (reported_price_milli_eur IS NOT NULL OR reported_availability IS NOT NULL),
  CONSTRAINT fuel_change_reports_positive_price CHECK (reported_price_milli_eur > 0)
);
--> statement-breakpoint
CREATE INDEX fuel_change_reports_active_idx ON fuel_change_reports(station_id, expires_at);
