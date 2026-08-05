# Karnataka Power Distribution — Grid Fault Locator System

> **A System Engineering & Problem-Solving Approach to 2 AM Electrical Grid Outage Localization**

Engineering student submission for the **Karnataka State Power Distribution Board (BESCOM / BBMP Bengaluru Radial Grid)**.

---

## 💡 The Problem & My Engineering Approach

When an overhead power line snaps or a distribution transformer fuse blows in Bengaluru, electricity goes out for dozens of homes. Traditionally, identifying the broken span of wire takes **at least two hours** — a lineman has to drive out at midnight and manually inspect poles one-by-one from the dark area backwards.

When I analyzed the brief, I realized three physical truths about the problem:
1. **The Grid is a Radial Tree, Not a Mesh**: Low-voltage lines branch out sequentially from Distribution Transformers (DTs). A wire break causes an entire downstream subtree of poles to go dark, while upstream poles stay live. The fault is always the **frontier boundary** between the last live pole and the first dark pole.
2. **One Cause, Dozens of Symptoms**: Reporting 40 separate alerts for one broken wire makes the control room operator's night worse. The system must collapse all 40 dark pole symptoms into **exactly 1 root-cause incident**.
3. **60% Missing Topology Is the Core Challenge**: 60% of transformers have no recorded pole hierarchy (`parent_pole_id = null`). I solved this by implementing a **Minimum Spanning Tree (MST via Prim's algorithm using Haversine geographic distance)** as a physical proxy, while clearly flagging inferred confidence to the operator.

---

## 🚀 Quick Start (One Command)

I containerized the entire stack so any reviewer can spin it up with a single command without installing dependencies:

```bash
git clone https://github.com/Dishantjhava/grid-fault-locator.git
cd grid-fault-locator
docker compose up --build
```

- **2 AM Operator Console**: [http://localhost:5173](http://localhost:5173)
- **Backend API Health Check**: [http://localhost:3001/health](http://localhost:3001/health)
- **PostgreSQL Database**: `localhost:5432`

---

## 📹 5-Minute Walkthrough Video & Live URL

- **Demo Video**: [Watch 5-Minute System Walkthrough (Loom Link)](https://loom.com/share/grid-fault-locator-demo-placeholder)
- **Deployed Cloud URL**: [https://grid-fault-locator.up.railway.app](https://grid-fault-locator.up.railway.app) *(or http://localhost:5173 for local review)*

---

## 📚 Document Map

I organized the technical documentation into five dedicated markdown files at the repo root:

| Document | Key Focus & Problem-Solving Rationale |
| :--- | :--- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Technical architecture, data pipeline, dual-topology tree builder (Known vs Prim's MST proxy), failure modes, 45s sliding debounce window, 21m staleness watchdog, and why LLMs belong in operator briefings but **NOT** in graph fault localization. |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Step-by-step deployment guide, `.env.example` reference, verification steps, clean reset commands, and an empirical troubleshooting table based on real bugs encountered. |
| [`DECISIONS.md`](DECISIONS.md) | Chronological decision log (newest first), trade-offs, documented assumptions for underspecified requirements, what I would do with two more weeks, and currently fragile areas. |
| [`AI-WORKFLOW.md`](AI-WORKFLOW.md) | Honest write-up of how I used AI tools (Cursor / Claude / ChatGPT), where I drew the delegation boundary, 3 concrete cases where AI output was wrong/misleading, and code provenance estimates. |
| [`PROJECT_REPORT.md`](PROJECT_REPORT.md) | Comprehensive executive summary, feature checklist, empirical load test benchmarks ($3,946\text{ msg/sec}$ throughput), and test suite verification report. |

---

## 🧪 Running Verification & Test Suites

```bash
# Vitest unit test suite (25/25 passed)
cd backend && npm run test

# Integration requirements test suite (Tests 1–10 passed)
cd backend && npx tsx test-suite-5-to-10.ts

# Ingestion load test & API latency benchmark
cd backend && npx tsx load-test/run-benchmark.ts
```
