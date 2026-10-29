# Visual2Code (V2Code)

> AI-powered website generation platform that turns visual references and other inputs into functional websites.

Visual2Code converts **screenshots, images, PDFs, text prompts, Figma designs, existing website URLs, and video references** into working websites. It is designed to eventually support multi-page generation, in-browser code editing, conversational modifications, project versioning, ZIP export, GitHub integration, and multiple AI providers.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [API Endpoints](#api-endpoints)
- [Database](#database)
- [Background Jobs](#background-jobs)
- [Security](#security)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Multi-input generation** — screenshots, images, PDFs, text prompts, Figma designs, URLs, and video (planned).
- **AI provider abstraction** — DeepSeek first, with OpenAI, Gemini, Claude, and others behind a unified interface.
- **Background processing** — long-running generation runs asynchronously via Redis + BullMQ.
- **Project management** — CRUD, versioning, file metadata, and collaboration (planned).
- **Production-ready backend** — validation, centralized error handling, graceful shutdown, security headers, CORS.

---

## Tech Stack

| Layer              | Technology                                             |
| ------------------ | ------------------------------------------------------ |
| Frontend           | Next.js, JavaScript, Tailwind CSS, shadcn/ui (planned) |
| Backend            | Node.js, Express.js, JavaScript                        |
| Database           | PostgreSQL (Neon) + Prisma ORM                         |
| Background jobs    | Redis (Upstash) + BullMQ                               |
| Initial AI provider| DeepSeek (behind a provider abstraction)               |
| Deployment         | Vercel (frontend), Render (backend)                    |

> **Language decision:** the project uses **JavaScript**, not TypeScript, unless explicitly approved otherwise.

---

## Architecture

```
┌─────────────┐      HTTP / JSON      ┌──────────────────────────────┐
│  Frontend   │ ────────────────────▶ │  Express API                 │
│  (Next.js)  │                      │  routes → controllers →       │
└─────────────┘                      │  services → repositories      │
                                     └──────────┬─────────┬─────────┘
                                                │         │
                                    ┌───────────▼──┐   ┌──▼──────────────────┐
                                    │  PostgreSQL  │   │  Redis + BullMQ      │
                                    │  (Prisma)    │   │  (background jobs)   │
                                    └──────────────┘   └──────────┬──────────┘
                                                                   │
                                                        ┌──────────▼──────────┐
                                                        │  Worker process     │
                                                        │  (generation jobs)  │
                                                        └─────────────────────┘
```

**Key boundaries:**

- The frontend talks only to the API — never directly to the database or AI providers.
- Business logic depends on a **provider abstraction**, not on DeepSeek directly.
- Long-running generation runs in a **separate worker process**, decoupled from the HTTP server.
- Generated code is never executed inside the API process (sandbox comes in a later phase).

---

## Project Structure

```text
Visual2Code/
├── frontend/                      # Next.js app (not yet initialized)
└── backend/
    ├── prisma/
    │   ├── schema.prisma          # Prisma data models
    │   └── migrations/            # version-controlled migrations
    ├── src/
    │   ├── app.js                 # Express app assembly
    │   ├── server.js              # HTTP server + graceful shutdown
    │   ├── worker.js              # Background job worker
    │   ├── config/
    │   │   ├── env.js             # validated environment config
    │   │   ├── cors.js            # CORS policy
    │   │   ├── prisma.js          # PrismaClient singleton
    │   │   ├── redis.js           # ioredis connection
    │   │   └── queue.js           # BullMQ queue definitions
    │   ├── controllers/
    │   ├── routes/
    │   ├── middlewares/
    │   │   ├── notFound.js        # 404 handler
    │   │   └── errorHandler.js    # centralized error handling
    │   ├── errors/
    │   │   ├── AppError.js        # base operational error
    │   │   └── NotFoundError.js   # 404-specific error
    │   ├── jobs/
    │   │   └── processors/        # job handlers
    │   └── validators/
    ├── .env.example               # documented environment placeholders
    ├── package.json
    └── Dockerfile                 # (planned)
```

> The intended module-based layout (`src/modules/{auth,projects,generation,...}`) will be introduced incrementally as each feature phase begins.

---

## Prerequisites

- **Node.js** ≥ 20 (tested on v24)
- **npm** ≥ 9
- A **PostgreSQL** database (we use [Neon](https://neon.tech) — serverless Postgres)
- A **Redis** instance (we use [Upstash](https://upstash.com) — serverless Redis)

---

## Getting Started

### 1. Clone and install

```bash
git clone <repository-url>
cd Visual2Code/backend
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in the required values (see [Environment Variables](#environment-variables)).

### 3. Set up the database

```bash
npm run prisma:generate   # generate the Prisma client
npm run prisma:migrate    # apply migrations (dev)
```

For production:

```bash
npm run prisma:deploy     # apply migrations non-interactively
```

### 4. Run the server

```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

### 5. Run the worker (separate terminal)

```bash
npm run worker
```

---

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable        | Required | Description                                           | Example                                          |
| --------------- | -------- | ----------------------------------------------------- | ------------------------------------------------ |
| `NODE_ENV`      | No       | `development` or `production`                         | `development`                                    |
| `PORT`          | No       | HTTP port for the API server                          | `3000`                                           |
| `CORS_ORIGINS`  | No       | Comma-separated allowlist of frontend origins         | `http://localhost:5173`                          |
| `DATABASE_URL`  | Yes      | PostgreSQL connection string (Neon)                   | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `REDIS_URL`     | Yes      | Redis connection string (Upstash, use `rediss://`)    | `rediss://default:pass@host:6379`                |

> **Never commit `.env`.** It is gitignored. `.env.example` contains placeholders only.

---

## Available Scripts

Run from `backend/`:

| Command                | Description                                      |
| ---------------------- | ------------------------------------------------ |
| `npm start`            | Start the API server (production)                |
| `npm run dev`          | Start the API server with auto-reload            |
| `npm run worker`       | Start the background job worker                  |
| `npm run worker:dev`   | Start the worker with auto-reload                |
| `npm run prisma:generate` | Generate the Prisma client                    |
| `npm run prisma:migrate`  | Create/apply migrations in development         |
| `npm run prisma:deploy`   | Apply migrations in production                 |
| `npm run prisma:studio`   | Open Prisma Studio (DB browser)                |

---

## API Endpoints

| Method | Endpoint       | Description                | Status   |
| ------ | -------------- | -------------------------- | -------- |
| `GET`  | `/`            | API status                 | ✅ Live  |
| `GET`  | `/api/health`  | Readiness check            | ✅ Live  |
| `*`    | `*`            | 404 (centralized handler)  | ✅ Live  |

> Auth, projects, generation, files, versions, collaboration, and GitHub endpoints will be added in subsequent phases.

---

## Database

- **ORM:** Prisma (`prisma-client-js` generator, JavaScript output).
- **Provider:** PostgreSQL.
- **Migrations:** stored in `prisma/migrations/` and version-controlled.
- **Current model:** `Project`.

Example query:

```javascript
import { prisma } from "./src/config/prisma.js";

const project = await prisma.project.create({
  data: { name: "My website" },
});
```

To explore the database visually:

```bash
npm run prisma:studio
```

---

## Background Jobs

Background processing uses **BullMQ** backed by **Redis**.

- **Queue:** `generation`
- **Worker:** runs in a separate process (`src/worker.js`)
- **Retries:** 3 attempts with exponential backoff
- **Job options:** remove-on-complete (100), remove-on-fail (500)

**Enqueue a job (example):**

```javascript
import { generationQueue } from "./src/config/queue.js";

await generationQueue.add("generate", { projectId: "abc123" });
```

**Process jobs:**

```bash
npm run worker
```

---

## Security

- **Helmet** — security HTTP headers.
- **CORS** — origin allowlist via `CORS_ORIGINS`.
- **`x-powered-by`** — disabled.
- **Payload limits** — JSON and URL-encoded bodies capped at 16 KB.
- **Centralized error handling** — hides internal details in production.
- **Secrets** — kept in `.env`, never committed.
- **Generated code** — will run in an isolated sandbox (not the API process) in a later phase.

---

## Roadmap

- [x] Express backend foundation (config, middleware, errors, graceful shutdown)
- [x] PostgreSQL + Prisma integration
- [x] Redis + BullMQ background jobs
- [ ] Frontend (Next.js) initialization
- [ ] Auth module (users, JWT, registration/login)
- [ ] Projects module
- [ ] Generation module (AI provider abstraction + DeepSeek)
- [ ] Files & versioning
- [ ] Collaboration & GitHub integration
- [ ] Sandboxed code execution

---

## Contributing

Contributions are welcome. Please:

1. Follow the existing feature-based modular structure.
2. Keep changes small and committed in logical units.
3. Use `async/await` and consistent error handling.
4. Validate all untrusted inputs on the server.
5. Never commit real credentials — update `.env.example` with placeholders instead.

---

## License

[Specify your license here.]
