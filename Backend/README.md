# Visual2Code backend

## Redis and BullMQ

PostgreSQL is the durable source of truth for generation jobs. `GenerationJob`
records retain status, progress, input metadata, results, errors, and timestamps.
Redis is only BullMQ's delivery, retry, delay, priority, and transient job-state
store; completed/failed Redis jobs are pruned by the configured retention policy.

The API owns a lazily created generation `Queue` and one shared ioredis
connection. Each independently deployed worker owns its own Redis connection
and BullMQ worker, so worker replicas can scale without running inside the HTTP
process. BullMQ uses exponential retries, bounded attempts, concurrency limits,
and stalled-job recovery. API and worker processes close their queue/worker,
Redis, and Prisma resources during SIGINT/SIGTERM shutdown.

Workers also periodically reconcile queued/retrying PostgreSQL records with
Redis. BullMQ job IDs make queue insertion idempotent, allowing interrupted
database/Redis submissions to recover without creating duplicate jobs.

The current processor is intentionally a mock. It persists observable progress
and returns a small mock result; replace its generation operation when the AI
integration is ready. Do not put API keys or other credentials in prompts or
metadata.

## Configuration

Use `.env.example` as a template for the variables below. If `.env` does not
exist, copy the template; otherwise merge the missing variables into the
existing file without overwriting its database settings. Runtime database
queries use `DATABASE_URL` (Neon pooled endpoint); Prisma migrations use
`DATABASE_URL_UNPOOLED` (direct endpoint). `DATABASE_URL_UNPOOLED_SHADOW` is
optional for `prisma migrate dev`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `REDIS_URL` | required | `redis://` for local Redis or `rediss://` for TLS/cloud Redis |
| `REDIS_KEY_PREFIX` | `v2c` | Namespace for BullMQ keys |
| `GENERATION_QUEUE_NAME` | `generation` | Dedicated queue name |
| `REDIS_CONNECT_TIMEOUT_MS` | `10000` | Redis startup connection timeout |
| `QUEUE_OPERATION_TIMEOUT_MS` | `10000` | Bound Redis queue operations made by the API and recovery process |
| `WORKER_CONCURRENCY` | `4` | Parallel jobs per worker process |
| `WORKER_LOCK_DURATION_MS` | `30000` | BullMQ job lock duration |
| `WORKER_STALLED_INTERVAL_MS` | `30000` | Stalled job check interval |
| `WORKER_MAX_STALLED_COUNT` | `1` | Stall recoveries before a job fails |
| `JOB_MAX_ATTEMPTS` | `3` | Maximum attempts per job |
| `JOB_BACKOFF_DELAY_MS` | `2000` | Initial exponential retry delay |
| `JOB_DEFAULT_PRIORITY` | `10` | Default BullMQ priority (smaller number runs sooner) |
| `JOB_REMOVE_ON_COMPLETE_COUNT` | `500` | Completed BullMQ jobs retained |
| `JOB_REMOVE_ON_COMPLETE_AGE_SECONDS` | `86400` | Completed job retention age |
| `JOB_REMOVE_ON_FAIL_COUNT` | `1000` | Failed BullMQ jobs retained |
| `JOB_REMOVE_ON_FAIL_AGE_SECONDS` | `604800` | Failed job retention age |
| `JOB_MAX_INPUT_BYTES` | `16384` | Maximum serialized job request size |
| `MOCK_GENERATION_DELAY_MS` | `250` | Pause per mock processing step |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Graceful shutdown deadline |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, or `debug` |

Redis URLs must not be logged or committed. Use TLS (`rediss://`) for cloud
Redis. Connection logging strips URL credentials and query parameters.
When `NODE_ENV` is unset or `development`, the default URL is
`redis://127.0.0.1:6379/0`; all other environments must set `REDIS_URL`
explicitly.

### Fix: `REDIS_URL is required`

For local development, add this line to `Backend/.env` (do not replace your
existing database variables):

```dotenv
REDIS_URL=redis://127.0.0.1:6379/0
```

Start the local Redis service, confirm it responds to `redis-cli ping` with
`PONG`, then restart the API/worker so dotenv reloads the setting. The `.env`
file must be in the `Backend/` working directory. If Redis is listening on a
different host or port, use that Redis URL instead. Do not use this unauthenticated
local URL for a remote or publicly accessible Redis service.

## Local setup and commands

Install dependencies from `Backend/`, run Redis 7 locally (for example
`redis-server`), and configure a dedicated PostgreSQL database. To keep test
credentials and targets separate from an existing `.env`, create an ignored
`.env.test` file by copying `.env.example`; set its database URLs to a fresh
test database, and use a test-only Redis key prefix and queue name:

```dotenv
REDIS_URL=redis://127.0.0.1:6379/0
REDIS_KEY_PREFIX=v2c-integration-test
GENERATION_QUEUE_NAME=generation-integration-test
DATABASE_URL=postgresql://.../visual2code_test
DATABASE_URL_UNPOOLED=postgresql://.../visual2code_test
```

Do not use the existing Neon database until its migration history has been
restored and reconciled. Apply migrations to the dedicated test database first:

```sh
cd Backend
npm ci
node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy
node --env-file=.env.test node_modules/prisma/build/index.js generate
node --env-file=.env.test src/server.js
```

The migration history begins with the existing `User` table so a fresh database
can be built with `migrate deploy`. If an existing database already has the
`User` table created outside Prisma Migrate, verify its schema matches the
initial migration and baseline it first:

```sh
npx prisma migrate resolve --applied 20261125000000_init
npx prisma migrate deploy
```

Do not baseline a database until confirming that its `User` table matches the
migration; Prisma Migrate does not infer a baseline from the live schema.
If `prisma migrate status` reports applied migrations that are missing from this
checkout, stop and restore those exact migration files before attempting any
migration command. Do not mark the new baseline as applied to bypass a
mismatched migration history.

In another terminal, run one or more independently scalable workers:

```sh
cd Backend
node --env-file=.env.test src/workers/index.js
```

For normal development, use `npm run dev` for the API and
`npm run dev:worker` for a worker. Multiple worker processes may run against
the same Redis and database.

## Job API

All responses use `{ "data": ... }` on success and `{ "error": "..." }` on
failure. No authentication middleware exists in this project. These endpoints
therefore do not provide ownership checks and must not be exposed publicly
until an authentication/authorization layer is added. `userId` is never
accepted from request input; the persisted user relation is nullable for future
integration.

Create a job (`202` for a new job, `200` when the `Idempotency-Key` already
exists):

```sh
curl -X POST http://localhost:3000/jobs/generation \
  -H 'content-type: application/json' \
  -H 'idempotency-key: request-unique-id' \
  -d '{"prompt":"Generate a sample design","metadata":{"style":"minimal"},"priority":5}'
```

`prompt` is required. Optional request fields are `metadata` (JSON object),
`priority` (positive integer; lower values have higher priority), and `delayMs`
(0 to 604800000). Unknown fields, credential-like metadata keys, oversized
bodies, invalid IDs, and invalid idempotency keys are rejected.

Use the returned job ID with:

```text
GET    /jobs/generation/:id           Status and persisted progress
GET    /jobs/generation/:id/progress  Progress snapshot
GET    /jobs/generation/:id/result    Result (409 until completed)
DELETE /jobs/generation/:id           Cancel waiting/delayed jobs only
```

Unknown jobs return `404`; invalid job IDs return `400`; jobs that are already
active or terminal cannot be cancelled. Failed jobs expose a redacted error
message; internal failures return a generic `500` response.

## Tests and verification

Run unit tests:

```sh
cd Backend
npm test
```

Integration tests use real Redis, BullMQ, and PostgreSQL. They require Redis
available at the `.env.test` URL and a dedicated test database with migrations
applied; they are skipped unless explicitly enabled:

```sh
cd Backend
RUN_INFRASTRUCTURE_INTEGRATION_TESTS=1 node --env-file=.env.test --test
```

The integration suite creates and deletes its own job records and uses the
configured queue. Keep `.env.test` isolated from production, and retain the
test-only queue name/prefix so tests cannot consume application jobs.

## Troubleshooting

- **Redis connection errors at startup:** verify `REDIS_URL`, DNS/firewall
  access, TLS requirements, and Redis availability. Credentials are excluded
  from logs.
- **Database startup or migration errors:** use the pooled URL for runtime and
  the direct/unpooled URL for migrations. Apply `prisma migrate deploy` before
  running workers.
- **Jobs remain queued:** ensure at least one worker is running with matching
  `REDIS_KEY_PREFIX` and `GENERATION_QUEUE_NAME`, and check the worker logs.
- **Retries exhausted:** inspect persisted job status/error and adjust
  `JOB_MAX_ATTEMPTS` or `JOB_BACKOFF_DELAY_MS` for the workload.
- **Shutdown timeout:** check active processing/database requests; increase
  `SHUTDOWN_TIMEOUT_MS` only when longer graceful completion is intended.
