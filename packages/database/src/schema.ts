import {
  bigint,
  bigserial,
  integer,
  index,
  check,
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
