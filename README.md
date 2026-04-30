# Top Gainer Scalper

This project runs as:

- `bff` (backend API, default `3001`)
- `ui` (Next.js frontend, default `3000`)

## Prerequisites

- Node.js 22+
- npm
- PowerShell (Windows)

Optional:

- Python 3 (`start_bff.py`)

## Install

```powershell
cd bff
npm install
cd ..
cd ui
npm install
cd ..
```

## Run

Backend (recommended starter):

```powershell
.\startBffServer.ps1
```

Alternative:

```powershell
python start_bff.py
```

Frontend:

```powershell
cd ui
npm run dev
```

Open: `http://localhost:3000`

## BFF tests and safety checks

From `bff` folder:

```powershell
npm run check
npm run test
```

Smoke suite (typecheck + tests in one command):

```powershell
npm run test:smoke
```

## Swagger / API docs

When BFF is running:

- OpenAPI JSON: `http://localhost:3001/api/openapi.json`
- Swagger UI: `http://localhost:3001/api/docs`

## Notes

- SQLite mode is embedded; no external DB server required.
- If backend port changes, update `ui/next.config.mjs` rewrite target.
