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

Each later phase adds tests for its calculations (transfers never count as income/expense, budgets, installment schedules, goal forecasts, net worth…).

## Manual checks per release
- `npm run build`, then `npm start`, then sign in on desktop and on a phone-sized screen.
- Switch to Arabic and check that the layout mirrors.
- Back up, then restore that backup.
