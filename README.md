# Top Gainer Scalper - Run Guide

This project now runs with:

- `bff` as backend API server (default port `3001`)
- `ui` as Next.js frontend (default port `3000`)

## 1) Prerequisites

Install these first:

- Node.js (recommended v22+)
- npm (comes with Node.js)
- PowerShell (already on Windows)

Optional:

- Python 3 (only if you want to use `start_bff.py`)

## 2) Open the project folder

From PowerShell:

```powershell
cd "c:\Users\cheem\OneDrive\Documents\New project\top-gainer-scalper"
```

## 3) Install dependencies

```powershell
cd bff
npm install
cd ..

cd ui
npm install
cd ..
```

## 4) Start the app (recommended: SQLite mode)

From project root, start backend first:

### Option A - PowerShell starter

```powershell
.\startBffServer.ps1
```

### Option B - Python starter

```powershell
python start_bff.py
```

Both default to SQLite storage. SQLite is embedded, so no DB server startup is required.

Then start frontend in a second terminal:

```powershell
cd ui
npm run dev
```

## 5) Open in browser

Go to:

- `http://localhost:3000`

## 6) Common run variants

Run with JSON storage:

```powershell
.\startBffServer.ps1 -Store json
```

Run backend on custom port:

```powershell
.\startBffServer.ps1 -Store sqlite -Port 3002
```

If you change backend port, also update `ui/next.config.mjs` rewrite destination from `localhost:3001` to your chosen backend port.

Then open frontend:

- `http://localhost:3000`

## 7) First-time SQLite migration

When running SQLite mode for the first time:

- Existing JSON bot state is imported automatically (if present).
- SQLite DB file is created automatically.

No manual migration step is needed.

## 8) Troubleshooting

- If `node:sqlite` errors appear, check Node version:
  - `node -v` (use Node 22+)
- If scripts are blocked in PowerShell, run once:
  - `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
- If port is busy, use `-Port 3002`.
