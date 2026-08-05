# AI Engineering Workflow & Tooling Audit (`AI-WORKFLOW.md`)

> **An honest write-up of how I used AI tools, where I drew the line, where AI was wrong, and what I had to throw away.**

---

## 1. Tooling Strategy & AI Stack Utilized

### The AI Stack I Used:
- **Claude 3.5 Sonnet**: Used for fast boilerplating of Fastify plugin routes, Prisma schema definitions, Leaflet map component layouts, and Vitest test case scaffolding.
- **Gemini Flash & Antigravity Agentic IDE**: Used for automated browser subagent testing, UI visual verification capture, background load test execution, and multi-step workflow coordination.
- **ChatGPT (GPT-4o)**: Used for mathematical verification of Haversine geographic distance formulas, Mulberry32 PRNG seed tuning, and Prim's MST algorithm edge case analysis.

---

### How I Drew the Line Between AI and Human Work:

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                     DELEGATED TO AI (BOILERPLATE & UI)                   │
 │  - Fastify route registration & JSON Schema validation boilerplate        │
 │  - Prisma schema model definitions & migration commands                   │
 │  - React UI component JSX layout & Tailwind CSS styling                  │
 │  - Lucide React icon imports & Leaflet map tile setup                     │
 │  - Browser subagent UI regression testing & screenshot captures          │
 └──────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                     MANUALLY ENGINEERED (HUMAN)                          │
 │  - Deterministic fault localization tree traversal logic (localization.ts)│
 │  - Prim's MST geographic tree construction algorithm (topology.ts)       │
 │  - Hardware sequence counter (seq > last_seq) deduplication logic        │
 │  - Dead sensor identification math (child-live subtree check)            │
 │  - Telemetry resolution verification state machine (verification.ts)    │
 └──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Three Concrete Cases Where AI Was Wrong & How I Caught It

### Case 1: AI Suggested Using an LLM for Graph Fault Localization
- **What AI Suggested**: Prompting GPT-4 to accept the raw array of dark pole IDs and JSON telemetry events to return the fault location.
- **Why It Was Wrong**: Non-deterministic, expensive, slow ($1.5\text{s}+$ latency), hallucinated non-existent pole IDs, and failed to consistently group multiple simultaneous faults.
- **How I Caught It**: Unit testing revealed that LLM prompt responses varied between runs on identical inputs.
- **My Fix**: I threw away LLM localization entirely. Replaced it with a 100% deterministic, instant ($<1.5\text{ ms}$), explainable depth-first search tree traversal algorithm.

### Case 2: AI Used Timestamp (`ts`) for Telemetry Ordering
- **What AI Suggested**: Sorting telemetry events using `new Date(payload.ts)`.
- **Why It Was Wrong**: Ignored the brief's critical constraint: edge IoT device clocks drift by up to $\pm 90\text{ seconds}$ and firmware resets clock to 1970-01-01 on cold boot. Ordering by `ts` resulted in out-of-order state updates overwriting fresh telemetry with stale data.
- **How I Caught It**: Load testing with simulated clock skew showed newer state updates being ignored.
- **My Fix**: Enforced strict monotonic ordering using `seq` (the hardware packet sequence counter) per `device_id`.

### Case 3: AI Created One Alert Per Dark Pole (No Symptom Grouping)
- **What AI Suggested**: Iterating over all dark poles and creating an `Incident` row for every pole reporting `energized: false`.
- **Why It Was Wrong**: A single line break on a 50-pole DT produced 50 separate alerts, overwhelming the control room operator console.
- **How I Caught It**: Simulator testing showed 50 red badges appearing in the sidebar for one wire break.
- **My Fix**: Replaced single-pole alerting with downstream subtree grouping (`collectSubtreePoleIds`), collapsing all 50 dark poles into **1 single incident ticket** anchored to the $(P_{\text{live}}, P_{\text{dark}})$ boundary.

---

## 3. Code Provenance Estimate

- **Total AI-Generated Code**: **~70%** (Boilerplate schema, API routes, React UI layouts, simulator CSS).
- **Total Manually Engineered / Refactored Code**: **~30%** (Core localization algorithm, Prim's MST tree builder, staleness watchdog logic, telemetry verification state machine).

---

## 4. Prompts I Consider My Best Work

### Prompt for Dual Topology Minimum Spanning Tree:
> *"Implement a TypeScript function `buildDTPoleTree(dt, poles)` that checks if poles have `seq_on_line` and `parent_pole_id` populated. If populated, build a parent-child tree directly. If `parent_pole_id` is missing (null), compute a Minimum Spanning Tree using Prim's algorithm rooted at `(dt.lat, dt.lon)` using Haversine geographic distance in meters as edge weights. Return the root node and node map."*

### Prompt for Telemetry Verification State Machine:
> *"Write a function `verifyIncidentResolution(incident, poles)` that takes an incident ticket and a list of current pole states. If incident status is not 'resolved', return current status. If status is 'resolved', check if 100% of affected_pole_ids have current_energized === true. If all are true, return verified: true and auto-advance current_status to 'closed'. If any pole is dark, return verified: false and keep current_status as 'resolved'."*

---

## 5. Line-by-Line Code Ownership Readiness

I have reviewed, tested, and understood every line of code in this repository. I am completely ready to explain any function, data structure, or algorithm line-by-line during the technical review call.
