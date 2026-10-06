-- Future official updates only: no backfill and no events for initial INSERTs.
CREATE OR REPLACE FUNCTION record_official_fuel_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kinds text[] := ARRAY[]::text[]; kind text;
BEGIN
 IF OLD.price_milli_eur IS NOT NULL AND NEW.price_milli_eur IS NOT NULL THEN
  IF NEW.price_milli_eur<OLD.price_milli_eur THEN kinds:=array_append(kinds,'PRICE_DECREASED'); END IF;
  IF NEW.price_milli_eur>OLD.price_milli_eur THEN kinds:=array_append(kinds,'PRICE_INCREASED'); END IF;
 END IF;
 IF OLD.availability IN ('UNKNOWN','UNAVAILABLE','TEMPORARILY_UNAVAILABLE','PERMANENTLY_UNAVAILABLE') AND NEW.availability='AVAILABLE' THEN kinds:=array_append(kinds,'BECAME_AVAILABLE'); END IF;
 IF OLD.availability='AVAILABLE' AND NEW.availability IN ('UNAVAILABLE','TEMPORARILY_UNAVAILABLE','PERMANENTLY_UNAVAILABLE') THEN kinds:=array_append(kinds,'BECAME_UNAVAILABLE'); END IF;
 FOREACH kind IN ARRAY kinds LOOP
  INSERT INTO fuel_events(station_id,fuel_type_id,type,previous_price_milli_eur,current_price_milli_eur,previous_availability,current_availability)
  VALUES(NEW.station_id,NEW.fuel_type_id,kind,OLD.price_milli_eur,NEW.price_milli_eur,OLD.availability,NEW.availability);
 END LOOP;
 RETURN NEW;
END $$;
