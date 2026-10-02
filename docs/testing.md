# Testing

```bash
npm test                          # everything
npm test -w @life-erp/server      # API / integration
npm test -w @life-erp/shared      # money & shared logic
```

Server tests create a fresh, temporary data folder per test file and drive the real HTTP pipeline (`app.inject`): headers, CSRF, sessions, validation, database, files.

## Coverage so far (Phase 0)
| Area | Tests |
|---|---|
| Money | Parsing (thousands separators, Arabic-Indic digits, per-currency precision), no float drift, rounding, conversion |
| Setup | Required first, only once, refused when proxied/remote, password rules |
| Auth | Login by username/email, logout revokes the token, generic errors, account lockout, Argon2id hashing |
| CSRF | Missing header blocked; cookie is HttpOnly + SameSite=Strict |
| Password change | Needs the current password, signs out other devices |
| 2FA | Setup + verify, code required at login, wrong code rejected, recovery code single-use |
| Audit | Setup and login recorded, no secrets in the log |
| Workspaces | Create/rename (slug), duplicate names, archive/unarchive, soft delete, personal workspace protected, field errors |
| Documents | Upload, real type detection from content, de-duplication, authenticated download, safe headers for active content, empty-file error, filters, soft delete |
| Search | By title, by #tag, by workspace, Arabic text, hostile query syntax neutralised, deleted records removed |
| Links | Both directions, missing target 404, self-link refused |
| Tags | Usage counts, rename updates search, normalisation and duplicates |
| Settings | Partial merge, validation |
| Notifications | Expiring-document reminder raised exactly once, dismiss |
| Backup/restore | Verified backup, restore requires typed confirmation, data and files come back exactly, safety backup created, damaged archive refused (data untouched), path tricks refused, demo/real separation |
| Export | All tables, no sessions, no password hashes |

## Coverage added in Phase 1 (finance)
| Area | Tests |
|---|---|
| Shared calculations | Signed amounts per type; month-end clamping and anchor days; recurrence occurrences; installment schedules summing exactly; goal ETA, required monthly, on-track, scenarios, achieved/overdue; budget projection and status; savings rate |
| Categories | Bilingual defaults seeded once, custom categories, duplicates, nesting limit, in-use protection |
| Accounts & transactions | Opening balances, sign per type, invalid amounts/precision/dates/category kinds with field errors, duplicate warning + confirm, archived accounts blocked |
| Transfers | Balances move on both legs, **never counted as income/expense**, cross-currency requires the received amount, edit/delete keep both legs exact |
| Reports | Monthly income/expenses/net/savings rate, refunds net out, category roll-up, missing FX rates reported (never guessed) then converted, net position |
| Recurring | Reminders, record, skip, upcoming, **auto-post exactly once** |
| Installments | Schedule, overdue critical alert, pay/undo restores balance, schedule locked after payments, deleting the payment transaction re-opens the payment, auto-complete, validation |
| Debts | Repayments adjust the balance but not income/expense, overpayment refused, settle and re-open |
| Budgets | Actual with subcategory roll-up, over-budget status + alert, parent/child overlap refused |
| Goals | Contributions, pace, ETA, what-if scenario without side effects, linked-account mode with FX |
| Formatting (web) | Money/dates in EN/AR, Western and Arabic-Indic digits, time-zone-safe dates, translation completeness and placeholder parity |

## Coverage added in Phase 2 (life core)
| Area | Tests |
|---|---|
| Quick capture parser | Dates (today/tomorrow/weekdays/explicit/“in N days”/next week), times (24h, am/pm), priority, tags, Arabic words, untouched plain text |
| Goal math | Numeric progress incl. decreasing targets, expected progress, health states |
| Tasks | Inbox vs planned, quick capture endpoint, views and counts, recurrence spawns next exactly once, linked-record validation |
| Calendar | Recurring/multi-day expansion, time validation, unified feed (tasks, birthdays), reminders sent once, range limits |
| Goals | Progress from check-ins, tasks, children and savings goal; loop prevention; required targets; behind-schedule alert |
| Notes | Wiki links resolve (incl. notes created later), backlinks, search, pin/archive |
| People | Interactions, last contact, follow-up → single task, follow-up cleared by contact, duplicate detection |
| Today | Overdue, due today, events, birthdays |
| Outbox | Replayed request with the same idempotency key returns the original response, no duplicate |

Manually verified in the browser: Markdown sanitisation (an `onerror` image, a `javascript:` link and a `<script>` are all neutralised).

## Coverage added in Phase 3 (business & CRM)
| Area | Tests |
|---|---|
| Business math | Pipeline stats (open, weighted, won, win rate, average deal); project health (on track, delayed, over budget, at risk by time and by spend, done, not started) |
| Companies & roles | Duplicate names, people linked to companies, one contact with roles in several businesses, duplicate role refused, person-or-company rule |
| Pipelines | Default stages per business, stage edits, stages with deals protected, won/lost stages required |
| Deals | Lead on creation, client when won, close date, stage from another business refused, contact **and** company both linked, analytics |
| Projects | Created from a won deal once, milestones progress, revenue/costs/refunds/profit from linked transactions, budget → over budget, invalid project link refused, calendar entries, history kept on delete |
| Automations | Over-budget, milestone due, next-action reminders (and none for won deals) |
| Business overview | Month and year-to-date P&L, pipeline, role counts |

**Total: 125 automated tests.**

## Manual checks per release
- `npm run build`, then `npm start`, then sign in on desktop and on a phone-sized screen.
- Switch to Arabic and check that the layout mirrors.
- Back up, then restore that backup.
