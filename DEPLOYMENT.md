# Deployment & Operations Guide (`DEPLOYMENT.md`)

> **Written for a reviewer or engineer to deploy, run, verify, and troubleshoot the system with zero guesswork.**

---

## 1. System Prerequisites

| Tool | Minimum Version | Recommended | Notes |
| :--- | :--- | :--- | :--- |
| **Docker Desktop / Engine** | `20.10.0+` | `24.0.0+` | Required for containerized execution |
| **Docker Compose** | `v2.0.0+` | `v2.20.0+` | Built-in with modern Docker Desktop |
| **Node.js** *(Optional)* | `v18.0.0+` | `v20.0.0+` | Only required if running locally without Docker |
| **Git** | `2.30.0+` | Latest | For cloning repository |

---

## 2. One-Command Automated Deployment

Launch the entire containerized stack with one command:

```bash
# 1. Clone the repository
git clone https://github.com/Dishantjhava/grid-fault-locator.git
cd grid-fault-locator

# 2. Launch containerized stack
docker compose up --build
```

### What Docker Automatically Executes:
1. Boots **PostgreSQL 16 Alpine** container (`gridfault-postgres`) on port `5432` with healthcheck.
2. Waits for PostgreSQL to become healthy, then launches **Node.js Backend** container (`gridfault-backend`) on port `3001`.
3. Runs `prisma db push` to initialize schema tables.
4. Executes `prisma/seed.ts` to populate 4 substations, 15 feeders, 55 DTs, and ~2,648 poles in Bengaluru BBMP.
5. Launches **Vite React Frontend** container (`gridfault-frontend`) on port `5173`.

---

## 3. Environment Variables Reference (`.env.example`)

Copy `.env.example` to `.env` if custom configurations are needed:

```bash
cp .env.example .env
```

| Variable Name | Required | Default Value | Description |
| :--- | :---: | :--- | :--- |
| `DATABASE_URL` | **YES** | `postgresql://postgres:postgres@localhost:5432/gridfault` | PostgreSQL connection string for Prisma ORM |
| `PORT` | **YES** | `3001` | HTTP port for backend Fastify server |
| `NODE_ENV` | NO | `development` | Environment mode (`development` / `production`) |
| `VITE_BACKEND_URL` | NO | `http://localhost:3001` | Public backend URL called by React frontend |
| `OPENAI_API_KEY` | NO | *[BLANK]* | Optional OpenAI key for AI operator briefings (falls back to template summaries if blank) |

---

## 4. Verification & Health Checks

### Live Production Railway Deployment:
- **Live Frontend UI**: [https://steadfast-nourishment-production-7968.up.railway.app](https://steadfast-nourishment-production-7968.up.railway.app)
- **Live Backend Health**: [https://grid-fault-locator-production.up.railway.app/health](https://grid-fault-locator-production.up.railway.app/health)
  ```bash
  curl -s https://grid-fault-locator-production.up.railway.app/health
  # Expected output: {"status":"ok"}
  ```

---

### Local Docker Environment:
Once `docker compose up --build` finishes starting:

1. **Verify Local Backend Health**:
   Open `http://localhost:3001/health` in browser or run:
   ```bash
   curl -s http://localhost:3001/health
   # Expected output: {"status":"ok"}
   ```

2. **Verify Local Operator Console UI**:
   Open `http://localhost:5173` in browser:
   - The dark-themed **Karnataka Power Distribution Console** loads.
   - The map displays the Bengaluru BBMP region with blue DT markers and green live poles.
   - Initial status sidebar shows `0 Active Incidents` (*All Grid Sectors Energized*).

3. **Verify Simulator Fault Ingestion**:
   - Check `☑ Instant mode` in the bottom simulator control panel.
   - Click **Span Fault** on `DT-001`.
   - An incident ticket appears immediately in the left sidebar with PIN code and boundary details.

---

## 5. Troubleshooting Table (Based on Real Runtime Issues Encountered)

| Symptom / Error | Root Cause | Exact Resolution / Fix |
| :--- | :--- | :--- |
| `Error: listen EADDRINUSE 0.0.0.0:3001` | Port 3001 is already in use by another application on host | Terminate process on port 3001 (`npx kill-port 3001` or `stop-process` on PID), or set `PORT=3002` in `.env`. |
| `Error: listen EADDRINUSE 0.0.0.0:5173` | Port 5173 is already in use | Vite automatically shifts to port `5174`. Open `http://localhost:5174` in browser. |
| `Can't reach database server at localhost:5432` | PostgreSQL container is starting up or stopped | Ensure Docker Desktop is running, run `docker ps`, and check container health with `docker logs gridfault-postgres`. |
| `PrismaClientInitializationError: OpenSSL` | Alpine Linux missing OpenSSL library for Prisma binary | Added `RUN apk add --no-cache openssl` in [Dockerfile](file:///c:/Users/disha/Downloads/grid-fault-locator/backend/Dockerfile). |
| CORS Policy Blocked in Browser Console | Frontend domain not allowed by API | Fastify CORS is configured with `origin: true` in `server.ts` for development. |
| Cloud Container Cold-Start Delay | Free cloud instance sleeping | Allow ~30 seconds on initial page load for cloud container instance to wake up. |
| Incident creation held for 45 seconds | Debounce stabilization window active | Check `☑ Instant mode (skip 45s debounce)` checkbox in the simulator panel to bypass the 45s timer for instant demo response. |

---

## 6. Resetting to a Clean State

To wipe active test data and reset the database back to **0 Active Incidents**:

### Option A: Quick Seed Reset (Preserves Database)
Run in `backend` directory:
```bash
npm run seed
```
- Clears test incidents and restores all poles to `current_energized = true`.

### Option B: Complete Docker Volume Wipe
To perform a 100% complete clean wipe of Docker storage volumes:
```bash
docker compose down -v
docker compose up --build
```
- Deletes Docker volume `postgres_data`, recreates schema tables, and seeds fresh data.
