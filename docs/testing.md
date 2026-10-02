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

**Total: 86 automated tests.**

## Manual checks per release
- `npm run build`, then `npm start`, then sign in on desktop and on a phone-sized screen.
- Switch to Arabic and check that the layout mirrors.
- Back up, then restore that backup.
