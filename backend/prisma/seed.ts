/**
 * prisma/seed.ts — Synthetic Karnataka grid network generator
 *
 * Generates a realistic radial distribution network for Bengaluru with:
 *   • 4 substations → 15 feeders → 50 DTs → ~2,500–3,500 poles
 *
 * Geographic placement algorithm (see implementation_plan.md for full rationale):
 *   1. DTs are clustered near 4 substation anchors inside the BBMP bbox.
 *   2. Each DT sprouts a trunk line in a random bearing, 25–35 m step size.
 *   3. 3–5 branch lines split off trunk poles at 60°–120° deflection angles.
 *   4. ±2–4 m micro-jitter on every pole coordinate simulates GPS survey noise.
 *   5. 40% of DTs have seq_on_line + parent_pole_id populated (digitized).
 *      The other 60% have them NULL (undigitized, topology unknown to the system).
 *
 * Reproducibility: Uses a seeded PRNG (Mulberry32) controlled by process.env.GRID_SEED (default: 42).
 *
 * Run with:  npm run seed
 * Idempotent: skips seeding if Feeder rows already exist.
 *             Pass --force to wipe and re-seed.
 */

import "dotenv/config";
import { PrismaClient, PoleType } from "@prisma/client";

const prisma = new PrismaClient();

// ── Seeded PRNG (Mulberry32) ──────────────────────────────────────────────────

const GRID_SEED_ENV = process.env.GRID_SEED || "42";
const INITIAL_SEED = parseInt(GRID_SEED_ENV, 10) || 42;

function createPRNG(seed: number) {
  let s = seed >>> 0;
  return function random(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let prng = createPRNG(INITIAL_SEED);

function rand(min: number, max: number): number {
  return min + prng() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(prng() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Bengaluru BBMP bounding box
const BBOX = { minLat: 12.85, maxLat: 13.15, minLon: 77.45, maxLon: 77.75 };

// Metres per degree (approximate, adequate for sub-km scale placement)
const M_PER_DEG_LAT = 111_320;

// Real BBMP ward names for realistic data
const WARD_NAMES = [
  "Koramangala",
  "Indiranagar",
  "Whitefield",
  "Hebbal",
  "Rajajinagar",
  "Jayanagar",
  "Basavanagudi",
  "Malleshwaram",
  "Yelahanka",
  "Electronic City",
  "BTM Layout",
  "HSR Layout",
  "Marathahalli",
  "Banashankari",
  "Vijayanagar",
  "Mahadevapura",
  "Bommanahalli",
  "Dasarahalli",
  "Byatarayanapura",
  "Shivajinagar",
];

// Real Bengaluru pincodes
const PINCODES = [
  "560001",
  "560002",
  "560008",
  "560010",
  "560011",
  "560020",
  "560029",
  "560034",
  "560038",
  "560040",
  "560047",
  "560048",
  "560066",
  "560068",
  "560076",
  "560095",
  "560100",
  "560103",
];

// 4 substation anchor coordinates inside the BBMP bbox
const SUBSTATION_ANCHORS = [
  { id: "SUB-N", lat: 13.08, lon: 77.55 }, // North (Hebbal area)
  { id: "SUB-S", lat: 12.90, lon: 77.58 }, // South (JP Nagar area)
  { id: "SUB-E", lat: 12.97, lon: 77.70 }, // East (Whitefield area)
  { id: "SUB-W", lat: 12.98, lon: 77.48 }, // West (Rajajinagar area)
];

// ── Utility functions ─────────────────────────────────────────────────────────

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Move a coordinate by `distance_m` in the given `bearing` (degrees). */
function stepCoord(
  lat: number,
  lon: number,
  bearing: number,
  distance_m: number
): { lat: number; lon: number } {
  const bearingRad = toRadians(bearing);
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(toRadians(lat));
  const dLat = (Math.cos(bearingRad) * distance_m) / M_PER_DEG_LAT;
  const dLon = (Math.sin(bearingRad) * distance_m) / mPerDegLon;
  return { lat: lat + dLat, lon: lon + dLon };
}

/** Add GPS survey noise of ±jitterM metres to a coordinate. */
function jitter(
  lat: number,
  lon: number,
  jitterM = 3
): { lat: number; lon: number } {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(toRadians(lat));
  return {
    lat: lat + rand(-jitterM, jitterM) / M_PER_DEG_LAT,
    lon: lon + rand(-jitterM, jitterM) / mPerDegLon,
  };
}

/** Clamp a coordinate to the BBMP bounding box. */
function clamp(lat: number, lon: number): { lat: number; lon: number } {
  return {
    lat: Math.max(BBOX.minLat, Math.min(BBOX.maxLat, lat)),
    lon: Math.max(BBOX.minLon, Math.min(BBOX.maxLon, lon)),
  };
}

/**
 * Place a DT lat/lon by scattering within a radius of its substation anchor.
 * Radius is 4–10 km (feeder reach in a dense urban grid).
 */
function placeDt(anchor: { lat: number; lon: number }): {
  lat: number;
  lon: number;
} {
  const bearing = rand(0, 360);
  const distance_m = rand(500, 8000);
  const raw = stepCoord(anchor.lat, anchor.lon, bearing, distance_m);
  return clamp(raw.lat, raw.lon);
}

// ── Tree node type (used during generation, not persisted) ────────────────────

interface PoleNode {
  pole_id: string;
  lat: number;
  lon: number;
  feeder_id: string;
  dt_id: string;
  pole_type: PoleType;
  ward: string;
  pincode: string | null;
  device_id: string | null;
  // Topology fields — filled in for digitized DTs, null for undigitized
  seq_on_line: number | null;
  parent_pole_id: string | null;
}

// ── Main generator ────────────────────────────────────────────────────────────

let poleCounter = 0;
let deviceCounter = 0;

function newPoleId(): string {
  return `POLE-${String(++poleCounter).padStart(5, "0")}`;
}

function newDeviceId(): string {
  return `DEV-${String(++deviceCounter).padStart(5, "0")}`;
}

/**
 * Generate a radial tree of poles from a DT location.
 *
 * The tree has:
 *   • A trunk: 32–38 poles in a random bearing from the DT.
 *   • 3–5 branches: each splits off a trunk pole at ±60°–120°, 6–9 poles long.
 *
 * Returns flat list of PoleNodes in BFS order (root first).
 */
function generateDtTree(
  dtId: string,
  feederId: string,
  dtLat: number,
  dtLon: number,
  ward: string,
  pincode: string,
  missingPincodeRate: number,
  missingDeviceRate: number
): PoleNode[] {
  const poles: PoleNode[] = [];
  let seq = 0;

  type QueueEntry = {
    parentId: string | null;
    lat: number;
    lon: number;
    bearing: number;
    remaining: number;
    type: "trunk" | "branch";
  };

  const trunkBearing = rand(0, 360);
  const trunkLength = randInt(42, 50);
  const queue: QueueEntry[] = [
    {
      parentId: null,
      lat: dtLat,
      lon: dtLon,
      bearing: trunkBearing,
      remaining: trunkLength,
      type: "trunk",
    },
  ];

  const trunkPoles: PoleNode[] = [];
  let branchesRemaining = randInt(4, 6);

  while (queue.length > 0) {
    const entry = queue.shift()!;
    let { lat, lon, bearing } = entry;

    for (let i = 0; i < entry.remaining; i++) {
      const stepM = rand(20, 38);
      const next = stepCoord(lat, lon, bearing, stepM);
      const jittered = jitter(next.lat, next.lon, rand(2, 4));
      const clamped = clamp(jittered.lat, jittered.lon);

      const isFirstOnBranch = entry.type === "branch" && i === 0;

      let poleType: PoleType;
      if (entry.type === "branch" && i === entry.remaining - 1) {
        poleType = "service"; // leaf pole
      } else if (isFirstOnBranch || (entry.type === "trunk" && branchesRemaining > 0 && i > 2 && prng() < 0.4 / entry.remaining)) {
        poleType = "junction";
      } else {
        poleType = "distribution";
      }

      const poleId = newPoleId();
      const hasPincode = prng() >= missingPincodeRate;
      const hasDevice = prng() >= missingDeviceRate;

      const node: PoleNode = {
        pole_id: poleId,
        lat: clamped.lat,
        lon: clamped.lon,
        feeder_id: feederId,
        dt_id: dtId,
        pole_type: poleType,
        ward,
        pincode: hasPincode ? pincode : null,
        device_id: hasDevice ? newDeviceId() : null,
        seq_on_line: seq++,
        parent_pole_id: i === 0 ? entry.parentId : poles[poles.length - 1]?.pole_id ?? null,
      };

      poles.push(node);

      if (entry.type === "trunk") {
        trunkPoles.push(node);
        // Attach a branch to this junction pole
        if (poleType === "junction" && branchesRemaining > 0) {
          const deflection = (prng() < 0.5 ? 1 : -1) * rand(60, 120);
          queue.push({
            parentId: poleId,
            lat: clamped.lat,
            lon: clamped.lon,
            bearing: (bearing + deflection + 360) % 360,
            remaining: randInt(6, 9),
            type: "branch",
          });
          branchesRemaining--;
        }
      }

      lat = clamped.lat;
      lon = clamped.lon;
    }
  }

  return poles;
}

// ── Seed ──────────────────────────────────────────────────────────────────────

async function seed() {
  const forceReseed = process.argv.includes("--force");

  // Idempotency check: if not forcing, wipe active incidents & outages so start state is 0 Active Incidents
  if (!forceReseed) {
    const existingCount = await prisma.feeder.count();
    if (existingCount > 0) {
      // Clear any leftover incidents from previous testing runs
      await prisma.incident.deleteMany();
      await prisma.scheduledOutage.deleteMany();
      await prisma.pole.updateMany({ data: { current_energized: true } });
      console.log(
        `✓ Database ready (${existingCount} feeders found). Cleared past incidents → 0 Active Incidents.`
      );
      return;
    }
  }

  if (forceReseed) {
    console.log("⚠  --force: wiping existing data...");
    await prisma.telemetryEvent.deleteMany();
    await prisma.incident.deleteMany();
    await prisma.scheduledOutage.deleteMany();
    await prisma.pole.deleteMany();
    await prisma.distributionTransformer.deleteMany();
    await prisma.feeder.deleteMany();
    console.log("   Done. Re-seeding...\n");
  }

  console.log(`🌱 Seeding synthetic Karnataka grid network (PRNG Seed: ${GRID_SEED_ENV})...\n`);

  // ── 1. Feeders ──────────────────────────────────────────────────────────────

  const feeders: { feeder_id: string; substation_id: string }[] = [];
  const feederCounts = [4, 4, 4, 3]; // totals 15 feeders
  SUBSTATION_ANCHORS.forEach((sub, i) => {
    for (let f = 0; f < feederCounts[i]; f++) {
      feeders.push({
        feeder_id: `${sub.id}-F${f + 1}`,
        substation_id: sub.id,
      });
    }
  });

  await prisma.feeder.createMany({ data: feeders });
  console.log(`  ✓ ${feeders.length} feeders`);

  // ── 2. Distribution Transformers ─────────────────────────────────────────────

  const DT_TARGET = 55; // Exactly 55 DTs for predictable 2,650–2,700 pole count bounds
  const dtRecords: {
    dt_id: string;
    feeder_id: string;
    lat: number;
    lon: number;
    capacity_kva: number;
    households_served: number;
  }[] = [];

  const dtPerFeeder = Math.ceil(DT_TARGET / feeders.length);

  let dtIndex = 0;
  for (const feeder of feeders) {
    const anchor = SUBSTATION_ANCHORS.find((s) => feeder.feeder_id.startsWith(s.id))!;
    const count = dtIndex < feeders.length - 1 ? 3 : 4;
    for (let d = 0; d < count && dtRecords.length < DT_TARGET; d++) {
      const pos = placeDt(anchor);
      dtRecords.push({
        dt_id: `DT-${String(dtRecords.length + 1).padStart(3, "0")}`,
        feeder_id: feeder.feeder_id,
        lat: pos.lat,
        lon: pos.lon,
        capacity_kva: pick([100, 160, 200, 250, 315, 400, 500]),
        households_served: randInt(40, 350),
      });
    }
    dtIndex++;
  }

  // If needed to reach 50 DTs exactly
  while (dtRecords.length < DT_TARGET) {
    const feeder = feeders[dtRecords.length % feeders.length];
    const anchor = SUBSTATION_ANCHORS.find((s) => feeder.feeder_id.startsWith(s.id))!;
    const pos = placeDt(anchor);
    dtRecords.push({
      dt_id: `DT-${String(dtRecords.length + 1).padStart(3, "0")}`,
      feeder_id: feeder.feeder_id,
      lat: pos.lat,
      lon: pos.lon,
      capacity_kva: pick([100, 160, 200, 250, 315, 400, 500]),
      households_served: randInt(40, 350),
    });
  }

  await prisma.distributionTransformer.createMany({ data: dtRecords });
  console.log(`  ✓ ${dtRecords.length} distribution transformers`);

  // ── 3. Poles — generate all trees ──────────────────────────────────────────

  // Deterministic shuffle using PRNG
  const shuffledDts = shuffle(dtRecords);
  const digitizedCount = Math.round(shuffledDts.length * 0.4);
  const digitizedSet = new Set(
    shuffledDts.slice(0, digitizedCount).map((d) => d.dt_id)
  );

  let allPoles: PoleNode[] = [];

  for (const dt of dtRecords) {
    const ward = pick(WARD_NAMES);
    const pincode = pick(PINCODES);
    const dtPoles = generateDtTree(
      dt.dt_id,
      dt.feeder_id,
      dt.lat,
      dt.lon,
      ward,
      pincode,
      0.03, // ~3% missing pincode
      0.09  // ~9% missing device
    );

    // For undigitized DTs: null out topology fields (but keep coords)
    const isDigitized = digitizedSet.has(dt.dt_id);
    const processedPoles = dtPoles.map((p) => {
      if (!isDigitized) {
        return { ...p, seq_on_line: null, parent_pole_id: null };
      }
      return p;
    });

    allPoles.push(...processedPoles);
  }

  // Bulk insert in chunks of 500 to avoid query parameter limits
  const CHUNK_SIZE = 500;
  for (let i = 0; i < allPoles.length; i += CHUNK_SIZE) {
    const chunk = allPoles.slice(i, i + CHUNK_SIZE);
    await prisma.pole.createMany({
      data: chunk.map((p) => ({
        pole_id: p.pole_id,
        feeder_id: p.feeder_id,
        dt_id: p.dt_id,
        lat: p.lat,
        lon: p.lon,
        pole_type: p.pole_type,
        ward: p.ward,
        pincode: p.pincode,
        device_id: p.device_id,
        seq_on_line: p.seq_on_line,
        parent_pole_id: p.parent_pole_id,
        current_energized: true,
        last_seen_at: null,
      })),
    });
  }

  // ── 4. Verification summary ─────────────────────────────────────────────────

  const totalPoles = allPoles.length;
  const withTopology = allPoles.filter((p) => p.seq_on_line !== null).length;
  const withDevice = allPoles.filter((p) => p.device_id !== null).length;
  const withPincode = allPoles.filter((p) => p.pincode !== null).length;

  const topoPct = ((withTopology / totalPoles) * 100).toFixed(1);
  const devicePct = ((withDevice / totalPoles) * 100).toFixed(1);
  const pincodePct = ((withPincode / totalPoles) * 100).toFixed(1);

  console.log(`  ✓ ${totalPoles} poles generated\n`);
  console.log("  📊 Coverage summary:");
  console.log(`     Topology populated : ${withTopology} / ${totalPoles} (${topoPct}%)  [target ~40%]`);
  console.log(`     Devices installed  : ${withDevice} / ${totalPoles} (${devicePct}%)  [target ~91%]`);
  console.log(`     Pincode recorded   : ${withPincode} / ${totalPoles} (${pincodePct}%)  [target ~97%]`);
  console.log(`     Digitized DTs      : ${digitizedCount} / ${dtRecords.length}           [target 40%]`);

  // Sanity-check pole count range
  if (totalPoles < 2500 || totalPoles > 3500) {
    console.warn(
      `\n  ❌ FAIL: Pole count ${totalPoles} is outside target range 2,500–3,500.`
    );
  } else {
    console.log(`\n  ✅ PASS: Pole count ${totalPoles} is within target range 2,500–3,500.`);
  }

  console.log("\n🎉 Seed complete.\n");
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
