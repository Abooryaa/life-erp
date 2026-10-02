# Architecture

## Overview

```
                         MY LAPTOP
   ┌──────────────────────────────────────────────────┐
   │  Node.js process (one port: 4600)                 │
   │  ┌───────────────┐   ┌─────────────────────────┐  │
   │  │ React PWA      │◄──│ Fastify HTTP server      │  │
   │  │ (static build) │   │  auth · CSRF · headers   │  │
   │  └───────────────┘   │  /api/* module routes     │  │
   │                      │  scheduler (jobs)         │  │
   │                      └──────────┬───────────────┘  │
   │                                 │ better-sqlite3    │
   │   LifeERP-Data\  db\life.sqlite (WAL) · files\ ·   │
   │                  backups\ · config\ · logs\         │
   └───────────────▲──────────────────────▲─────────────┘
                   │ localhost / LAN       │ tailscale serve (HTTPS)
                laptop browser          phone (anywhere)
```

**A modular monolith.** One process, one database file, no queues or containers. Fast to start, trivial to back up, nothing to administer.

## Technology choices

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language; shared types and validation between client and server. |
| Server | Fastify 5 | Fast, mature, built-in hooks for auth, rate limiting, multipart and static files. |
| Database | SQLite (WAL) via better-sqlite3 | Zero-admin, a single file, very fast for one user, and the best fit for local-first. Prebuilt binaries, so no compiler needed. |
| ORM | Drizzle | Typed queries, plain SQL migrations, supports PostgreSQL with near-identical schema code. |
| Search | SQLite FTS5 | Instant full-text search across all modules, with Arabic diacritics ignored. |
| Validation | Zod (in `packages/shared`) | The same rules in the UI and the API. |
| UI | React 19 + Vite, TanStack Query, React Router | A single-page app suits a private app (no SEO or SSR needed) and makes a clean PWA. |
| Styling | Tailwind CSS 4 with design tokens | A consistent design system, light/dark themes, and logical properties for RTL. |
| Charts | Apache ECharts | Real financial charts, RTL-aware (used from Phase 1). |
| PWA | vite-plugin-pwa (Workbox) | Install on the phone. The app shell is cached; private data is never cached by the service worker. |

## Repository layout

```
life-erp/
├── apps/
│   ├── server/                Fastify API
│   │   ├── src/
│   │   │   ├── app.ts         HTTP pipeline: headers, CSRF, auth, errors, routes, SPA
│   │   │   ├── index.ts       production entry (logging, lock file, graceful shutdown)
│   │   │   ├── cli.ts         backup / restore / reset-password / seed-demo …
│   │   │   ├── config.ts      env + data-folder layout
│   │   │   ├── db/            client (open/migrate/swap) + schema/*
│   │   │   ├── lib/           ids, errors, validation, audit, registry, zip, dates
│   │   │   ├── modules/       one folder per module: service.ts (logic) + routes
│   │   │   ├── jobs/          scheduler + jobs (backups, alerts, automations)
│   │   │   └── seed/          demo data (demo folder only)
│   │   ├── drizzle/           SQL migrations (generated + custom)
│   │   └── test/              API/integration tests
│   └── web/                   React PWA
│       └── src/
│           ├── components/ui/ design-system primitives
│           ├── layout/        shell, navigation, command palette, quick add
│           ├── features/      one folder per module
│           ├── i18n/          en.ts, ar.ts (compiler-checked to have every key)
│           └── lib/           api client, hooks, types, workspace context
├── packages/shared/           Zod schemas, money/currency utils, entity types
├── scripts/                   dev, start, stop, demo, icons, windows/
└── docs/
```

## Cross-cutting design ("everything is connected")
- **Workspaces**: Personal plus any number of businesses, created at runtime. Records carry an optional `workspace_id`; the workspace switcher filters every module, and "All workspaces" shows everything.
- **Entity registry** (`lib/registry.ts`): each module registers its record types with `resolve` (title/URL), `exists` and `searchDocs`. Generic features then work for every module automatically:
  - **Links**: `entity_links` connects any record to any other (a document to a transaction, a note to a client…).
  - **Tags**: `tags` + `taggings`, global across modules.
  - **Attachments**: documents linked with relation `attachment`.
  - **Search**: one FTS5 index fed by `searchDocs`.
  - **Audit log** and **notifications** reference records by `(type, id)`.
- **Money**: always integer minor units, with a currency per amount. The shared `money.ts` handles parsing (including Arabic-Indic digits), formatting and conversion.
- **Jobs**: idempotent "check the state" jobs (not "fire at time X"), so nothing is missed when the laptop was asleep. Alerts are de-duplicated by a key.

## Request pipeline
1. Helmet security headers
2. CSRF check (custom header on non-GET `/api` requests)
3. Session cookie → `req.user` (sliding expiry)
4. Auth gate (everything except a small public list)
5. Route → Zod validation → service (a transaction where needed) → audit log
6. Error handler → human-readable JSON `{ error: { code, message, fields } }`, details logged with a reference code

## Offline behaviour
- No internet: everything works on the laptop and on the home LAN.
- AI unavailable: only the assistant is affected (Phase 8).
- Phone with no connection: the installed app opens and shows a clear "cannot reach LIFE ERP" message. A queued quick-capture outbox is planned for Phase 2.

## Future growth (designed for, not built)
- **PostgreSQL**: the Drizzle schema is portable, IDs are UUIDv7, and timestamps are ISO-8601.
- **Multiple users / family**: `users.role` exists, records can gain `user_id`, and workspaces can gain members.
- **Sync / cloud**: UUID IDs and `updated_at` on every record make later sync possible.
- **Native mobile app**: the clean JSON API is already the only interface.
