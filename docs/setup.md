# Setup

## Prerequisites
- **Windows 10/11** (macOS and Linux also work)
- **Node.js 22.12 or newer** (24 LTS recommended): https://nodejs.org
- **Git** (to get updates): https://git-scm.com

No database server, Docker, Python or Visual Studio is needed. SQLite and password hashing ship as prebuilt binaries.

## Install

```bash
cd C:\Users\Admin\Projects\life-erp
npm install
```

npm 11 blocks package install scripts by default. LIFE ERP's native packages load from bundled prebuilt binaries, so this is fine. If `npm install` warns about esbuild, run `npm install-scripts approve esbuild better-sqlite3` once.

## First run

```bash
npm start
```

1. Open **http://localhost:4600** *on the laptop*.
2. Create your owner account. Choose a long password (a short sentence is ideal). This only works on the laptop itself, so nobody on your network can claim the system first.
3. Your workspaces are created: Personal plus the businesses you listed. You can add, rename, archive or delete them later in Settings → Workspaces.

## Modes

| Mode | Command | Use it for |
|---|---|---|
| Production / home server | `npm start` | Daily use. Optimized build, logs to `<data>\logs\server.log`, nightly backups. |
| Development | `npm run dev` | Changing the code. The API runs on :4600 with auto-restart; the UI on http://localhost:5173 with hot reload. Uses the **same data folder** as production, so stop production first or point `.env` at a separate `LIFE_ERP_DATA_DIR`. |
| Demo | `npm run demo` | Exploring with sample data. Uses `LifeERP-Demo` on port 4610 and never touches real data. |

After updating the code (`git pull`), rebuild with `npm start -- --rebuild` or `npm run build`.

## Auto-start at login

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
```

This registers a scheduled task named "LIFE ERP" that starts the server at logon and restarts it if it crashes. To remove it:
`Unregister-ScheduledTask -TaskName "LIFE ERP" -Confirm:$false`.

## Configuration

Copy `.env.example` to `.env` to change the data folder, port, LAN access, upload limit or session length. Restart after changing it.

## Logs

`<data folder>\logs\server.log` holds JSON lines with one entry per request and every error. It rotates at 10 MB and keeps 3 old files. Error messages in the app include a **reference** code; search the log for it.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Port 4600 is already in use` | LIFE ERP is already running (`npm run stop`), or another app uses the port: set `PORT=4700` in `.env`. |
| `Another LIFE ERP server … is already using …` | Two copies are pointed at the same data. Stop the other one. |
| `Could not open the database …` | The file is missing, locked or damaged. Make sure no other program (sync tool, antivirus scan) holds it, then restore the latest backup: `npm run restore -- <file>`. |
| Blank page after updating | Hard-reload (Ctrl+Shift+R). The app also shows a "new version" prompt. |
| Forgot password | `npm run cli -w @life-erp/server -- reset-password <username>` prints a temporary password. |
| Lost 2FA phone and recovery codes | `npm run cli -w @life-erp/server -- disable-2fa <username>` (on the laptop). |
