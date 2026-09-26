CREATE TYPE queue_status AS ENUM ('NONE', 'LT_5', 'FROM_5_TO_10', 'FROM_11_TO_15', 'GT_15');
--> statement-breakpoint
CREATE TABLE queue_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES stations(id),
  reporter_id uuid NOT NULL,
  queue_status queue_status NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '45 minutes'),
  CONSTRAINT queue_reports_station_reporter_unique UNIQUE (station_id, reporter_id)
);
--> statement-breakpoint
CREATE INDEX queue_reports_station_expires_idx ON queue_reports (station_id, expires_at);
