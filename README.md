# Grid Fault Locator

Fault detection and localization system for the Karnataka State Power Distribution Board.

> Full documentation coming as the system is built. This is a placeholder.

## Quick start

```bash
git clone <repo-url>
cd grid-fault-locator
docker compose up --build
```

Open **http://localhost:5173** in your browser. You should see a page confirming the backend is reachable.

## Services

| Service    | URL                      |
| ---------- | ------------------------ |
| Frontend   | http://localhost:5173    |
| Backend API | http://localhost:3001   |
| PostgreSQL  | localhost:5432          |

## Docs (coming soon)

- `ARCHITECTURE.md` — system design, algorithm, data model
- `DEPLOYMENT.md` — step-by-step deployment guide
- `DECISIONS.md` — decision log and assumptions
- `AI-WORKFLOW.md` — AI tooling usage and audit
