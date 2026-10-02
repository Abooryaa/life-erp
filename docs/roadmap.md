# Roadmap

Each phase is built, tested and documented before the next one starts. Cross-cutting foundations come first because every module depends on them.

## ✅ Phase 0: Foundation
- Monorepo (TypeScript), Fastify API, React PWA, SQLite + migrations, data-folder layout
- Owner account, Argon2id, sessions, rate limiting/lockout, CSRF, security headers, **TOTP 2FA**, device list, password change, CLI recovery
- Design system (tokens, light/dark), **English + Arabic with full RTL**, Arabic-Indic digits option
- App shell: desktop sidebar, phone bottom bar with ➕ quick add, Ctrl+K command palette, workspace switcher
- **Workspaces** (Personal + any number of businesses, created at runtime)
- Global **tags**, any-to-any **links**, **attachments**, **full-text search** (Arabic-aware)
- **Documents** library (local files, type detection, expiry reminders, preview, camera capture on phone)
- **Notifications** center, **audit log** / activity page
- **Backup & restore** (verified zip, safety backup, rollback, nightly auto-backup with retention, custom folder, upload/download), JSON export
- Settings: general, profile, security, workspaces, tags, backups, data, remote access, system
- Production mode, dev mode, demo mode (separate folder), stop script, Windows auto-start
- Tailscale remote-access guide, docs, 44 automated tests

## ✅ Phase 1: Personal finance
- Accounts: bank, cash, savings, credit card, e-wallet, investment, loan, **gam'eya**, other. Opening balances, computed balances, archive, and **reconciliation** (adjust to the real balance without touching income/expense)
- Multi-currency: per-account currency, exchange-rate table, cross rates, custom currencies. Totals that can't be converted are **reported, never guessed**
- Categories and subcategories (EN/AR names, colours), seeded defaults, archive vs delete protection
- Transactions: income, expense, **transfer** (two linked legs, never counted as income/expense; cross-currency), refund, adjustment. Tags, receipts as attachments, links, **duplicate detection**, search, filters, totals
- Quick add for expense/income/transfer from anywhere (phone ➕ button): remembered account, frequent-category chips, decimal keyboard, Arabic digits accepted
- Recurring items and subscriptions: reminders, one-tap record/skip, optional **auto-record with catch-up** after the laptop was off
- Installments: automatic schedule (exact to the piaster), down payment, interest/fees, pay/undo with expense recording, overdue alerts, future obligations
- Debts and receivables: partial repayments (balance-only adjustments), settle/re-open, due alerts
- Budgets: monthly per category (subcategories roll up), per workspace (business budgets), budget/actual/remaining/% used/**projected**, 80% and over-budget alerts
- Savings goals: manual contributions or linked-account balances, pace, **ETA**, required monthly amount, on-track status, **what-if scenarios** (calculated only, nothing saved)
- Overview: income/expenses/savings/savings rate vs last month, 12-month trend, spending by category, cash, net position, upcoming 30 days. Command-center money summary
- Demo data for all of the above
- Deferred to Phase 6: bank CSV import (the JSON export already covers getting data *out*)

## Phase 2: Life core
**Today** screen, tasks (statuses, priority, recurrence, global or linked to anything), calendar (events, deadlines, recurring), goals/OKRs hierarchy with automatic progress, notes/knowledge base (rich text, note links), personal contacts, inbox/quick capture, phone outbox for offline quick-adds, first automations (follow-ups, overdue, deadlines).

## Phase 3: Businesses & CRM
Business home pages (P&L, KPIs), people and organizations with roles per business (lead, prospect, client, supplier, partner…), interaction history (call, WhatsApp, email, meeting), customizable pipelines and opportunities with analytics, projects (Kanban, list, calendar, milestones, budget vs actual, revenue/expenses), business finance linked to Phase 1.

## Phase 4: Career
Employment history, job applications pipeline (customizable statuses, interviews, follow-ups), achievements database with CV-bullet export, skills (level/target/evidence), learning plans (courses, books, certifications).

## Phase 5: Insights
Assets and investments with valuation history, net worth (liquid/non-liquid/liabilities), analytics across finance/career/business/life, configurable dashboard widgets, weekly review, monthly review (month vs previous month), scenario planning.

## Phase 6: Automation engine & data tools
User-configurable automation rules, custom fields, CSV/JSON import for every module, bank-statement CSV mapping.

## Phase 7: AI assistant
Provider-agnostic (local **Ollama** or **Claude API**, selectable, **off by default**). The AI calls typed read-only query tools on your data; answers separate **"From your data"** facts from **"AI suggestion"** text. Every AI call is logged. Assisted weekly/monthly reviews and natural-language search.

## Phase 8: Hardening
Encrypted backups (password), end-to-end tests on desktop and phone sizes, performance with 100k+ records, accessibility pass, security review.

## Later (designed for, not planned yet)
Family/team members and permissions, shared businesses, external calendar (ICS/Google), banking/email integrations, PostgreSQL, cloud sync, native mobile app.
