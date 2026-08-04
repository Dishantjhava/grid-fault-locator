# Grid Fault Locator — Deployment & Operational Guide

## Quick Start (Zero-Step Docker Deployment)

To deploy the full system on a clean machine with Docker installed:

```bash
git clone https://github.com/Dishantjhava/grid-fault-locator.git
cd grid-fault-locator
docker compose up --build
```

Access services:
- **Operator Console UI**: `http://localhost:5173`
- **Backend Fastify API**: `http://localhost:3001`
- **PostgreSQL Database**: `localhost:5432`

---

## 🛠️ Troubleshooting & Known Benign Log Noise

### 1. PostgreSQL Connection Reset Log Message
```text
gridfault-postgres | could not receive data from client: Connection reset by peer
```
- **Context & Explanation**: This log message appears during initial container startup right when the backend executes database migrations (`npx prisma db push`). It is an expected artifact of Prisma's migration engine abruptly closing healthcheck connections before opening the main connection pool.
- **Action Required**: None. This is **known benign log noise**. Once the migration completes, data seeding succeeds, and the server accepts HTTP traffic cleanly.

### 3. In-Memory Debounce Timer Process Survival
- **Context & Architectural Decision**: Active 45-second debounce stabilization timers are managed in-memory per DT (`activeDebounceTimers: Map<string, Timeout>`) using a true sliding window (`clearTimeout`/`setTimeout`). This delivers sub-millisecond timer resets during high-throughput cascade storms.
- **Production Extension**: In-memory timers do not survive process restarts. In a multi-instance or high-availability production deployment, pending debounced DTs would persist a `pending_since` timestamp in Redis or PostgreSQL and be processed by a distributed worker sweep (similar to the silent staleness watchdog).
