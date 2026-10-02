# Backup & restore

## What a backup is
One `.zip` file containing everything:

```
life-erp-backup-20261002-020000-auto.zip
├── manifest.json     format version, app version, date, record counts, SHA-256 of every file
├── db/life.sqlite    a consistent snapshot of the database (taken while the app runs)
├── files/…           every uploaded document
├── config/…          instance configuration
└── README.txt
```

The database is standard SQLite, readable with any SQLite tool (e.g. DB Browser for SQLite), so your data is never locked into LIFE ERP.

## Making backups

| How | Details |
|---|---|
| Automatic | Every night at 02:00 (Settings → Backups → time). If the laptop was off, it runs as soon as it's back on. The newest 14 are kept (configurable); manual and safety backups are never deleted automatically. |
| Manual | Settings → Backups → **Back up now**, the dashboard's *Data safety* card, or `npm run backup`. |
| Safety | Created automatically right before every restore. |

**Keep a copy off the laptop.** Settings → Backups → *Backup folder* can point at a USB drive, a second disk or a OneDrive folder (the backup zip is a finished file, so syncing it is safe). You can also download any backup from the list.

If a backup fails you get a **critical notification**, and the dashboard warns when the last good backup is more than 2 days old.

## Restoring

Restore **replaces all current data**. LIFE ERP protects you:

1. The backup is **fully verified** first: every file's checksum must match the manifest. Damaged backups are refused.
2. You must **type `RESTORE`** to confirm.
3. A **safety backup** of your current data is created before anything changes.
4. The backup is extracted and its database checked **before** your current data is touched.
5. If anything fails during the swap, your previous data is **put back automatically**.
6. Older backups are upgraded automatically (migrations run on open).
7. Demo backups can't be restored into real data, and the other way around.

### From the app
Settings → Backups → pick a backup → **Restore**. To restore a file from elsewhere (USB, another laptop), use **Restore from a file**. You'll be signed out afterwards, because sessions are part of the restored data.

### From the command line
Stop the server first, then:

```bash
npm run restore -- "D:\Backups\life-erp-backup-20261001-020000-auto.zip"
```

## Moving to a new laptop
1. Old laptop: **Back up now** and copy the zip.
2. New laptop: install Node.js, copy the `life-erp` folder (or `git clone` it), then run `npm install` and `npm start`.
3. Complete first-time setup with any temporary account, then Settings → Backups → **Restore from a file**. Your real account comes back with the data.

   Or, without a temporary account: stop the server, run `npm run restore -- <file.zip>`, then start it again.

You can also copy the whole `LifeERP-Data` folder while LIFE ERP is stopped on both machines.

## Export (no lock-in)
Settings → Data & export → **Export everything (JSON)** downloads every record as plain JSON, with passwords and secrets removed. Amounts are integers in minor units (e.g. piasters). Documents are only in full backups.
