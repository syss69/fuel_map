ALTER TABLE alert_rules ADD COLUMN price_threshold_milli_eur integer;
UPDATE alert_rules SET status='DISABLED',updated_at=now() WHERE event_type='PRICE_DROP' AND status='ACTIVE';
UPDATE push_deliveries SET status='FAILED',failed_at=now(),last_error='Price threshold required' WHERE status='PENDING' AND notification_event_id IN (SELECT id FROM notification_events WHERE type='PRICE_DROP');
ALTER TABLE alert_rules ADD CONSTRAINT alert_price_threshold CHECK ((price_threshold_milli_eur IS NULL OR price_threshold_milli_eur>0) AND (event_type<>'PRICE_DROP' OR status<>'ACTIVE' OR price_threshold_milli_eur IS NOT NULL));
