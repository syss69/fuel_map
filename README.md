# TrajetIco — Pyrénées-Atlantiques et Hautes-Pyrénées

Fuel-station map for départements 64 and 65. The API imports the current government dataset for the configured departments in one request; the map opens on Pau and remains navigable across the whole area.

## Stack and layout

- `apps/web`: React, Vite, MapLibre GL JS and TanStack Query
- `apps/api`: NestJS REST API, scheduled/manual importer and health endpoints
- `packages/database`: Drizzle schema, PostgreSQL/PostGIS migration and fuel seed
- `data/station-overrides.json`: application-owned station names and brands

The importer uses the Opendatasoft v2.1 JSON export for `prix-des-carburants-en-france-flux-instantane-v2`, filtered by the configured department codes joined with OR in one request.

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

See `.env.example` for all settings. Backend configuration is validated at startup. `FUEL_IMPORT_CRON` defaults to every 15 minutes, `FUEL_DATASET_DEPARTMENTS` uses `64,65` in the example environment (legacy fallback: `FUEL_DATASET_DEPARTMENT`, then `64`), and the frontend map style defaults to OpenFreeMap Liberty.

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

### Digest weekdays
Subscriptions require `weekdays`: 1–3 distinct ISO weekday numbers (1=Monday, 7=Sunday). The form starts with no days selected. Both scheduler selection and send-time checks use the subscriber's Paris weekday; missed days are not caught up on unselected days. A maximum of three accepted morning digests per Paris calendar week (Monday–Sunday) also applies. Migration 0004 gives existing subscriptions Monday/Wednesday/Friday. Change an existing subscription in **Mes alertes → Mon digest → Modifier**, after magic-link login. Verification emails list the selected days. Run the migration before restarting the API.


## Web Push fuel alerts

Apply migration `0005_push_alerts.sql` before starting the new API. It backfills `subscribers` from existing digest subscriptions without changing email, status, schedules or unsubscribe tokens. A digest identity trigger reuses the same subscriber email for future subscriptions and verification. Digest unsubscribe changes only the digest. Shared identity does not automatically create a browser session.

New tables: `subscribers`, `subscriber_magic_links`, `subscriber_sessions`, `subscriber_rate_limits`, `push_subscriptions`, `alert_rules`, `fuel_events`, `notification_events`, `push_deliveries`. Drizzle describes the tables; the handwritten migration also contains the two PostgreSQL triggers. Do not replace these triggers with a schema-only generated migration.

Authentication uses a random 32-byte, SHA-256-hashed, single-use magic link (30 minutes) and a separate random session (90 days). Cookies are HttpOnly, SameSite=Lax, path `/api/v1/alerts`, and Secure when `NODE_ENV=production`. All writes require an allowed Origin; authenticated endpoints derive subscriber identity from the cookie. Magic-link requests are neutral and limited in PostgreSQL to 10/IP/hour, 3/email/day, with a 5-minute cooldown. Tokens use URL fragments and are cleared after login. A button confirms login to avoid consuming links through email scanners. Email links can be pasted into the installed iOS app when mail opens them in a separate browser profile.

Serve the frontend and API on the same HTTPS origin in production (proxy `/api` to Nest), set `VITE_API_BASE_URL=/api/v1`, `FRONTEND_ORIGIN` and `PUBLIC_APP_URL` to the site's HTTPS origin, and enable `NODE_ENV=production`. Different localhost ports are supported in development with credentialed CORS; do not mix `localhost` and `127.0.0.1`. A cross-site frontend/API deployment is not supported by the SameSite=Lax session. Configure trusted proxy hops accurately for IP limits. Serve `index.html` as the fallback for `/mes-alertes` and `/notifications`; serve `/sw.js` as JavaScript without immutable caching.

VAPID: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:bonjour@trajetico.space`. Generate once using `npx web-push generate-vapid-keys`; keep the private key server-side and retain the key pair across deploys. `/alerts/config` exposes only the public key, and only when all settings exist. Missing keys disable delivery, not the rest of the API. Local development keys have been generated separately; use appropriate persistent deployment secrets. No real push has been sent by automated tests.

API prefix `/api/v1/alerts`:

- `GET /config`: public VAPID key.
- `POST /login` `{ email }`: request a neutral magic-link email through the existing EmailService/Resend integration.
- `POST /verify` `{ token }`: consume the link and set the session cookie.
- `POST /logout`: revoke the current session and clear its cookie.
- `GET /me`: current email, all rules and device summaries (no endpoints or push secrets).
- `PUT /rules` `{ stationId, fuelCode, eventType, frequency, status }`: idempotent create/update for one station/fuel/event. Event is FUEL_AVAILABLE or PRICE_DROP, frequency ONCE or RECURRING, writable status ACTIVE or DISABLED. COMPLETED is set by processing. Re-enable a completed rule to arm it for future events. There is no cap on total rules/stations.
- `POST /disable-all`: disable all rules and cancel pending deliveries; retain identity, devices and digest.
- `POST /devices` `{ endpoint, keys: { p256dh, auth }, deviceLabel? }`: upsert an owned browser subscription, refresh last_seen_at. An endpoint cannot be reassigned to another subscriber. Browser-provider hosts are allowlisted to prevent server-side requests to arbitrary URLs.
- `POST /devices/:id/revoke`: revoke an owned device and cancel its pending deliveries, leaving rules and other devices intact.

The official-state UPDATE trigger emits price increase/decrease only when both prices are non-null and differ. It emits BECAME_AVAILABLE from UNKNOWN or an explicit unavailable status to AVAILABLE; initial station fuel inserts emit nothing. Apply migration `0007_unknown_fuel_available.sql` to enable UNKNOWN transitions on existing deployments. Only future transitions generate events; missed notifications are not backfilled. Updates, history and event creation share the importer's PostgreSQL transaction. No external delivery occurs in that transaction. Creating/re-enabling a rule takes the same station lock used by the importer and captures the latest fuel event id, so pre-existing queued changes cannot trigger a new rule.

Every five seconds, AlertProcessor serially handles up to 250 committed events in event-id order under a database lock. Rule changes, notification creation, device delivery fan-out and marking events processed commit together. Unique `(alert_rule_id,fuel_event_id)` prevents duplicate notifications; unique `(notification_event_id,push_subscription_id)` prevents duplicate delivery rows. ONCE completes on its first event. Recurring availability fires for each explicit return. Recurring price starts armed, fires/disarms on a drop, ignores further drops/equal/null transitions and re-arms on a price increase. Changing frequency on an active rule preserves its state.

The delivery worker is separate, checks every five seconds, sends to all active devices, and records provider acceptance as SENT (not proof of display). It uses a PostgreSQL worker lock, bounded batches, a retry lease, a one-hour delivery lifetime and at most five attempts with exponential backoff for network errors/429/5xx. 404/410 revoke the endpoint. Disabling can cancel queued work; a request already in flight cannot be recalled. Transport is at-least-once: a crash after provider acceptance but before database acknowledgement can retry; notification tags use the notification event id to coalesce duplicates on the device. No guarantee of exactly-once display is made.

The station card exposes `Créer une alerte` with independent availability and price settings for each fuel. `/mes-alertes` groups active/disabled/completed rules by station/fuel, edits frequencies, re-enables or disables rules, disables all alerts, lists devices and revokes them independently. Rule deletion is intentionally omitted to retain notification audit references. The help page `/notifications` explains desktop, Android and iOS requirements and delivery limitations. The manifest supports installation; the service worker displays pushes and opens the station/fuel URL. Permission is requested only by `Activer les notifications`. Existing permission/subscription is synchronized on authenticated page opening. iOS/iPadOS 16.4+ requires a Home Screen web app. Unsupported browsers can use the email digest. Digest emails now link to `Gérer mes alertes`.

Verification: `npm run build`, `npm run typecheck`, `npm run lint`, `node apps/api/alerts.integration.cjs`, plus existing digest/community/queue integration checks. PostgreSQL tests roll back fixtures, use fake email/push senders, and check identity, single-use expiry, session ownership/CSRF, official transitions/rollback, baselines, ONCE/recurring state, multi-device fan-out, retry/revocation and digest independence. Real OS notification display requires a user-enabled browser/device and HTTPS (or localhost); test it after deployment on each target platform.

### Price alert thresholds

Migration `0006_alert_price_threshold.sql` adds `price_threshold_milli_eur`. Active PRICE_DROP rules require a positive integer threshold (maximum 2147483647); the API field is `priceThresholdMilliEur`. Availability rules ignore this field. The station form and Mes alertes accept comma or dot and up to three decimal places, using the existing integer-safe price parser. Price must decrease strictly below the threshold: equality does not fire. A recurring rule disarms after its alert and re-arms only when a later price increase reaches or exceeds the threshold. Creating/reactivating/changing the threshold captures a new event baseline; no immediate notification is sent. Changing only frequency preserves the current armed state. Existing active PRICE_DROP rules without a threshold are disabled by the migration, and their pending deliveries cancelled; the user must explicitly set a threshold and re-enable them. There were no such rules in the local database when this migration was applied. This supersedes the original re-arm-on-any-increase behavior above.

## Station display names (2026-09-30)

Names are enriched from Chiffrex's OpenStreetMap-based reference, not government-verified business names. Source: https://www.data.gouv.fr/datasets/referentiel-des-noms-et-enseignes-de-stations-service-enrichi-par-openstreetmap (snapshot 2026-09-27, ODbL; © OpenStreetMap contributors, processing by Chiffrex). Attribution is displayed on the map. The original CSV is retained in `data/station-names-source.csv`; the initial station snapshot and per-match provenance/decisions are in `data/station-names-current.json` and `data/station-names-review.json`.

73 of 116 stations passed conservative matching: unique exact official ID, identical normalized address/city, exact postcode, non-generic name, and coordinate separation <=75m. Their names were added to `data/station-overrides.json` and applied locally only to previously unnamed rows. Brand was not inferred separately. The 43 uncertain stations were left unchanged; `data/station-names-to-confirm.md` lists their IDs, addresses and unconfirmed candidates for manual correction. Coordinates/addresses and official fuel state were not modified. Reapply the reviewed overrides on a fresh deployment with `npm run db:apply-overrides`. Manual corrections take precedence over enrichment. The matching script operates on the saved source/database snapshots, not live data.

Update: at the user's request the distance criterion is now strictly <200m, with all other matching checks unchanged. Added 18 names (91/116 total); 25 remain unconfirmed. Existing names/manual overrides were preserved. Review JSON and the manual-confirmation list were regenerated.


The device panel provides `Tester les notifications`: authenticated `POST /api/v1/alerts/devices/:id/test` sends a real Web Push only to the current owned, active device. Tests are limited to one per subscriber per 30 seconds and do not modify alert rules or create fuel events. Expired subscriptions are revoked on 404/410. Success means provider acceptance, not guaranteed OS display. Tests use a fake sender and roll back database changes.

## Frontend routes and deployment

`/` is the public landing; `/app` is the existing map and installed PWA start URL. `/mes-alertes` and `/notifications` remain unchanged. Digest links (`/?digest=verify#token`, `/?digest=unsubscribe#token`) and magic links (`/mes-alertes#token`) keep their existing behavior. Legacy `/?station=…&fuel=…` and `/?digest=open` links normalize to `/app`, preserving query and fragment. New notification clicks open `/app` directly.

The existing entry-point routing is retained without another router dependency. The map loads lazily. Do not change PUBLIC_APP_URL solely for this frontend move: existing backend-generated links remain supported.

Production hosting must return the SPA entry point for frontend routes. The checked-in apps/web/Caddyfile provides this fallback, preserves API paths, and serves the service worker without immutable caching.

### Frontend Docker image

Build from the repository root: `docker build -f apps/web/Dockerfile -t trajetico-web .`.
The image builds Vite with VITE_API_BASE_URL=/api/v1 and serves the output with Caddy. API requests go to api:3000; both containers must share a Docker network and the backend must have the name/alias api.

Local default: HTTP on port 80. Example: `docker run --rm -p 8080:80 trajetico-web` (API calls require the shared network described above).

Production: pass SITE_ADDRESS=trajetico.space (replace with your hostname, without http://), point the domain DNS to the VPS and publish ports 80:80 and 443:443. Optionally publish 443:443/udp for HTTP/3. Caddy obtains and renews HTTPS certificates automatically. Persist named volumes at /data (certificates and keys) and /config. Set API FRONTEND_ORIGIN and PUBLIC_APP_URL to the public HTTPS origin; configure TRUST_PROXY_HOPS=1 when Caddy is the only proxy and API is accessible only on the private Docker network. Do not pass the API secrets to the web container. Local HTTP does not trigger public certificate issuance.

### Manage a digest on the website

After existing magic-link login, `/mes-alertes` displays **Mon digest**. Edit opens `/app?digest=edit` with the saved area, radius, favorite station and weekdays. Saving returns to the summary; cancelling discards the draft. Without a session the editor redirects to login. Email is read-only. A missing subscription links to the existing public creation form.

Cookie-authenticated endpoints (the session cookie is scoped to `/api/v1/alerts`):

- `GET /api/v1/alerts/digest`: subscription or JSON `null`. Fields: `status, fuelCode, lat, lng, radiusMeters, favoriteStationId, weekdays, favoriteStation`. Favorite summary contains `id, displayName, address, city, lat, lng`, or null. No tokens or delivery history.
- `PUT /api/v1/alerts/digest`: full replacement of `{ fuelCode, lat, lng, radiusMeters, favoriteStationId, weekdays }`. Favorite UUID or explicit null; radius 5000/10000/15000; 1–3 distinct ISO weekdays. Returns the updated subscription.
- `PUT /api/v1/alerts/digest/status`: `{ status: "ACTIVE" | "UNSUBSCRIBED" }`. Explicit activation also confirms a pending subscription and invalidates its verification token. Returns the updated subscription.

Owner comes only from the session. Writes require an allowed Origin. Missing/expired session: 401; missing subscription on write: 404; invalid settings/favorite: 400; invalid Origin: 403. Editing settings preserves status, ID, verification state, unsubscribe links, last sent time and delivery history. Disabling cancels pending/retry morning deliveries; reactivation never revives cancelled deliveries.

Management, delivery, email verification/unsubscribe and public resubscription use the same per-subscription advisory lock. Settings do not send email immediately or reset daily/weekly quotas. After 08:00 Paris, selecting today can make a new digest eligible at the next scheduled check. Already prepared retry payloads remain unchanged; new settings apply to newly prepared editions.

Checks: build first, then `node apps/api/digest.integration.cjs`, `node apps/api/digest-management.integration.cjs`, and `node apps/api/alerts.integration.cjs`. Tests use PostgreSQL with rollback and fake providers. The management test exercises actual Nest HTTP routes and contention with a separate PostgreSQL connection. `node apps/api/alerts.preview.cjs` provides a local authenticated UI preview with rollback (Enter to stop), never production authentication or external sends.

Deploy by rebuilding API and web. No new migration or database preparation is needed for this milestone.

### Landing search visibility

The web build prerenders the shared React landing into dist/index.html, with title, description, canonical URL and WebSite JSON-LD. The public origin is https://trajetico.com in apps/web/src/seo.ts. Landing content is readable without JavaScript. No live prices, review ratings or nationwide coverage are claimed.

Caddy serves the homepage at /; other client routes fall back to app-shell.html, without landing content/schema. Private alert pages and digest action URLs receive noindex headers. Public routes set their own canonical and metadata at startup. The build generates robots.txt and a sitemap containing the landing. Run npm run test:seo --workspace=@fuel-map/web after building.

Deploy by rebuilding web, including its Caddyfile. No API/DB changes. In Google Search Console verify domain ownership, submit https://trajetico.com/sitemap.xml, and inspect/request indexing of the homepage. Search engines determine indexing and rankings; neither is guaranteed by these changes.


## Administration and station name corrections

Open /admin directly (not linked in public navigation). This page uses a separate admin session and is excluded from indexing; subscriber magic-link sessions are unchanged.

### Setup / deployment

1. Back up PostgreSQL. Apply migration 0008 with npm run db:migrate (or the existing Docker migration command).
2. Run npm run admin:password in an interactive terminal. The hidden prompt accepts 12–256 characters and prints only the scrypt hash assignment. Keep the single quotes around the hash in .env so Docker Compose preserves dollar signs.
3. Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH on the API only. Leaving either empty disables admin login. Never put these variables in VITE_* or commit the real .env.
4. Rebuild/restart API and web. Visit /admin and sign in. When deploying behind Caddy, configure the existing TRUST_PROXY_HOPS correctly so rate limits identify the client; the API should remain inaccessible directly from the Internet.

Admin sessions last eight hours, do not slide, and use HttpOnly/SameSite=Strict cookies (Secure in production), scoped to /api/v1/admin. Only token hashes are stored. Restarting with a different username or password hash invalidates previous sessions. Login is limited to 5 attempts per IP per 15 minutes, stored in PostgreSQL. All writes require an allowed Origin. No scheduler or email/push delivery is started by this feature.

### API

All request bodies are strict JSON. UUID path parameters are validated. Admin responses are private/no-store.

- POST /api/v1/admin/login: {username,password}; sets the admin cookie, returns {ok:true}.
- GET /api/v1/admin/session: {username,role:"ADMIN"}.
- POST /api/v1/admin/logout: revokes the current session and clears its cookie.
- POST /api/v1/stations/:id/name-suggestions: {reporterId,name,comment?}; name trimmed, 2–120 characters, comment trimmed up to 1000. Returns {ok:true}; does not change the published name. Station must be in one of the configured departments and seen within 24 hours. Limit: 5 attempts/hour per reporter and 20/hour per IP (fixed windows). One pending proposal per station/reporter; duplicate returns 409. Reporter IDs confer no access and are never returned in admin list responses.
- GET /api/v1/admin/name-suggestions?status=PENDING&page=1: status PENDING/APPROVED/REJECTED; returns {items,hasMore}, 25 per page. Items include station_id, current display_name, original_name, proposed_name, comment, address, city, official_id and review fields. No reporter ID.
- PUT /api/v1/admin/name-suggestions/:id: {decision:"APPROVED",name,expectedName,reason?} or {decision:"REJECTED",expectedName,reason?}. expectedName is the nullable raw display_name from the admin list. reason is up to 1000 characters. Returns {ok:true}.
- GET /api/v1/admin/stations?q=...&page=1: searches name/address/city/official ID, including stale stations. Returns {items,hasMore}, 25 per page, with id, official_id, display_name, address, city, last_seen_at, name_managed_by_admin.
- PUT /api/v1/admin/stations/:id/name: {name,expectedName}; publishes a direct correction, returns {ok:true}.
- GET /api/v1/admin/stations/:id/history?page=1: {items,hasMore}, 25 per page; old_name, new_name, admin_username, suggestion_id (null for direct edits), created_at.

Invalid input: 400; missing/expired session: 401; bad Origin: 403; missing station/proposal: 404; duplicate pending proposal, stale expectedName or reviewed proposal: 409; rate limit: 429. Proposal approval and direct changes lock the station, publish its name and append audit history in one transaction. A 409 requires refreshing before deciding again. Other pending proposals are not automatically closed.

Published names live in stations.display_name. Administrative changes set name_managed_by_admin: the official importer already preserves names, and db:apply-overrides now preserves these administrative names while continuing to update brand. No JSON files are written by the application. New reads and newly generated emails use the published name; previously saved email content is unchanged. Backups must include suggestions, name history and the stations table. Proposals/history have no TTL or automatic cleanup.

### Verification

Run npm run build, npm run typecheck, npm run lint, then npm run test:admin against a migrated PostgreSQL database containing at least one imported station. The suite uses real SQL and HTTP, rolls back all fixture writes and uses no email/push sender. It covers password checks, sessions, logout/expiry/credential changes, cookie flags, Origin, protected routes, rate limits, moderation, stale changes, row-lock contention, history, override precedence, and fuel/queue isolation.

For a disposable browser preview, run node apps/api/admin.preview.cjs after building. It binds only to 127.0.0.1, creates an isolated test station and temporary admin credentials, starts no schedulers, and rolls back when you press Enter. Do not deploy this preview script as the API entrypoint.


## Coverage 64 + 65 and map layers (2026-10-16)

Set API FUEL_DATASET_DEPARTMENTS=64,65. This comma-separated, validated, deduplicated list takes precedence over FUEL_DATASET_DEPARTMENT; if neither is set, coverage defaults to 64. An explicitly empty/invalid list is rejected. Both departments are fetched with one OR-filtered official export request. Import locking, transactions, IDs, fuel events and schedules are unchanged. Public station list/details, queues, community contributions and name suggestions use the same list and 24-hour freshness rule. API response shapes are unchanged. Digest radius searches include either side of the department boundary.

Station points now use one MapLibre GeoJSON source and four layers (clusters, counts, points, selected outline). Clustering radius is 45 pixels through zoom 12. Fuel filtering happens before clustering. Availability colors retain their meaning; clusters are neutral. The expandable Stations dans cette zone list exposes the current filtered viewport in pages of 20 and also supports favorite selection. Collapsed lists mount no station entries. Digest zone and its single marker are preserved.

The default camera remains Pau at zoom 11. Me localiser requests a single position only on click, fits the reported accuracy with maximum zoom 13, and cancels camera updates when the user moves the map before the result arrives. Errors retain the view. Location is not persisted or sent to our API; requested map tiles are still fetched from the map provider. Deep links and digest editing keep their existing camera behavior.

### Names for 65

The retained Chiffrex/OSM reference snapshot is 2026-09-27 (ODbL; attribution remains on the map). data/station-names-current-65.json records 50 official stations fetched on 2026-10-16 from the existing government export. Exactly 39 pass all checks: unique official ID, identical nonempty normalized address/city, postcode, valid coordinates, non-generic name and distance <=200 metres (inclusive). Eleven are skipped for distance; see data/station-names-review-65.json and data/station-names-to-confirm-65.md. They remain Station-service unless already named manually. Existing 64 overrides and manual names are preserved; administrative names always take precedence at application time.

Reproduce the prepared report without touching the database:

    node data/review-station-names.cjs --department=65 --stations=data/station-names-current-65.json

For a later refresh after importing new stations, omit --stations to read the database; --merge adds accepted, previously unnamed IDs to the overrides file. Review the generated files before deploying:

    node data/review-station-names.cjs --department=65 --merge

This enrichment command does not change database names. Apply the reviewed overrides separately. New stations absent from overrides remain unnamed. Do not clear names merely because a future matching run rejects a candidate.

### Deployment

Back up PostgreSQL first. No migration or Docker topology change is needed. Set FUEL_DATASET_DEPARTMENTS=64,65 in the API environment, then rebuild/restart API and web. The API image includes the prepared overrides JSON for the compiled CLI:

    docker compose up -d --build api web
    docker compose exec -w /app/apps/api api node dist/cli/import-fuels.js
    docker compose exec -w /app/apps/api api node dist/cli/apply-overrides.js
    docker compose exec -T postgres psql -U postgres -d fuel_map -c "SELECT department_code, count(*) AS total, count(*) FILTER (WHERE last_seen_at >= now() - interval '24 hours') AS fresh FROM stations WHERE department_code IN ('64','65') GROUP BY department_code ORDER BY department_code;"

The import CLI retains existing application workers; running it on production is a real import and can generate real fuel events/deliveries. The automatic initial/scheduled import may already have imported 65 before the manual command, which is idempotent. Override application preserves admin names and existing brand handling. Names/history live in PostgreSQL and belong in its backups.

### Verification

Run build, typecheck, lint, test:seo, test:coverage, test:map and test:names. Existing queue/community/admin/alerts/digest/digest-management integration suites also apply. PostgreSQL suites roll back fixtures and use fake senders without schedulers. No live imports or outbound deliveries are needed for tests.

For browser checks, node apps/web/map.preview.cjs starts an isolated read-only fixture API on 127.0.0.1:3104 and web on 127.0.0.1:5176 (Enter to stop). /app uses the 166 saved stations; /checks/map.html simulates geolocation and compares old HTML markers with layers on identical data. /checks/mobile.html provides a 390 × 844 iframe for responsive checks. Fixture prices and statuses are synthetic; these helpers are development-only and are not included in the production web build.

Browser verification on the 166-station fixture (2026-10-16): HTML station markers 166 → 0; total harness DOM elements 212 → 46. Both runs measured median frame interval 4 ms and p95 5 ms on this machine; this demonstrates DOM reduction, not a promised FPS improvement. Checked clustered clicks, filtered card dismissal, 65 deep link, mobile filters/list/card close, digest area/favorite picking, precise/imprecise/outside-coverage location, refusal, timeout and late-answer cancellation. Location cases use simulated coordinates, not the operator’s actual location.
