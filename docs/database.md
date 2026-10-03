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

## Finance tables (Phase 1)
| Table | Purpose |
|---|---|
| `accounts` | Where money lives. `opening_balance` (minor units) + `currency`; balance = opening + Σ live transactions (never stored). |
| `account_interest` | Interest terms of an account: daily/monthly, method (daily balance / lowest balance), credit day, income category, start date, `accrued_through` (last day credited). |
| `interest_rates` | Yearly rate history per account (`effective_from`, `annual_rate` %). |
| `transactions.interest_through` | Set on interest the system credited: the last day it covers (used for totals and recalculation). |
| `categories` | Income/expense tree (one level of subcategories), `name` + `name_ar`. |
| `transactions` | `amount` = **signed effect on the account** in its own minor units. `type` ∈ income, expense, transfer, refund, adjustment. A transfer = two rows sharing `transfer_group`. Optional links to `recurring_id`, `installment_payment_id`, `debt_payment_id`. |
| `currencies` | Extra currencies beyond the built-in list (code, minor-unit digits). |
| `fx_rates` | `1 currency = rate base` valid from `date`. Lookups: direct → inverse → via a common base. |
| `recurring_rules` | Schedule (frequency, interval, start/end, `next_due`), `auto_post`, reminder days. |
| `installments`, `installment_payments` | Plan + generated schedule rows (`paid_date`, `paid_amount`, `transaction_id`). |
| `debts`, `debt_payments` | `i_owe` / `owed_to_me`, principal, repayments (optional matching adjustment transaction). |
| `budgets`, `budget_lines` | Monthly limits per expense category in the base currency, optional workspace scope, active month range. |
| `savings_goals`, `savings_goal_accounts`, `savings_contributions` | Target, deadline, mode (`manual` / `accounts`), planned monthly amount. |

Reporting rules: income = Σ income; spending = Σ expenses − refunds; **transfers and adjustments are excluded** from both. Conversions use the rate effective at the end of the reported month.

## Life tables (Phase 2)
| Table | Purpose |
|---|---|
| `tasks` | Title, status, priority 1–4, area, `due_date` + optional `due_time`, recurrence, links to `goal_id`, `person_id`, `project_id` (Phase 3), `workspace_id`. `source` (unique) marks automation-created tasks so they are never duplicated. |
| `events` | Local date + wall-clock times (user's time zone), all-day / multi-day, recurrence + until, reminder minutes. Occurrences are expanded on read. |
| `goals`, `goal_checkins` | Self-referencing hierarchy (`parent_id`, `level`), progress metric (`none`, `numeric`, `tasks`, `children`, `savings`), check-in history. |
| `notes` | Title + Markdown body, pinned, archived. `[[links]]` are stored in `entity_links` (relation `mentions`). |
| `people`, `interactions` | Contacts with relationship, phones, email, birthday, follow-up; interaction log (call, WhatsApp, email, meeting, message, note). |
| `idempotency_keys` | Stored responses for retried POSTs from the phone outbox (kept 7 days). |

## Business tables (Phase 3)
| Table | Purpose |
|---|---|
| `organizations` | Companies (type, industry, contact details). `people.organization_id` links a person to their company. |
| `business_relations` | Role of a person **or** a company for one business workspace (lead, client, supplier…), status, since. |
| `pipelines`, `pipeline_stages` | One or more pipelines per business; stages with probability and kind (`open`, `won`, `lost`). |
| `opportunities` | Deals: stage, value (minor units) + currency, probability override, expected close, next action/date, closed date, lost reason. |
| `projects` | Business or personal projects: client, status, priority, dates, currency, cost budget, contract value, linked deal and goal. |
| `milestones` | Project milestones with due date, done flag and optional payment amount. |

Project money is **not stored twice**: revenue and costs are computed from `transactions.project_id`.

## Career tables (Phase 4)
| Table | Purpose |
|---|---|
| `employments` | Jobs held: company (optional `organization_id`), position, type, start/end (null end = current), salary (minor units) + currency + period, manager (text and/or contact). |
| `application_statuses` | Your application statuses, in order, each with a `kind` (saved, active, interview, offer, accepted, rejected, withdrawn) used by the funnel. Defaults are created once. |
| `job_applications` | Company, position, status, dates, salary range, work mode, source, recruiter contact, follow-up date, CV version, job description, outcome, priority, `closed_at`. |
| `interviews` | Per application: stage, date/time, mode, interviewer, outcome. |
| `skills` | Name, category, level and target (0–5), last used, evidence, linked goal. |
| `achievements`, `achievement_skills` | Achievements (date, job, metric, impact, CV relevance, own CV bullet) and the skills used. |
| `learning_items` | Courses/books/certifications: status, progress, dates, completion date, cost, linked skill and goal. |

## Insights tables (Phase 5)
| Table | Purpose |
|---|---|
| `assets` | Name, type, liquidity, optional workspace, currency, purchase date/price, quantity + unit, include-in-net-worth, `disposed_at`/`disposed_value` when sold. |
| `asset_valuations` | Dated values (minor units). The value on a date is the latest valuation on or before it. |
| `net_worth_snapshots` | One row per day (primary key = date) with liquid, investments, other assets, liabilities and net worth in the base currency at that time. |
| `reviews` | One per (type, period start): reflection text, rating, `completed_at`, and `metrics` — a JSON copy of the numbers frozen when completed. |
| `scenarios` | Horizon, optional income/expense/start-balance overrides and a JSON list of changes (minor units of the base currency). |

The dashboard layout is stored in settings (`dashboard`: ordered list of card ids, or null for the default).

## Automation & data tables (Phase 6)
| Table | Purpose |
|---|---|
| `automations` | Rule: name, enabled, event, schedule (JSON), conditions and actions (JSON), last handled schedule occurrence, last run, run count. |
| `automation_runs` | Log per run: status (ok/error), triggering record, message. Last 200 kept per rule. |
| `custom_field_defs` | Field per record type: label, type, options (JSON), required, order. |
| `custom_field_values` | Value per (field, record), stored as text, validated by the field type. |
| `imports`, `import_items` | Each import (target, file name, counts, undone date) and exactly which records it created — used by Undo. |
| `import_presets` | Saved column mapping + options, e.g. one per bank. |

Automations listen to the audit trail: every audited change is also an event. Changes made with the automation context (`ip = 'automation'`) never trigger rules.

The full design is in [roadmap.md](roadmap.md).

## Migrations
1. Edit `apps/server/src/db/schema/*.ts`.
2. `npm run db:generate` creates `drizzle/NNNN_*.sql`. For SQL Drizzle can't express (FTS, triggers), use `npx drizzle-kit generate --custom --name <name>` in `apps/server`.
3. Review the SQL and commit it. It is applied on the next start (and to restored older backups).

Never edit a migration that has already shipped. Add a new one.

## Moving to PostgreSQL later
The schema uses only portable types. To move: switch the Drizzle dialect, regenerate migrations, port the FTS5 table to a `tsvector` column, and copy the data (the JSON export works as a bridge).
