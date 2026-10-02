# LIFE ERP

A private, **local-first** personal operating system â€” one place for your money, work, businesses, career, goals, documents and knowledge.

- **Your data stays on your laptop**: a single SQLite database plus a documents folder. No cloud database, no subscription.
- **Use it from your phone anywhere** through a private, encrypted Tailscale connection (free). Nothing is exposed to the public internet.
- **English and Arabic** (full right-to-left layout), installable on the phone as an app (PWA).
- **Complete backups** in one `.zip` you can restore anywhere.

> Status: **Phases 0–2 (foundation, personal finance, life core) are complete.** CRM, projects, career, analytics and the AI assistant are added phase by phase â€” see [docs/roadmap.md](docs/roadmap.md).

## Quick start

Prerequisites: **Node.js 22.12+** (24 recommended) and Git. Nothing else â€” no database server, no Visual Studio.

```bash
npm install
npm start
```

Open **http://localhost:4600** on the laptop and create your owner account (first-time setup only works on the laptop itself, for security).

| Command | What it does |
|---|---|
| `npm start` | Production / home-server mode (builds once if needed) |
| `npm run stop` | Stop a running server |
| `npm run dev` | Development mode with hot reload (open http://localhost:5173) |
| `npm run demo` | Run with **demo data** in a separate folder (http://localhost:4610, user `demo` / `demo-password`) |
| `npm run backup` | Create a full backup now |
| `npm run restore -- <file.zip>` | Restore a backup (server must be stopped; you will be asked to confirm) |
| `npm run reset-dev` | Wipe and re-seed the **demo** folder (never touches real data) |
| `npm test` | Run all automated tests |
| `npm run build` | Build the optimized frontend and server |

Forgot your password? On the laptop: `npm run cli -w @life-erp/server -- reset-password <username>`.

## Where your data lives

```
C:\Users\<you>\LifeERP-Data\        â† change with LIFE_ERP_DATA_DIR in .env
â”œâ”€â”€ db\life.sqlite                  the database (standard SQLite)
â”œâ”€â”€ files\                          uploaded documents (content-addressed)
â”œâ”€â”€ backups\                        automatic + manual backup .zip files
â”œâ”€â”€ config\                         instance settings (secrets.json)
â”œâ”€â”€ logs\server.log                 server log (rotated at 10 MB)
â””â”€â”€ tmp\                            scratch space (cleaned automatically)
```

Copy this folder (with LIFE ERP stopped) and you have everything. Keep it **out of OneDrive/Dropbox**; point the *backup* folder there instead (Settings â†’ Backups).

## Documentation

| | |
|---|---|
| [Setup](docs/setup.md) | Install, first run, production mode, auto-start, troubleshooting |
| [Remote access](docs/remote-access.md) | Phone access from anywhere with Tailscale â€” step by step |
| [Backup & restore](docs/backup-restore.md) | What a backup contains, restoring, moving to a new laptop |
| [Security](docs/security.md) | Threat model and every protection in place |
| [Architecture](docs/architecture.md) | How the system is built and why |
| [Database](docs/database.md) | Data model, conventions, migrations |
| [Development](docs/development.md) | Working on the code, adding a module |
| [Testing](docs/testing.md) | What is tested and how to run it |
| [Roadmap](docs/roadmap.md) | Phases, what is done, what is next |

## Environment variables

See [.env.example](.env.example). All are optional: `LIFE_ERP_DATA_DIR`, `LIFE_ERP_DEMO_DIR`, `PORT`, `LIFE_ERP_LAN`, `LIFE_ERP_MAX_UPLOAD_MB`, `LIFE_ERP_SESSION_DAYS`.

