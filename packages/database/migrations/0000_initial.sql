CREATE EXTENSION IF NOT EXISTS postgis;

DO $$ BEGIN
  CREATE TYPE fuel_availability AS ENUM (
    'AVAILABLE', 'TEMPORARILY_UNAVAILABLE', 'PERMANENTLY_UNAVAILABLE', 'UNAVAILABLE', 'UNKNOWN'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE import_status AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  official_id text UNIQUE NOT NULL,
  display_name text,
  brand text,
  address text,
  city text,
  postal_code text,
  department_code text NOT NULL,
  location geography(Point, 4326) NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fuel_types (
  id smallint PRIMARY KEY,
  code text UNIQUE NOT NULL,
  label text NOT NULL,
  sort_order smallint NOT NULL
);

CREATE TABLE IF NOT EXISTS station_fuels (
  station_id uuid NOT NULL REFERENCES stations(id),
  fuel_type_id smallint NOT NULL REFERENCES fuel_types(id),
  price_milli_eur integer,
  availability fuel_availability NOT NULL,
  source_price_updated_at timestamptz,
  source_rupture_started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (station_id, fuel_type_id)
);

CREATE TABLE IF NOT EXISTS station_fuel_history (
  id bigserial PRIMARY KEY,
  station_id uuid NOT NULL REFERENCES stations(id),
  fuel_type_id smallint NOT NULL REFERENCES fuel_types(id),
  price_milli_eur integer,
  availability fuel_availability NOT NULL,
  source_price_updated_at timestamptz,
  source_rupture_started_at timestamptz,
  observed_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS import_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status import_status NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  records_received integer NOT NULL DEFAULT 0,
  records_valid integer NOT NULL DEFAULT 0,
  records_invalid integer NOT NULL DEFAULT 0,
  stations_created integer NOT NULL DEFAULT 0,
  stations_metadata_updated integer NOT NULL DEFAULT 0,
  fuel_states_changed integer NOT NULL DEFAULT 0,
  history_rows_created integer NOT NULL DEFAULT 0,
  error_message text
);

CREATE INDEX IF NOT EXISTS stations_department_seen_idx ON stations (department_code, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS stations_location_gix ON stations USING gist (location);
CREATE INDEX IF NOT EXISTS station_fuel_history_lookup_idx
  ON station_fuel_history (station_id, fuel_type_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS station_fuels_station_idx ON station_fuels (station_id);
