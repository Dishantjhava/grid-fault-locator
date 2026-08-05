# Technical Decision Log & Trade-off Analysis (`DECISIONS.md`)

> **A chronological log of my engineering decisions, rejected alternatives, assumptions, and honest trade-offs.**

---

## 1. Decision Log (Chronological — Newest First)

### Decision 6: In-Memory Sliding Window Debounce Timer vs Redis Worker Queue
- **Date**: 2026-08-04
- **My Choice**: Built an in-memory sliding window timer map (`activeDebounceTimers: Map<string, Timeout>`) in Node.js process memory.
- **Rejected Alternative**: Redis / BullMQ external job queue.
- **Rationale**: Keeps the deployment zero-dependency (PostgreSQL + Node + React) so `docker compose up` works out-of-the-box without requiring a Redis service.
- **Honest Trade-off**: In-memory timers do not survive a container restart. For multi-node production deployments, pending timers should be persisted in Redis/PostgreSQL and swept by a background worker.

### Decision 5: Non-Blocking AI Operational Briefings with 3s Fallback
- **Date**: 2026-08-04
- **My Choice**: OpenAI GPT-4o-mini summarization executed asynchronously out-of-band with an `AbortController` 3-second timeout and template fallback.
- **Rejected Alternative**: Using LLMs to perform the fault localization algorithm itself.
- **Rationale**: Graph traversal is deterministic, instantaneous ($<2\text{ ms}$), $0\text{ cost}$, and 100% explainable. LLM fault localization introduces hallucinations, non-determinism, API cost, and 1s+ latency. AI is used solely for plain-language operator briefing generation.

### Decision 4: Minimum Spanning Tree (Prim's Algorithm) for 60% Undigitized Topology
- **Date**: 2026-08-03
- **My Choice**: Inferred tree construction using Prim's MST algorithm based on Haversine distance for undigitized DTs.
- **Rejected Alternative**: Degrading to DT-level blackout tickets for 60% of the grid or requiring manual topological surveys before launching.
- **Rationale**: Geographic proximity closely mirrors radial low-tension line layouts along road corridors. It allows span-level boundary localization on undigitized lines while clearly flagging `topology_source: "inferred"` and confidence `75%`.

### Decision 3: Hardware Sequence Counter (`seq`) over Device Timestamps (`ts`)
- **Date**: 2026-08-03
- **My Choice**: Ordered device telemetry updates by `seq` monotonic counter.
- **Rejected Alternative**: Ordering updates by `ts` (device real-time clock).
- **Rationale**: Edge IoT device clocks suffer from up to $\pm 90\text{s}$ jitter, cold-boot resets (1970-01-01), or missing NTP synchronization. `seq` guarantees strict causal ordering per device.

### Decision 2: Automated IoT Telemetry Verification for Ticket Resolution
- **Date**: 2026-08-03
- **My Choice**: Requiring 100% of affected poles to report `current_energized = true` via telemetry before allowing a ticket to transition to `closed`.
- **Rejected Alternative**: Allowing operators or field crews to close tickets by manually clicking a "Close" button.
- **Rationale**: Prevents premature closure due to human error, radio miscommunication, or secondary downstream fuse blows under load.

### Decision 1: Single-Page 2 AM Operator Console with Leaflet OSM Map
- **Date**: 2026-08-03
- **My Choice**: React single-page app with Leaflet OSM map, households-affected sorted sidebar, and simulator control panel.
- **Rejected Alternative**: Complex multi-tab dashboard with analytics graphs or crew dispatch routing maps.
- **Rationale**: Maximizes situational awareness for midnight operators by keeping critical outage information dominating the viewport.

---

## 2. Documented Assumptions for Underspecified Requirements

| Area | My Assumption | Engineering Rationale |
| :--- | :--- | :--- |
| **Pincode Resolution** | Fall back to nearest neighboring pole's pincode via Haversine distance when `pincode` is `null` (~3%). | Ensures 100% of incident tickets contain a valid PIN code for navigation without calling external paid APIs. |
| **Grid Seeding PRNG** | Fixed Mulberry32 PRNG seed (`GRID_SEED = 42`) generating ~2,648 poles across 55 DTs. | Guarantees 100% reproducible grid layout across seed restarts and Docker containers. |
| **Staleness Window** | $21\text{ minutes}$ threshold ($15\text{m heartbeat} + 45\text{s jitter} + 5\text{m buffer}$). | Prevents false positive alarms during transient cellular tower handoffs while detecting firmware 1.2.x silent outages. |
| **Outage Buffer** | $\pm 30\text{ minutes}$ window for scheduled outages. | Accounts for real-world maintenance start delays and overruns. |

---

## 3. What I Would Do With Two More Weeks

1. **Persistent Redis Debounce Queue**: Move in-memory debounce timers and staleness watchdog sweeps to Redis / BullMQ for multi-replica horizontal scaling.
2. **Server-Sent Events (SSE)**: Replace 4-second HTTP polling with `@fastify/websocket` for $<100\text{ ms}$ real-time push updates.
3. **Machine Learning Voltage Sag Warning**: Analyze continuous `battery_mv` and `rssi` voltage sag patterns to predict pole line failures before physical wire snaps occur.
4. **PostGIS Polygon Bounding Boxes**: Compute exact minimum convex hulls around affected poles for polygon rendering on Leaflet maps.

---

## 4. Currently Fragile or Known Edge Case Areas

1. **Parallel Lines on Opposing Sides of Road**: For undigitized lines (`topology_source: "inferred"`), Prim's MST can occasionally connect poles across a narrow street if they are geographically closer than the next sequential pole down the road.
2. **Process Memory Timer Survival**: Active 45s debounce timers are stored in JS process memory. A backend container crash during an active 45s window will lose the pending timer until the next telemetry update or staleness sweep occurs.
