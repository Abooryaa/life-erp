# Database

SQLite 3 (WAL mode, foreign keys on), file `<data>\db\life.sqlite`. Schema code: `apps/server/src/db/schema/*.ts`. Migrations: `apps/server/drizzle/*.sql`, applied automatically on start.

## Conventions
| Rule | Detail |
|---|---|
| IDs | `TEXT` UUIDv7: time-ordered and globally unique, portable to PostgreSQL `uuid`. |
| Timestamps | `created_at`, `updated_at` as ISO-8601 UTC text (`2026-10-02T10:00:00.000Z`). |
| Calendar dates | `TEXT 'YYYY-MM-DD'` (no time-zone drift), e.g. due dates and transaction dates. |
| Money | `INTEGER` minor units (piasters/cents) plus a `currency` column. **Never floats.** |
| Soft delete | `deleted_at` on user records. Deleted records disappear from lists and search but stay in backups. |
| Archive | `archived_at` hides a record (e.g. a business) without deleting it. |
| Polymorphic refs | `(entity_type, entity_id)` pairs, with types listed in `packages/shared/src/entities.ts`. |
| Booleans | `INTEGER 0/1`. |

## Foundation tables (Phase 0)
| Table | Purpose |
|---|---|
| `users` | Owner account: Argon2id hash, TOTP secret, hashed recovery codes. |
| `sessions` | `id` = SHA-256 of the session token, expiry, device, IP. |
| `settings` | One JSON document (`key='app'`) validated by `settingsSchema`. |
| `app_meta` | Instance flags (e.g. `demo=true` in the demo database). |
| `workspaces` | Personal + businesses: `kind`, colour, currency, profile, `sort_order`, archive. |
| `tags`, `taggings` | Global tags; `taggings(tag_id, entity_type, entity_id)`. |
| `entity_links` | Any-to-any relationships: `(from_type, from_id) → (to_type, to_id)`, `relation`, `note`. |
| `files` | Physical blobs, content-addressed (`sha256` unique → identical uploads stored once). |
| `documents` | User-facing document metadata (title, type, dates, workspace) → `file_id`. |
| `audit_log` | Who, what, when, IP, summary, JSON before/after (secrets redacted). |
| `notifications` | Severity (`critical`, `warning`, `reminder`, `info`), link, `dedupe_key` unique, read/dismissed. |
| `backups` | History of backup attempts (path, size, status, manifest summary). |
| `search_index` | FTS5 virtual table: `entity_type`, `entity_id`, `workspace_id`, `title`, `body`, `tags`. |

## Planned tables
- **Finance**: `accounts`, `categories`, `transactions` (+ `transfer_group`), `recurring_rules`, `budgets`, `budget_lines`, `installments`, `installment_payments`, `debts`, `savings_goals`, `assets`, `asset_valuations`, `fx_rates`.
- **Work**: `projects`, `milestones`, `tasks`, `task_comments`, `events`.
- **People**: `people`, `organizations`, `relationships` (role per workspace: lead/client/supplier/partner…), `interactions`, `pipelines`, `pipeline_stages`, `opportunities`.
- **Career**: `employments`, `job_applications`, `interviews`, `achievements`, `skills`, `learning_items`.
- **Goals**: `goals` (self-referencing `parent_id`, `level`: vision → long-term → objective → milestone).
- **Knowledge**: `notes`.
- **System**: `automations`, `automation_runs`, `reviews`, `scenarios`, `custom_field_defs`.

The full design is in [roadmap.md](roadmap.md).

## Migrations
1. Edit `apps/server/src/db/schema/*.ts`.
2. `npm run db:generate` creates `drizzle/NNNN_*.sql`. For SQL Drizzle can't express (FTS, triggers), use `npx drizzle-kit generate --custom --name <name>` in `apps/server`.
3. Review the SQL and commit it. It is applied on the next start (and to restored older backups).

Never edit a migration that has already shipped. Add a new one.

## Moving to PostgreSQL later
The schema uses only portable types. To move: switch the Drizzle dialect, regenerate migrations, port the FTS5 table to a `tsvector` column, and copy the data (the JSON export works as a bridge).
