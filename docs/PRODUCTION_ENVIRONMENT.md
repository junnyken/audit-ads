# Production environment

**Purpose.** Every value a deployment of AdsOps Control Center needs, what each one does, and
which ones must never be written down in this repository.

**Scope.** Configuration and topology only. The step-by-step procedures live in the runbooks.

> Nothing in this file is a real secret, and nothing in it may ever become one. Placeholders
> stay placeholders.

## 1. Topology

Two supported shapes. Pick one at deploy time; the compose files support both.

### (1) Managed platform — Coolify or Vibe Host (recommended here)

```
Internet ──HTTPS 443──► platform proxy (TLS, certificates, routing)
                              │
                              ▼
                        web  (nginx, static React build)
                              │ /api, /health  ──►  api (FastAPI, uvicorn, 1 worker)
                                                      │
                                     dispatcher ──────┼──► db (PostgreSQL 16, private)
                                     (bounded loop)   │
                                                      ▼
                                              persistent volume
```

The platform terminates TLS. Our stack exposes only `web`, bound to loopback, and the platform
proxy reaches it. Do **not** enable the `edge` profile here: two TLS terminators is one more
thing to keep patched, for no benefit.

### (2) Self-managed VPS

Identical, plus the `edge` service (`--profile edge`): nginx terminating TLS on 80/443 with
certificates mounted read-only from `TLS_CERT_DIR`.

### What is never exposed

| Component | Exposure |
|---|---|
| PostgreSQL | Private compose network only. `ports: !override []` in the production overlay |
| API | `expose: 8000` on the internal network. No host port |
| Dispatcher | No port at all. It makes outbound calls; nothing calls it |
| `web` | `${WEB_BIND:-127.0.0.1}:${WEB_PORT:-8080}` — loopback unless deliberately changed |
| `/docs`, `/redoc`, `/openapi.json` | Off in production (`ENABLE_API_DOCS=false`) |

## 2. Configuration

Names and descriptions only. Real values live in a file outside git — see §3.

### Application

| Variable | Required | Default | Notes |
|---|---|---|---|
| `ENVIRONMENT` | yes | `development` | `production` or `staging` turns on strict validation |
| `ENVIRONMENT_LABEL` | no | falls back to `ENVIRONMENT` | Human label; appears in the test message |
| `RELEASE_VERSION` | yes in production | `unknown` | The deployed commit/image tag |
| `LOG_LEVEL` | no | `INFO` | |
| `ENABLE_API_DOCS` | no | `true` | **Set `false` in production** |
| `CORS_ORIGINS` | yes | `http://localhost:5173` | Comma-separated exact origins. A wildcard is refused in production |
| `PUBLIC_APP_URL` | yes in production | empty | Public HTTPS origin. Must be HTTPS or deep links are dropped |

### Database

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql+psycopg://user:password@db:5432/adsops` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | yes if self-hosted | Compose builds `DATABASE_URL` from these |

### Authentication

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | yes | ≥32 characters, not a placeholder. `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | no | Default 720 |
| `BOOTSTRAP_OWNER_EMAIL` / `BOOTSTRAP_OWNER_PASSWORD` | first run only | See §4. **Never `pilot-local-password`** |

### Notification delivery

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NOTIFICATION_TRANSPORT` | no | `disabled` | `disabled` / `fake` / `telegram` |
| `TELEGRAM_BOT_TOKEN` | only for real delivery | empty | **Server-side only.** Never in the database, an API response, an audit row, a log line or the frontend bundle |
| `TELEGRAM_API_BASE_URL` | no | `https://api.telegram.org` | |
| `NOTIFICATION_DISPATCH_BATCH_SIZE` | no | `10` | |
| `DISPATCHER_INTERVAL_SECONDS` | no | `60` | Raise to 120–300 if the host is loaded |
| `DISPATCHER_RECOVERY_EVERY_N_PASSES` | no | `10` | |
| `RUN_DISPATCHER_IN_API` | Vibe Host only | unset | Exactly `true` starts the dispatcher beside uvicorn in the API container (`backend/start.sh`). Vibe Host has no separate dispatcher container: a project cannot override the start command, and a second project cannot read the stack's database secrets. Leave unset wherever `docker-compose.production.yml`'s `dispatcher` service runs, or every pass runs twice |
| `SPEND_SWEEP_EVERY_N_PASSES` | no | `0` (off) | S1. With a 60 s interval, `60` means one spend pass an hour. Turning it on in production is a separate, named approval (rule 22) |
| `SPEND_OBSERVATION_STALE_AFTER_HOURS` | no | `26` | S1. An account is read again only once its last read is older than this. Set `2` with an hourly pass so every account is read about once an hour. **S2 (decided 2026-10-27): production uses `2`**, which bounds how late a newly disabled account is seen to about 3 hours; the code default stays 26 (≈ 27 h) |
| `DISCOVERY_SWEEP_EVERY_N_PASSES` | no | `0` (off) | O3. How often (in dispatch passes) the discovery sweep runs for connections whose owner switched them to automatic. Each connection is read at most once per `DISCOVERY_STALE_AFTER_HOURS`, so `60` (hourly pass, 60 s interval) still reads each automatic connection about once a day. Turning it on in production is a separate, named approval (rule 22) — not given. `--discovery-sweep` runs one pass by hand |
| `DISCOVERY_SWEEP_BATCH` | no | `5` | O3. Connections per workspace per pass; about six GETs each |
| `DISCOVERY_STALE_AFTER_HOURS` | no | `24` | O3. Per-connection cadence of the sweep, the discovery freshness badge, and the window of `account_not_returned_by_latest_discovery` — one value, so they agree |
| `AUTO_IMPORT_TELEGRAM_GRACE_HOURS` | no | `24` | O3. A `warning` delivery of an account the sweep imported within this window is skipped with `auto_import_grace` (the pass's summary already said it). Never applies to `critical`. `0` turns the grace off |
| `META_ACCESS_TOKEN` / `META_BUSINESS_ID` | for any Meta read | empty | **Server-side only** (rule 40). Without them every account is `not_observable`, the spend sweep reads nothing, and every automatic connection is `not_configured` for the discovery sweep. The dispatcher process needs them too — `docker-compose.production.yml`'s `dispatcher` service does not pass them (nor the `SPEND_*`/`DISCOVERY_*` settings) yet |
| `META_APP_ID` | for Facebook Login (O4) | empty | O4. Not a secret. With the next three, enables *Connect a Facebook account*; any missing → the button is disabled with `not_configured` |
| `META_APP_SECRET` | for Facebook Login (O4) | empty | O4. **Secret, server-side only** (rule 18's terms): the code exchange's `client_secret` and half of the app token `debug_token` needs. Never in the database, a response, an audit row, a log line or the bundle. A known placeholder is an `error` finding |
| `META_LOGIN_CONFIG_ID` | for Facebook Login (O4) | empty | O4. The Login for Business configuration id — **System User token, `ads_read` + `business_management` only** (§14 13.3). A credential carrying `ads_management` is refused at the callback |
| `META_OAUTH_REDIRECT_URI` | for Facebook Login (O4) | empty | O4. `https://<api host>/api/v1/meta-reader-credentials/callback`, registered on the app exactly so. Not https in production → `error` finding |
| `META_LOGIN_CONFIG_KIND` | no | `system_user` | O4. `system_user` \| `user`; only tells the form whether a Business Manager id is required. The callback trusts `debug_token.type` |
| `CREDENTIAL_VAULT_KEY` | for Facebook Login (O4) | empty | O4. **Secret.** Fernet key for the credential vault. Missing/invalid → nothing can be stored and stored credentials cannot be read (never plaintext). **Changing it makes every stored credential unreadable** — each must be reconnected; there is no rotation. The api **and** the dispatcher need the same value |
| `CREDENTIAL_CHECK_EVERY_N_PASSES` | no | `0` (off) | O4. How often the dispatcher asks Meta (`debug_token`, ≤ 3 GETs per credential) whether each vault credential is alive. Turning it on in production is a separate, named approval (rule 22) — not given. `--credential-check` runs one pass by hand |
| `CREDENTIAL_CHECK_BATCH` / `CREDENTIAL_EXPIRY_WARNING_DAYS` / `CREDENTIAL_RENEW_BEFORE_DAYS` | no | `10` / `14` / `20` | O4. Credentials per workspace per pass; `warning` alert window before expiry; window in which a `user` token's renewal is *tried* (counted, never assumed) |
| `ALLOW_TEST_SEND` | no | `false` | Armed for one approved verification, then turned off again |

The recipient chat is **not** an environment variable: it is owner-managed per workspace in
Settings, and is stored masked in every response.

### Deployment-time

| Variable | Required | Notes |
|---|---|---|
| `IMAGE_TAG` | yes | Explicit, immutable. Compose refuses to start without it. Never `latest` |
| `IMAGE_REGISTRY` | no | Defaults to `adsops` |
| `WEB_BIND` / `WEB_PORT` | no | `127.0.0.1` / `8080` |
| `TLS_CERT_DIR` | `edge` profile only | Directory holding `fullchain.pem` and `privkey.pem` |

## 3. Secret handling

1. Production values live in a file **outside the repository**, e.g. `/etc/adsops/production.env`,
   owned by the deploy user with mode `0600`.
2. Compose reads it explicitly: `docker compose --env-file /etc/adsops/production.env …`.
   On a managed platform, use that platform's secret store instead of a file.
3. `.env.example` carries names and descriptions only. A test asserts it holds no
   token-shaped value and that `TELEGRAM_BOT_TOKEN` is empty.
4. Secrets are supplied at runtime. Nothing is baked into an image layer.
5. Never paste a secret into a shell command — it lands in shell history. The scripts read
   the env file and export `PGPASSWORD` for the child process only.
6. `GET /api/v1/operations/configuration` reports whether a secret is set, long enough and not
   a known placeholder. It never returns the value, and neither does any log line.
7. **What the database may hold (O4).** No secret ever enters the database in plaintext. Since O4
   exactly one column holds a credential: `meta_reader_credentials.encrypted_secret`, Fernet
   ciphertext of a Meta reader credential obtained through the product's own Facebook Login flow.
   Its key (`CREDENTIAL_VAULT_KEY`) is server configuration; a database dump alone does not yield a
   token. Back up the key separately from database backups, and never in the same place.

## 4. First owner, and retiring the pilot credential

`pilot-local-password` appears in this repository's `TEST_LOG.md`. It is a local pilot
credential and must never exist in a deployment. Production configuration containing it is
rejected at startup, in every environment.

Choose one bootstrap method:

- **Environment bootstrap (simplest).** Set `BOOTSTRAP_OWNER_EMAIL` and a strong, unique
  `BOOTSTRAP_OWNER_PASSWORD` for the *first* start only. The owner is created once, when the
  database has no workspace. Remove both values afterwards and change the password in the app.
- **Manual creation on the host.** Leave both unset and create the owner with a one-off command
  against the database, so no credential ever appears in the environment file.

Emergency owner access: connect to the database from the host and update the owner's
`password_hash` with a freshly generated hash. The procedure is in
`RUNBOOK_INCIDENT_RESPONSE.md`. No recovery credential is stored in this repository.

## 5. Resource budget

Sized for a 4 vCPU / 8 GB host that is already carrying other work.

| Service | CPU limit | Memory limit | Notes |
|---|---|---|---|
| `db` | 1.0 | 1 GB | `shared_buffers=256MB`, `max_connections=50` |
| `api` | 1.0 | 512 MB | One uvicorn worker |
| `dispatcher` | 0.5 | 256 MB | One pass at a time, batch 10, sleeps between passes |
| `web` | 0.25 | 128 MB | Static files |
| `edge` | 0.5 | 128 MB | Only with the `edge` profile |

Total ceiling ≈ 2 GB memory. These are **starting points**: re-check against the real host
before treating them as final. No browser, no queue, no monitoring agent.

Log rotation is set per service (`max-size: 10m`, `max-file: 5` ≈ 50 MB per container ceiling).

## 6. Thresholds

Defaults in `app/services/operations.py`, shown on the System Status page.

| Signal | Warning | Critical |
|---|---|---|
| CPU (1-minute load ÷ cores) | 80% | 95% |
| Memory used | 75% | 85% |
| Disk used | 75% | 85% |
| Dispatcher | no recorded run for 15 minutes → `stale` | never run → `never` |
| Backup | no successful backup in 26 hours → `stale` | never → `never` |
| Oldest due delivery | older than 15 minutes while the dispatcher is enabled | |

These are **operational-system** signals. They are not account health, not readiness, and they
never travel to Telegram: infrastructure alerting stays on the status page unless a future
MINI-SPEC extends the alert model to a second source type.
