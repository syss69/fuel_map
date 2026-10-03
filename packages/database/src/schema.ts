import {
  bigint,
  boolean,
  bigserial,
  integer,
  index,
  check,
  time,
  date,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { customType } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const geographyPoint = customType<{ data: string }>({
  dataType() {
    return 'geography(Point,4326)';
  },
});

export const availabilityEnum = pgEnum('fuel_availability', [
  'AVAILABLE',
  'TEMPORARILY_UNAVAILABLE',
  'PERMANENTLY_UNAVAILABLE',
  'UNAVAILABLE',
  'UNKNOWN',
]);
export const importStatusEnum = pgEnum('import_status', ['RUNNING', 'SUCCESS', 'FAILED']);
export const queueStatusEnum = pgEnum('queue_status', ['NONE', 'LT_5', 'FROM_5_TO_10', 'FROM_11_TO_15', 'GT_15']);

export const stations = pgTable(
  'stations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    officialId: text('official_id').notNull(),
    displayName: text('display_name'),
    brand: text('brand'),
    address: text('address'),
    city: text('city'),
    postalCode: text('postal_code'),
    departmentCode: text('department_code').notNull(),
    location: geographyPoint('location').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('stations_official_id_uidx').on(table.officialId)],
);

export const queueReports = pgTable('queue_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  stationId: uuid('station_id').notNull().references(() => stations.id),
  reporterId: uuid('reporter_id').notNull(),
  queueStatus: queueStatusEnum('queue_status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().default(sql`now() + interval '45 minutes'`),
}, (table) => [
  uniqueIndex('queue_reports_station_reporter_unique').on(table.stationId, table.reporterId),
  index('queue_reports_station_expires_idx').on(table.stationId, table.expiresAt),
]);

export const fuelTypes = pgTable('fuel_types', {
  id: smallint('id').primaryKey(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  sortOrder: smallint('sort_order').notNull(),
});

export const communityAvailabilityEnum = pgEnum('community_fuel_availability', ['AVAILABLE', 'UNAVAILABLE']);

export const stationDataConfirmations = pgTable('station_data_confirmations', {
  id: uuid('id').defaultRandom().primaryKey(),
  stationId: uuid('station_id').notNull().references(() => stations.id),
  reporterId: uuid('reporter_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().default(sql`now() + interval '3 hours'`),
}, (t) => [
  uniqueIndex('station_data_confirmations_unique').on(t.stationId, t.reporterId),
  index('station_data_confirmations_active_idx').on(t.stationId, t.expiresAt),
]);

export const fuelChangeReports = pgTable('fuel_change_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  stationId: uuid('station_id').notNull().references(() => stations.id),
  fuelTypeId: smallint('fuel_type_id').notNull().references(() => fuelTypes.id),
  reporterId: uuid('reporter_id').notNull(),
  reportedPriceMilliEur: integer('reported_price_milli_eur'),
  reportedAvailability: communityAvailabilityEnum('reported_availability'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().default(sql`now() + interval '3 hours'`),
}, (t) => [
  uniqueIndex('fuel_change_reports_unique').on(t.stationId, t.fuelTypeId, t.reporterId),
  index('fuel_change_reports_active_idx').on(t.stationId, t.expiresAt),
  check('fuel_change_reports_has_value', sql`${t.reportedPriceMilliEur} IS NOT NULL OR ${t.reportedAvailability} IS NOT NULL`),
  check('fuel_change_reports_positive_price', sql`${t.reportedPriceMilliEur} > 0`),
]);

export const stationFuels = pgTable(
  'station_fuels',
  {
    stationId: uuid('station_id').notNull().references(() => stations.id),
    fuelTypeId: smallint('fuel_type_id').notNull().references(() => fuelTypes.id),
    priceMilliEur: integer('price_milli_eur'),
    availability: availabilityEnum('availability').notNull(),
    sourcePriceUpdatedAt: timestamp('source_price_updated_at', { withTimezone: true }),
    sourceRuptureStartedAt: timestamp('source_rupture_started_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.stationId, table.fuelTypeId] })],
);

export const stationFuelHistory = pgTable('station_fuel_history', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  stationId: uuid('station_id').notNull().references(() => stations.id),
  fuelTypeId: smallint('fuel_type_id').notNull().references(() => fuelTypes.id),
  priceMilliEur: integer('price_milli_eur'),
  availability: availabilityEnum('availability').notNull(),
  sourcePriceUpdatedAt: timestamp('source_price_updated_at', { withTimezone: true }),
  sourceRuptureStartedAt: timestamp('source_rupture_started_at', { withTimezone: true }),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
});

export const importRuns = pgTable('import_runs', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  status: importStatusEnum('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  recordsReceived: integer('records_received').notNull().default(0),
  recordsValid: integer('records_valid').notNull().default(0),
  recordsInvalid: integer('records_invalid').notNull().default(0),
  stationsCreated: integer('stations_created').notNull().default(0),
  stationsMetadataUpdated: integer('stations_metadata_updated').notNull().default(0),
  fuelStatesChanged: integer('fuel_states_changed').notNull().default(0),
  historyRowsCreated: integer('history_rows_created').notNull().default(0),
  errorMessage: text('error_message'),
});

export const subscribers = pgTable('subscribers', {
  id: uuid('id').defaultRandom().primaryKey(), email: text('email').notNull().unique(),
  emailVerifiedAt: timestamp('email_verified_at', {withTimezone:true}),
  createdAt: timestamp('created_at', {withTimezone:true}).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', {withTimezone:true}).defaultNow().notNull(),
});
export const digestStatusEnum = pgEnum('digest_subscription_status', ['PENDING', 'ACTIVE', 'UNSUBSCRIBED']);
export const emailTypeEnum = pgEnum('email_delivery_type', ['MORNING_DIGEST', 'VERIFICATION']);
export const emailStatusEnum = pgEnum('email_delivery_status', ['PENDING', 'SENT', 'RETRY', 'FAILED', 'UNKNOWN', 'CANCELLED']);
export const digestSubscriptions = pgTable('digest_subscriptions', {
  subscriberId: uuid('subscriber_id').notNull().references(()=>subscribers.id),
  id: uuid('id').defaultRandom().primaryKey(), email: text('email').notNull().unique(),
  fuelTypeId: smallint('fuel_type_id').notNull().references(() => fuelTypes.id),
  center: geographyPoint('center').notNull(), radiusMeters: integer('radius_meters').notNull(),
  favoriteStationId: uuid('favorite_station_id').references(() => stations.id),
  timezone: text('timezone').notNull().default('Europe/Paris'), sendTime: time('send_time').notNull().default('08:00'),
  weekdays: integer('weekdays').array().notNull().default(sql`ARRAY[1,3,5]`),
  status: digestStatusEnum('status').notNull().default('PENDING'),
  verificationTokenHash: text('verification_token_hash'), verificationExpiresAt: timestamp('verification_expires_at', { withTimezone: true }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }), unsubscribeTokenHash: text('unsubscribe_token_hash').notNull(),
  unsubscribeNonce: uuid('unsubscribe_nonce').notNull(), lastConfirmationAt: timestamp('last_confirmation_at', { withTimezone: true }),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex('digest_verification_hash_idx').on(t.verificationTokenHash), uniqueIndex('digest_unsubscribe_hash_idx').on(t.unsubscribeTokenHash),
  index('digest_active_idx').on(t.status, t.lastSentAt),
  uniqueIndex('digest_subscriber_idx').on(t.subscriberId),
  check('digest_radius', sql`${t.radiusMeters} IN (5000,10000,15000)`),
  check('digest_weekdays', sql`array_ndims(${t.weekdays}) = 1 AND array_lower(${t.weekdays},1) = 1 AND cardinality(${t.weekdays}) BETWEEN 1 AND 3 AND ${t.weekdays} <@ ARRAY[1,2,3,4,5,6,7] AND array_position(${t.weekdays},NULL) IS NULL AND (cardinality(${t.weekdays})<2 OR ${t.weekdays}[1]<>${t.weekdays}[2]) AND (cardinality(${t.weekdays})<3 OR (${t.weekdays}[1]<>${t.weekdays}[3] AND ${t.weekdays}[2]<>${t.weekdays}[3]))`),
  check('digest_timezone', sql`${t.timezone} = 'Europe/Paris'`), check('digest_send_time', sql`${t.sendTime} = '08:00'`),
]);
export const emailDeliveries = pgTable('email_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(), subscriptionId: uuid('subscription_id').notNull().references(() => digestSubscriptions.id),
  type: emailTypeEnum('type').notNull(), recipient: text('recipient').notNull(), providerMessageId: text('provider_message_id'),
  status: emailStatusEnum('status').notNull().default('PENDING'), localDate: date('local_date'), payload: jsonb('payload'),
  attempts: integer('attempts').notNull().default(0), lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), sentAt: timestamp('sent_at', { withTimezone: true }),
}, t => [uniqueIndex('email_deliveries_day_unique').on(t.subscriptionId, t.type, t.localDate)]);
export const digestRateLimits = pgTable('digest_rate_limits', {
  key: text('key').primaryKey(), windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
  hits: integer('hits').notNull().default(1),
});

export const subscriberMagicLinks = pgTable('subscriber_magic_links', {
 tokenHash:text('token_hash').primaryKey(),subscriberId:uuid('subscriber_id').notNull().references(()=>subscribers.id),
 expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const subscriberSessions = pgTable('subscriber_sessions', {
 tokenHash:text('token_hash').primaryKey(),subscriberId:uuid('subscriber_id').notNull().references(()=>subscribers.id),
 expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[index('subscriber_session_expiry').on(t.expiresAt)]);
export const subscriberRateLimits=pgTable('subscriber_rate_limits',{
 key:text('key').primaryKey(),hits:integer('hits').notNull().default(1),windowStartedAt:timestamp('window_started_at',{withTimezone:true}).notNull().defaultNow(),
});
export const pushSubscriptions=pgTable('push_subscriptions',{
 id:uuid('id').defaultRandom().primaryKey(),subscriberId:uuid('subscriber_id').notNull().references(()=>subscribers.id),endpoint:text('endpoint').notNull().unique(),
 p256dh:text('p256dh').notNull(),auth:text('auth').notNull(),userAgent:text('user_agent'),deviceLabel:text('device_label'),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
 lastSeenAt:timestamp('last_seen_at',{withTimezone:true}).notNull().defaultNow(),revokedAt:timestamp('revoked_at',{withTimezone:true}),
},t=>[index('push_subscriber_idx').on(t.subscriberId)]);
export const fuelEvents=pgTable('fuel_events',{
 id:bigserial('id',{mode:'number'}).primaryKey(),stationId:uuid('station_id').notNull().references(()=>stations.id),fuelTypeId:smallint('fuel_type_id').notNull().references(()=>fuelTypes.id),
 type:text('type').notNull(),previousPriceMilliEur:integer('previous_price_milli_eur'),currentPriceMilliEur:integer('current_price_milli_eur'),
 previousAvailability:availabilityEnum('previous_availability').notNull(),currentAvailability:availabilityEnum('current_availability').notNull(),
 occurredAt:timestamp('occurred_at',{withTimezone:true}).notNull().default(sql`clock_timestamp()`),processedAt:timestamp('processed_at',{withTimezone:true}),
},t=>[index('fuel_events_pending_idx').on(t.id).where(sql`${t.processedAt} IS NULL`),index('fuel_events_station_idx').on(t.stationId,t.fuelTypeId,t.id),check('fuel_events_type_check',sql`${t.type} IN ('PRICE_DECREASED','PRICE_INCREASED','BECAME_AVAILABLE','BECAME_UNAVAILABLE')`)]);
export const alertRules=pgTable('alert_rules',{
 id:uuid('id').defaultRandom().primaryKey(),subscriberId:uuid('subscriber_id').notNull().references(()=>subscribers.id),stationId:uuid('station_id').notNull().references(()=>stations.id),fuelTypeId:smallint('fuel_type_id').notNull().references(()=>fuelTypes.id),
 eventType:text('event_type').notNull(),frequency:text('frequency').notNull(),status:text('status').notNull().default('ACTIVE'),priceThresholdMilliEur:integer('price_threshold_milli_eur'),priceDropArmed:boolean('price_drop_armed'),afterEventId:bigint('after_event_id',{mode:'number'}).notNull().default(0),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),completedAt:timestamp('completed_at',{withTimezone:true}),
},t=>[check('alert_price_threshold',sql`(${t.priceThresholdMilliEur} IS NULL OR ${t.priceThresholdMilliEur}>0) AND (${t.eventType}<>'PRICE_DROP' OR ${t.status}<>'ACTIVE' OR ${t.priceThresholdMilliEur} IS NOT NULL)`),uniqueIndex('alert_rules_identity').on(t.subscriberId,t.stationId,t.fuelTypeId,t.eventType),index('alert_rules_match_idx').on(t.stationId,t.fuelTypeId,t.status),check('alert_rules_event_type_check',sql`${t.eventType} IN ('FUEL_AVAILABLE','PRICE_DROP')`),check('alert_rules_frequency_check',sql`${t.frequency} IN ('ONCE','RECURRING')`),check('alert_rules_status_check',sql`${t.status} IN ('ACTIVE','DISABLED','COMPLETED')`)]);
export const notificationEvents=pgTable('notification_events',{
 id:uuid('id').defaultRandom().primaryKey(),subscriberId:uuid('subscriber_id').notNull().references(()=>subscribers.id),alertRuleId:uuid('alert_rule_id').notNull().references(()=>alertRules.id),fuelEventId:bigint('fuel_event_id',{mode:'number'}).notNull().references(()=>fuelEvents.id),type:text('type').notNull(),title:text('title').notNull(),body:text('body').notNull(),payload:jsonb('payload').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('notification_events_identity').on(t.alertRuleId,t.fuelEventId)]);
export const pushDeliveries=pgTable('push_deliveries',{
 id:uuid('id').defaultRandom().primaryKey(),notificationEventId:uuid('notification_event_id').notNull().references(()=>notificationEvents.id),pushSubscriptionId:uuid('push_subscription_id').notNull().references(()=>pushSubscriptions.id),status:text('status').notNull().default('PENDING'),attemptCount:integer('attempt_count').notNull().default(0),lastError:text('last_error'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),sentAt:timestamp('sent_at',{withTimezone:true}),failedAt:timestamp('failed_at',{withTimezone:true}),nextAttemptAt:timestamp('next_attempt_at',{withTimezone:true}),
},t=>[uniqueIndex('push_deliveries_identity').on(t.notificationEventId,t.pushSubscriptionId),index('push_delivery_pending_idx').on(t.status,t.nextAttemptAt),check('push_deliveries_status_check',sql`${t.status} IN ('PENDING','SENT','FAILED')`)]);
