# Fuel Map — Pyrénées-Atlantiques

First working version of a fuel-station map for département 64. The API imports the complete current government dataset for the département, while the web app opens on Pau and remains navigable across the whole area.

## Stack and layout

- `apps/web`: React, Vite, MapLibre GL JS and TanStack Query
- `apps/api`: NestJS REST API, scheduled/manual importer and health endpoints
- `packages/database`: Drizzle schema, PostgreSQL/PostGIS migration and fuel seed
- `data/station-overrides.json`: application-owned station names and brands

The importer uses the Opendatasoft v2.1 JSON export for `prix-des-carburants-en-france-flux-instantane-v2`, filtered by `code_departement="64"` in one request.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- PostgreSQL with the PostGIS extension available

## Start locally

```sh
npm install
cp .env.example .env
# Edit DATABASE_URL if needed.
npm run db:migrate
npm run db:seed
npm run dev
```

The API listens on `http://localhost:3000`; Vite uses `http://localhost:5173`. The HTTP server starts before the initial import, which runs asynchronously. It imports again every 15 minutes by default.

If Vite is launched independently from `apps/web`, put its two `VITE_` settings in `apps/web/.env.local`. When using `npm run dev` from the repository root, Vite also uses its documented defaults.

## Commands

- `npm run dev` — run API and web app in watch mode
- `npm run build` — production-build all workspaces
- `npm run typecheck` — check TypeScript in all workspaces
- `npm run lint` — run the configured static TypeScript checks
- `npm run db:migrate` — apply the PostGIS/schema migrations
- `npm run db:seed` — upsert the six supported fuel types
- `npm run import:fuels` — run the same importer used by startup and scheduling
- `npm run db:apply-overrides` — apply station names/brands from the JSON override file

## API

- `GET /api/v1/stations` — map markers for stations seen in the last 24 hours
- `GET /api/v1/stations/:id` — station details with exactly six fuels in UI order
- `GET /health` — application liveness
- `GET /ready` — PostgreSQL readiness query

## Import behavior

The importer acquires a session-level PostgreSQL advisory lock and skips if another instance is importing. It then creates a durable `RUNNING` audit row, downloads and validates the complete export, maps all valid records, and only then opens the synchronization transaction. A fetch, mapping or transaction failure leaves the previous station state untouched and marks the audit row `FAILED`.

Stations are keyed by the official government ID and are never deleted when absent from a run. Imports update source-owned address/location fields and `last_seen_at`, but never overwrite `display_name` or `brand`. PostGIS points are built explicitly as `POINT(longitude latitude)`.

Every station has six current fuel rows. New stations receive six baseline history rows. Later history is appended only when price, availability or rupture start changes; a source price timestamp change alone updates current metadata without creating history. Prices are stored as integer thousandths of one euro.

## Queue reports

Apply `npm run db:migrate` before running the API after this update. Queue reports are separate from official fuel data and expire after 45 minutes without deleting stored rows.

- `GET /api/v1/stations/:id?reporterId=<uuid>` includes `queue`; reporterId is optional and only exposes that reporter's active vote.
- `PUT /api/v1/stations/:id/queue-report` accepts `{ "reporterId": "<uuid>", "status": "NONE" }` and returns the queue aggregate. Statuses: `NONE`, `LT_5`, `FROM_5_TO_10`, `FROM_11_TO_15`, `GT_15`.
- The largest active group wins; ties use the group's latest update (then enum order for an exact timestamp tie). `confirmationsCount` counts all votes for the winner, including the current browser. `lastReportedAt` and `latestReport` describe the newest active vote; `statusLastReportedAt` describes the winner's latest vote.
- Browser identity uses `fuelmap_reporter_id` in localStorage, with a page-session fallback if storage is blocked. This is anonymous identification, not authentication.
- No queue polling or cleanup job is added. Details refresh after submitting a vote and through existing query lifecycle events.

Run `node apps/api/queue.integration.cjs` after building and migrating to test queue behavior against PostgreSQL. Its fixtures and writes are rolled back.

## Station overrides

Edit `data/station-overrides.json` with only names you know are correct:

```json
{
  "64000001": {
    "displayName": "Nom vérifié",
    "brand": "Enseigne vérifiée"
  }
}
```

Then run `npm run db:apply-overrides`. Missing names display as “Station-service”. Regular imports preserve override-owned fields.

## Configuration

See `.env.example` for all settings. Backend configuration is validated at startup. `FUEL_IMPORT_CRON` defaults to every 15 minutes, `FUEL_DATASET_DEPARTMENT` to `64`, and the frontend map style defaults to OpenFreeMap Liberty.

Migrations are intentionally never run automatically by the API. No Docker, monitoring, authentication, queues, cloud infrastructure, CI/CD, tests or history UI are included in this focused v0.
