# TrajetIco — Pyrénées-Atlantiques

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

## Fuel community layer

Run `npm run db:migrate` before starting the updated API. Official `station_fuels`, importer behavior, marker colors and fuel filters are unchanged. Queue reports remain independent.

- `PUT /api/v1/stations/:id/confirmation`: `{ "reporterId": "<uuid>" }` confirms the station's official fuel information and expires the same reporter's active fuel proposals.
- `PUT /api/v1/stations/:id/fuel-reports`: `{ "reporterId": "<uuid>", "fuels": [{ "fuelCode": "SP98", "availability": "UNAVAILABLE", "priceMilliEur": 1899 }] }` saves proposals and expires the reporter's active confirmation. Each submitted fuel replaces that reporter's previous proposal; other fuels are retained.
- Both return `community`; station details also include it, using the existing optional `reporterId` query parameter. It contains `confirmationsCount`, `myConfirmationActive`, `hasDiscrepancies` and `fuelDiscrepancies`. Each discrepancy has `fuelCode`, `availability: { value, reportsCount, lastReportedAt } | null` and `price: { valueMilliEur, reportsCount, lastReportedAt } | null`. No reporter identities are returned.
- TTL is three hours, with no deletion job. Prices must be positive integers no larger than 2147483647. Availability accepts only `AVAILABLE`/`UNAVAILABLE`; official temporary and permanent unavailability both normalize to `UNAVAILABLE`, while unknown remains distinct.
- Matching fields are discarded; a request with no remaining changes returns HTTP 400 without changing previous reports/confirmation. Read-time aggregation excludes expired and now-matching fields. Price and availability vote independently: most votes, then latest timestamp, then ascending value for an exact tie. Each count/time describes the winning value. Confirmations remain active until expiry even if official information changes.
- The form accepts decimal euros with comma or dot and up to three decimal places. Empty fields mean no proposal, not deletion of official values. Submissions refresh details without adding polling.

After building and migrating, run `node apps/api/community.integration.cjs` and `node apps/api/queue.integration.cjs`. Both roll back all test writes. For manual UI validation, `node apps/api/community.preview.cjs` serves an isolated fixture at `http://localhost:5174`, with a simulated first-submit error; press Enter to stop and roll back. This preview is local-only and is not part of the production API.

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

Migrations are intentionally never run automatically by the API. No Docker, authentication, external job queues, cloud infrastructure or history UI are included.

## Morning email digest

The map's **Digest du matin** button opens the subscription form. Select a fuel, click a search point on the existing map, choose 5/10/15 km, optionally select an existing favorite station, and enter an email. Confirm the email before any digest is sent. Verification and unsubscribe pages require a button press so email link scanners cannot activate or cancel a subscription.

Configuration: `RESEND_API_KEY`, `EMAIL_FROM=Trajetico <bonjour@trajetico.space>`, and a persistent random `DIGEST_TOKEN_SECRET` of at least 32 characters. Generate a secret once (for example `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Set `PUBLIC_APP_URL=https://trajetico.space` in production; otherwise links use `FRONTEND_ORIGIN`. Keep the secret stable and backed up: changing it invalidates reconstructed unsubscribe links. HTTPS and a verified sender domain are needed in production. `DIGEST_ENABLED=false` disables subscription creation and scheduling; existing verification/unsubscribe endpoints remain usable. Missing provider configuration disables sending without preventing API startup. Configure `TRUST_PROXY_HOPS` only to match your trusted deployment proxy chain (default 0), so IP limits use the correct address.

API:

- `POST /api/v1/digest-subscriptions`: `{ email, fuelCode, lat, lng, radiusMeters, favoriteStationId? }`; returns HTTP 202 with a neutral message. Radius is 5000, 10000 or 15000 metres. Email is normalized; one subscription per email. Pending/unsubscribed rows are reused, with a fresh verification link. Active subscriptions are left unchanged; unsubscribe and subscribe again to change their settings.
- `POST /api/v1/digest-subscriptions/verify`: `{ token }`; consumes a valid pending token within 24 hours, returning `Votre abonnement est confirmé.`; invalid/expired links return 400.
- `POST /api/v1/digest-subscriptions/unsubscribe`: `{ token }`; immediately cancels the subscription and pending digest retries; repeated requests with the same valid token succeed. No login is required.

Migration `0003_digest.sql` adds `digest_subscriptions`, `email_deliveries`, and PostgreSQL-backed `digest_rate_limits`. Verification tokens are cryptographically random and stored only as SHA-256 hashes. Unsubscribe tokens use a separate HMAC with a random per-subscription nonce and server secret; only the hash and nonce are stored, allowing the long-lived token to be reconstructed for each email. Token values are absent from delivery payloads. Links put tokens in the URL fragment, with a no-referrer page policy.

Limits: 10 subscription requests per IP/hour, at most 3 confirmation emails per address/24-hour window, and 5 minutes between confirmation emails. Limited and existing-active requests use the same neutral response. Failed verification emails can be requested again after the cooldown; no verification token is persisted in plaintext for retries.

`DigestScheduler` checks every 5 minutes → `DigestService` selects active subscriptions due after 08:00 in Europe/Paris (including DST) → `EmailService` calls Resend. Keep the API running for scheduling; after downtime, eligible subscriptions are caught up later that day. Each pass processes at most 50 subscriptions, pacing sends. PostgreSQL advisory locks and a unique subscription/type/local-date delivery record prevent concurrent duplicate digests. Resend idempotency keys and immutable saved email payloads protect retries after ambiguous network failures. Retryable sends get at most 5 attempts; attempts older than 23 hours require manual reconciliation (`UNKNOWN`) rather than risking reuse beyond Resend's idempotency window. Inspect `email_deliveries` for statuses/errors and provider IDs. `SENT` means Resend accepted the email, not confirmed inbox delivery; webhooks are not implemented.

The digest uses only current official `station_fuels`: AVAILABLE, positive price, station seen within 24 hours, PostGIS radius, sorted by price then distance. It includes up to three matches (or an explicit empty-state message), plus the favorite even outside the radius, with official availability and freshness timestamps. Queue reports, community reports and the official importer are unchanged. Both HTML and plain-text bodies are sent; every digest includes unsubscribe.

After migration and build, run `node apps/api/digest.integration.cjs`. It uses real PostgreSQL with rollback and a recording email provider: verification/expiry, pending reuse, limits, radius/ranking, favorite, timezone boundaries, unsubscribe, and idempotent delivery retries are checked without sending real emails.
