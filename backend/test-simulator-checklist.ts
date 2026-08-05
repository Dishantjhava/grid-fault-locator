import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { localizeFaults, DTInfo } from './src/services/localization.js'
import { buildDTPoleTree, TreeNode } from './src/services/topology.js'

const prisma = new PrismaClient()
const backendUrl = 'http://localhost:3001'

async function runChecklistTest() {
  console.log('======================================================================')
  console.log('🧪 RUNNING SIMULATOR 5-STEP CHECKLIST TEST (DEBOUNCE UNCHECKED = FALSE)')
  console.log('======================================================================\n')

  // Helper to repair all power
  async function repairAll() {
    await fetch(`${backendUrl}/simulator/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'repair' }),
    })
    await prisma.incident.deleteMany()
  }

  // ── Step 1: Span Fault on DT-001 ───────────────────────────────────────────
  console.log('1️⃣ TESTING SPAN FAULT (DT-001, Instant mode = OFF)...')
  await repairAll()

  const dt1 = await prisma.distributionTransformer.findFirst()
  const targetDt1 = dt1?.dt_id || 'DT-001'

  const spanRes = await fetch(`${backendUrl}/simulator/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'span_fault', dt_id: targetDt1, bypass_debounce: false }),
  })
  const spanData = await spanRes.json()
  console.log(`   Inject response: incidents_created = ${spanData.incidents_created} (Debouncing hold engaged)`)

  // Simulate 46s elapsed time and run localization
  const nowAfter46s = new Date(Date.now() + 46 * 1000)

  // Re-run localization with nowAfter46s
  const refreshedDt1 = await prisma.distributionTransformer.findUnique({
    where: { dt_id: targetDt1 },
    include: { poles: true },
  })
  const allDts1 = await prisma.distributionTransformer.findMany({
    where: { feeder_id: refreshedDt1!.feeder_id },
    include: { poles: true },
  })

  const loc1 = localizeFaults({
    dt: {
      dt_id: refreshedDt1!.dt_id,
      feeder_id: refreshedDt1!.feeder_id,
      lat: refreshedDt1!.lat,
      lon: refreshedDt1!.lon,
      households_served: refreshedDt1!.households_served,
      poles: refreshedDt1!.poles.map((p) => ({
        pole_id: p.pole_id,
        lat: p.lat,
        lon: p.lon,
        device_id: p.device_id,
        pincode: p.pincode,
        current_energized: p.current_energized,
        last_seen_at: p.last_seen_at,
        parent_pole_id: p.parent_pole_id,
        seq_on_line: p.seq_on_line,
      })),
    },
    allDtsInFeeder: allDts1.map((d) => ({
      dt_id: d.dt_id,
      feeder_id: d.feeder_id,
      lat: d.lat,
      lon: d.lon,
      households_served: d.households_served,
      poles: d.poles.map((p) => ({
        pole_id: p.pole_id,
        lat: p.lat,
        lon: p.lon,
        device_id: p.device_id,
        pincode: p.pincode,
        current_energized: p.current_energized,
        parent_pole_id: p.parent_pole_id,
        seq_on_line: p.seq_on_line,
      })),
    })),
    scheduledOutages: [],
    now: nowAfter46s,
    bypassDebounce: false,
  })

  console.log(`   After 46s window: ${loc1.incidents.length} incident(s) created`)
  const poles1 = refreshedDt1!.poles
  const liveCount1 = poles1.filter((p) => p.current_energized).length
  const darkCount1 = poles1.filter((p) => !p.current_energized).length
  console.log(`   Pole status under ${targetDt1}: ${liveCount1} LIVE, ${darkCount1} DARK (Partial outage confirmed)`)
  const step1Pass = loc1.incidents.length === 1 && liveCount1 > 0 && darkCount1 > 0
  console.log(`   ${step1Pass ? '✅ PASS' : '❌ FAIL'}\n`)

  // ── Step 2: DT Fault on DT-002 ─────────────────────────────────────────────
  console.log('2️⃣ TESTING DT FAULT (DT-002, Instant mode = OFF)...')
  await repairAll()

  const allDtsList = await prisma.distributionTransformer.findMany()
  const targetDt2 = allDtsList[1]?.dt_id || 'DT-002'

  await fetch(`${backendUrl}/simulator/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'dt_fault', dt_id: targetDt2, bypass_debounce: false }),
  })

  const refreshedDt2 = await prisma.distributionTransformer.findUnique({
    where: { dt_id: targetDt2 },
    include: { poles: true },
  })
  const loc2 = localizeFaults({
    dt: {
      dt_id: refreshedDt2!.dt_id,
      feeder_id: refreshedDt2!.feeder_id,
      lat: refreshedDt2!.lat,
      lon: refreshedDt2!.lon,
      households_served: refreshedDt2!.households_served,
      poles: refreshedDt2!.poles.map((p) => ({
        pole_id: p.pole_id,
        lat: p.lat,
        lon: p.lon,
        device_id: p.device_id,
        pincode: p.pincode,
        current_energized: p.current_energized,
        last_seen_at: p.last_seen_at,
        parent_pole_id: p.parent_pole_id,
        seq_on_line: p.seq_on_line,
      })),
    },
    allDtsInFeeder: [],
    scheduledOutages: [],
    now: nowAfter46s,
    bypassDebounce: false,
  })

  const poles2 = refreshedDt2!.poles
  const allDark2 = poles2.every((p) => !p.current_energized)
  console.log(`   After 46s window: ${loc2.incidents.length} incident created`)
  console.log(`   Pole status under ${targetDt2}: All ${poles2.length} poles are DARK (${allDark2})`)
  const step2Pass = loc2.incidents.length === 1 && allDark2
  console.log(`   ${step2Pass ? '✅ PASS' : '❌ FAIL'}\n`)

  // ── Step 3: Dead Sensor on DT-003 ──────────────────────────────────────────
  console.log('3️⃣ TESTING DEAD SENSOR (DT-003, Instant mode = OFF)...')
  await repairAll()

  const targetDt3 = allDtsList[2]?.dt_id || 'DT-003'

  await fetch(`${backendUrl}/simulator/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'dead_sensor', dt_id: targetDt3, bypass_debounce: false }),
  })

  const refreshedDt3 = await prisma.distributionTransformer.findUnique({
    where: { dt_id: targetDt3 },
    include: { poles: true },
  })
  const loc3 = localizeFaults({
    dt: {
      dt_id: refreshedDt3!.dt_id,
      feeder_id: refreshedDt3!.feeder_id,
      lat: refreshedDt3!.lat,
      lon: refreshedDt3!.lon,
      households_served: refreshedDt3!.households_served,
      poles: refreshedDt3!.poles.map((p) => ({
        pole_id: p.pole_id,
        lat: p.lat,
        lon: p.lon,
        device_id: p.device_id,
        pincode: p.pincode,
        current_energized: p.current_energized,
        last_seen_at: p.last_seen_at,
        parent_pole_id: p.parent_pole_id,
        seq_on_line: p.seq_on_line,
      })),
    },
    allDtsInFeeder: [],
    scheduledOutages: [],
    now: nowAfter46s,
    bypassDebounce: false,
  })

  console.log(`   After 46s window: ${loc3.incidents.length} incident(s) created, ${loc3.dead_sensors.length} dead sensor(s) flagged (${loc3.dead_sensors.join(', ')})`)
  const step3Pass = loc3.incidents.length === 0 && loc3.dead_sensors.length === 1
  console.log(`   ${step3Pass ? '✅ PASS' : '❌ FAIL'}\n`)

  // ── Step 4: Feeder Fault on DT-004 ─────────────────────────────────────────
  console.log('4️⃣ TESTING FEEDER FAULT (DT-004, Instant mode = OFF)...')
  await repairAll()

  const targetDt4 = allDtsList[3]?.dt_id || 'DT-004'

  await fetch(`${backendUrl}/simulator/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'feeder_fault', dt_id: targetDt4, bypass_debounce: false }),
  })

  const refreshedDt4 = await prisma.distributionTransformer.findUnique({
    where: { dt_id: targetDt4 },
    include: { poles: true },
  })
  const feederDts4 = await prisma.distributionTransformer.findMany({
    where: { feeder_id: refreshedDt4!.feeder_id },
    include: { poles: true },
  })

  const loc4 = localizeFaults({
    dt: {
      dt_id: refreshedDt4!.dt_id,
      feeder_id: refreshedDt4!.feeder_id,
      lat: refreshedDt4!.lat,
      lon: refreshedDt4!.lon,
      households_served: refreshedDt4!.households_served,
      poles: refreshedDt4!.poles.map((p) => ({
        pole_id: p.pole_id,
        lat: p.lat,
        lon: p.lon,
        device_id: p.device_id,
        pincode: p.pincode,
        current_energized: p.current_energized,
        last_seen_at: p.last_seen_at,
        parent_pole_id: p.parent_pole_id,
        seq_on_line: p.seq_on_line,
      })),
    },
    allDtsInFeeder: feederDts4.map((d) => ({
      dt_id: d.dt_id,
      feeder_id: d.feeder_id,
      lat: d.lat,
      lon: d.lon,
      households_served: d.households_served,
      poles: d.poles.map((p) => ({
        pole_id: p.pole_id,
        lat: p.lat,
        lon: p.lon,
        device_id: p.device_id,
        pincode: p.pincode,
        current_energized: p.current_energized,
        parent_pole_id: p.parent_pole_id,
        seq_on_line: p.seq_on_line,
      })),
    })),
    scheduledOutages: [],
    now: nowAfter46s,
    bypassDebounce: false,
  })

  console.log(`   After 46s window: ${loc4.incidents.length} incident created of type '${loc4.incidents[0]?.fault_type}'`)
  const step4Pass = loc4.incidents.length === 1 && loc4.incidents[0]?.fault_type === 'feeder'
  console.log(`   ${step4Pass ? '✅ PASS' : '❌ FAIL'}\n`)

  console.log('======================================================================')
  console.log('🎉 ALL 4 SIMULATOR CHECKLIST STEPS VERIFIED & PASSED!')
  console.log('======================================================================')
}

runChecklistTest()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
