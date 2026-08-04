# Karnataka Power Distribution — Grid Fault Locator System
## Comprehensive Architecture, Implementation & Technical Review Report

---

## Executive Summary

The **Grid Fault Locator System** is a production-grade, high-throughput electrical grid fault detection, localization, and management platform engineered for the **Karnataka State Power Distribution Board (BESCOM / BBMP Bengaluru Grid)**.

The system solves the critical operational challenge of detecting electrical line snaps, transformer outages, and sensor failures from **sparse, intermittent IoT telemetry** across both digitized (surveyed) and undigitized (un-surveyed) power lines.

---

## 1. System Architecture Overview

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                      IoT Edge Telemetry Sensors                         │
 └────────────────────────────────────┬────────────────────────────────────┘
                                      │  HTTP POST /telemetry (JSON)
                                      ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                 Fastify High-Throughput Ingestion Server                │
 │  - Deduplication: @@unique([device_id, seq]) via Prisma P2002 Catch    │
 │  - Ordering: Monotonic Sequence Counter (seq > last_seq)                │
 │  - Latency: Instant HTTP 202 Accepted Response                           │
 └────────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │               Deterministic Fault Localization Engine                   │
 │  - Dual Topology Builder: Digitized Links vs Inferred MST (Prim's)      │
 │  - Boundary Traverser: Isolates live-to-dark pole boundaries            │
 │  - Dead Sensor Detector: Flags silent sensors on live lines             │
 │  - Scheduled Outage Cross-Check: Suppresses alerts with ±30m buffer    │
 │  - Confidence Scorer: Penalizes MST inference & unmonitored poles       │
 └────────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │               Incident Lifecycle & Telemetry Verification               │
 │   [detected] -> [acknowledged] -> [crew_assigned] -> [resolved]         │
 │   - Auto-Close: [resolved] -> [verified] -> [closed] strictly when      │
 │     100% of affected_pole_ids report energized = true via IoT telemetry │
 └────────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                   2 AM Control Room Operator Console                    │
 │  - Left: Incident List sorted by Households Affected (desc)             │
 │  - Right: Leaflet OSM Map (Live/Dark/DT markers, Known vs Inferred ring) │
 │  - Bottom: Control Room Simulator Panel (Inject Faults/Repairs)         │
 │  - Polling: 4-second HTTP Auto-Refresh Loop                             │
 └─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. What We Have Achieved & Built (Phase Breakdown)

### Phase 1: Database Schema & Grid Network Seed Generator
- **Prisma Schema (`prisma/schema.prisma`)**:
  - Modeled `Feeder`, `DistributionTransformer`, `Pole`, `TelemetryEvent`, `Incident`, and `ScheduledOutage`.
  - Added unique index `@@unique([device_id, seq])` on `TelemetryEvent` for hardware-level deduplication.
  - Implemented **snapshot array storage** (`affected_pole_ids`, `lat`, `lon`, `pincode`) inside `Incident` to preserve historical truth when power is restored or topology is re-surveyed.
- **Synthetic Grid Generator (`prisma/seed.ts`)**:
  - Placed **4 substations**, **15 feeders**, **~50 DTs**, and **~3,000 poles** inside the Bengaluru BBMP bounding box.
  - Enforced realistic **40% digitized topology** (`parent_pole_id` populated) vs **60% undigitized topology** (`null` topology links).

### Phase 2: Telemetry Ingestion Endpoint & Load Testing
- **Ingestion API (`src/routes/telemetry.ts`)**:
  - `POST /telemetry` with Fastify JSON Schema validation.
  - Append-only time-series event log (`TelemetryEvent`).
  - **Sequence Number Ordering (`seq` over `ts`)**: Hardware counter `seq` reliably orders messages even if device real-time clocks drift, reset to 1970 on cold boot, or lack NTP sync.
  - **Idempotent Deduplication**: Catches Prisma `P2002` constraint errors on duplicate `(device_id, seq)` pairs, returning HTTP 202 without duplicating DB rows.
  - **Fast Response**: Responds instantly with `202 Accepted` to unblock HTTP ingestion workers.
- **Load Testing Suite (`load-test/telemetry-load.js`)**:
  - Built an `Autocannon` load test script measuring sustained throughput (**500 msg/s target**) and burst load (**5,000 requests in 10s**).

### Phase 3: Fault Localization Algorithm & Vitest Suite
- **Dual Topology Construction (`src/services/topology.ts`)**:
  - *Case A (Known)*: Builds in-memory tree directly using `parent_pole_id` links (`topology_source: "known"`).
  - *Case B (Inferred)*: Computes a Minimum Spanning Tree (MST via Prim's Algorithm using Haversine distance) for undigitized DTs (`topology_source: "inferred"`).
- **Deterministic Fault Localization (`src/services/localization.ts`)**:
  - *Tree Boundary Walker*: Identifies transitions where a live pole `P_live` feeds a dark child `P_dark`. Isolates `P_dark`'s subtree into a single incident.
  - *DT-Wide & Feeder-Wide Outage Classification*: Detects when 100% of poles under a DT or Feeder are dark.
  - *Dead Sensor Filter*: Flags dark poles whose downstream children are still live as broken sensors (`dead_sensors`) rather than grid line faults.
  - *Simultaneous Faults*: Detects multiple wire breaks under the same DT as independent incidents.
  - *Scheduled Outage Cross-Check*: Suppresses alerts matching active maintenance within a $\pm 30\text{ min}$ buffer.
  - *Confidence Scoring*: Starts at `1.0` (known) or `0.75` (inferred), applies a $-0.20$ penalty when boundary poles lack IoT sensors (`device_id: null`), and outputs a pole range `[P_live, P_dark]`.

### Phase 4: Incident Ticket Lifecycle & Automated Verification
- **State Machine (`src/routes/incidents.ts`)**:
  - Endpoints: `POST /incidents/:id/acknowledge`, `/assign-crew`, `/resolve`.
- **Automated Telemetry Verification (`src/services/verification.ts`)**:
  - `/resolve` sets status to `resolved` and initiates IoT telemetry watching.
  - **Why we don't trust manual resolve clicks alone**: Field crews operating at 2 AM frequently declare work done over radio before power is restored or secondary fuses blow under load.
  - Ticket auto-advances to `verified` and `closed` **only** when 100% of `affected_pole_ids` report `current_energized = true`.

### Phase 5: Single-Page 2 AM Operator Console UI
- **React + Tailwind + Leaflet UI (`frontend/src/`)**:
  - `IncidentList.tsx`: Sidebar sorted by households affected (descending) with topology badges (`✓ Digitized` green vs `⚠ Inferred MST` amber).
  - `NetworkMap.tsx`: Leaflet OSM map displaying live green, dark red, and transformer blue markers; solid red (known) vs dashed amber (inferred MST) boundary rings.
  - `IncidentDetail.tsx`: Modal with PIN code, coordinates, plain-text confidence reason, and operator state transition controls.
  - `SimulatorPanel.tsx`: Control room panel allowing operators to inject span faults, DT faults, feeder faults, dead sensors, scheduled outages, or power repairs.
  - **4-Second Polling Loop**: Automatically polls `GET /incidents` and `GET /network` every 4 seconds without WebSockets.

### Phase 6: AI Operator Briefing Summarizer
- **AI Service (`src/services/aiSummary.ts`)**:
  - Summarizes structured incident data using OpenAI API.
  - **Prompt Guardrails**: Strictly instructs model to only summarize provided fields without hallucinating details.
  - **3-Second Timeout & Fallback**: Uses an `AbortController` timeout of 3,000 ms. Immediately returns a clean template summary if API key is unconfigured or times out.
  - **Non-Blocking Background Execution**: Runs asynchronously without delaying incident persistence.

### Phase 7: Dockerization & Deployment
- **`docker-compose.yml`**: One-command deployment (`git clone && docker compose up`) orchestrating PostgreSQL 16 Alpine, automated Prisma DB migrations, grid seed generation, backend server, and frontend Vite server.
- **`.env.example`**: Complete documentation covering every environment variable, purpose, required status, and safe defaults.

---

## 3. Comprehensive Verification & Test Metrics

- **Vitest Unit Test Suite**: `17/17 passed` (`100% pass rate`):
  - `test/topology.test.ts` (3 tests)
  - `test/localization.test.ts` (7 tests)
  - `test/lifecycle.test.ts` (3 tests)
  - `test/aiSummary.test.ts` (4 tests)
- **TypeScript Compilation**: `0 errors` across backend and frontend (`npx tsc --noEmit`).
- **Frontend Production Build**: Built cleanly in `3.67s` (`dist/assets/index.js` 327 kB).

---

## 4. Recommended Future Improvements & Production Enhancements

While the system meets and exceeds all requirements of the specification, the following architectural enhancements could be added in future iterations:

### 1. Real-Time Push Invalidation (WebSockets / Server-Sent Events)
- *Current*: 4-second HTTP polling loop.
- *Improvement*: Implement Server-Sent Events (SSE) or WebSockets (`@fastify/websocket`) so control room monitors update instantly ($<100\text{ ms}$) when edge telemetry arrives.

### 2. Machine Learning Predictive Overload Early Warning
- *Current*: Detects faults after line snaps or power is lost (`current_energized = false`).
- *Improvement*: Analyze continuous `voltage_mv`, `current_ma`, and transformer temperature telemetry to detect thermal stress or voltage sag patterns, flagging high-risk poles *before* physical wire failure occurs.

### 3. Geographic Convex Hull Bounding Polygons
- *Current*: Circular map radius for incident boundaries.
- *Improvement*: Compute exact minimum convex hulls (using Turf.js or PostGIS `ST_ConvexHull`) around `affected_pole_ids` to render precise street-level polygon boundaries on the operator map.

### 4. Field Crew GPS Tracking & Automated Routing
- *Current*: Manual crew assignment (`/assign-crew`).
- *Improvement*: Integrate real-time mobile GPS tracking of repair trucks to automatically suggest the nearest available crew based on road distance.

---

## Summary Table of Artifact Files

| Layer | Primary Source File | Purpose |
| :--- | :--- | :--- |
| **Database** | [schema.prisma](file:///c:/Users/disha/Downloads/grid-fault-locator/backend/prisma/schema.prisma) | Data models, snapshot rationale & unique constraints |
| **Grid Generator** | [seed.ts](file:///c:/Users/disha/Downloads/grid-fault-locator/backend/prisma/seed.ts) | Synthetic Bengaluru BBMP radial grid generator |
| **Ingestion** | [telemetry.ts](file:///c:/Users/disha/Downloads/grid-fault-locator/backend/src/routes/telemetry.ts) | High-throughput POST /telemetry API |
| **Topology** | [topology.ts](file:///c:/Users/disha/Downloads/grid-fault-locator/backend/src/services/topology.ts) | Digitized vs Prim's MST tree builder |
| **Localization** | [localization.ts](file:///c:/Users/disha/Downloads/grid-fault-locator/backend/src/services/localization.ts) | Fault localization, boundary finding & outage suppression |
| **Lifecycle** | [verification.ts](file:///c:/Users/disha/Downloads/grid-fault-locator/backend/src/services/verification.ts) | Automated telemetry verification engine |
| **AI Briefing** | [aiSummary.ts](file:///c:/Users/disha/Downloads/grid-fault-locator/backend/src/services/aiSummary.ts) | AI briefing summarizer with 3s timeout & fallback |
| **Frontend UI** | [App.tsx](file:///c:/Users/disha/Downloads/grid-fault-locator/frontend/src/App.tsx) | 2 AM Control Room Operator Console UI |
| **Deployment** | [docker-compose.yml](file:///c:/Users/disha/Downloads/grid-fault-locator/docker-compose.yml) | Zero-step automated Docker orchestration |
