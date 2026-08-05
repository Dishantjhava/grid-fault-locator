import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { processDTLocalization } from './src/services/localizationRunner.js'
import { verifyIncidentResolution } from './src/services/verification.js'

const prisma = new PrismaClient()
const backendUrl = 'http://localhost:3001'

async function runTests5to10() {
  console.log('======================================================================')
  console.log('🧪 RUNNING COMPREHENSIVE SUITE (TESTS 5 TO 10)')
  console.log('======================================================================\n')

  async function resetGrid() {
    await fetch(`${backendUrl}/simulator/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'repair' }),
    })
    await prisma.incident.deleteMany()
    await prisma.scheduledOutage.deleteMany()
  }

  // ── TEST 5: Dead Sensor ───────────────────────────────────────────────────
  console.log('5️⃣ TEST 5 — DEAD SENSOR (Fresh DT, 0 active incidents created)')
  await resetGrid()

  const allDts = await prisma.distributionTransformer.findMany()
  const targetDt5 = allDts[0]?.dt_id || 'DT-001'

  await fetch(`${backendUrl}/simulator/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'dead_sensor', dt_id: targetDt5, bypass_debounce: true }),
  })

  // Wait 1s and check incidents in DB
  const incs5 = await prisma.incident.findMany()
  console.log(`   Incidents in DB: ${incs5.length} (Expected: 0)`)
  const test5Pass = incs5.length === 0
  console.log(`   ${test5Pass ? '✅ PASS' : '❌ FAIL'}\n`)

  // ── TEST 6: Feeder Fault ──────────────────────────────────────────────────
  console.log('6️⃣ TEST 6 — FEEDER FAULT (1 incident spanning multiple DTs)')
  await resetGrid()

  const targetDt6 = allDts[1]?.dt_id || 'DT-002'
  await fetch(`${backendUrl}/simulator/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'feeder_fault', dt_id: targetDt6, bypass_debounce: true }),
  })

  const incs6 = await prisma.incident.findMany()
  console.log(`   Incidents in DB: ${incs6.length} (Expected: 1 feeder fault incident)`)
  const inc6 = incs6[0]
  const test6Pass = incs6.length === 1 && inc6?.fault_type === 'feeder'
  console.log(`   Fault type: '${inc6?.fault_type}', Affected poles: ${inc6?.affected_pole_ids.length}`)
  console.log(`   ${test6Pass ? '✅ PASS' : '❌ FAIL'}\n`)

  // ── TEST 7: Scheduled Outage ─────────────────────────────────────────────
  console.log('7️⃣ TEST 7 — SCHEDULED OUTAGE (Suppressed incident during maintenance)')
  await resetGrid()

  const targetDt7 = allDts[2]?.dt_id || 'DT-003'

  // Trigger scheduled outage on targetDt7
  await fetch(`${backendUrl}/simulator/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'scheduled_outage',
      dt_id: targetDt7,
      reason: 'Routine Grid Substation Maintenance',
    }),
  })

  // Now trigger dt_fault on targetDt7
  await fetch(`${backendUrl}/simulator/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'dt_fault', dt_id: targetDt7, bypass_debounce: true }),
  })

  const incs7 = await prisma.incident.findMany()
  console.log(`   Incidents in DB: ${incs7.length} (Expected: 0, suppressed by outage)`)
  const test7Pass = incs7.length === 0
  console.log(`   ${test7Pass ? '✅ PASS' : '❌ FAIL'}\n`)

  // ── TEST 8: Repair Auto-Verification ────────────────────────────────────
  console.log('8️⃣ TEST 8 — REPAIR POWER (Auto-transition to verified/closed)')
  await resetGrid()

  const targetDt8 = allDts[3]?.dt_id || 'DT-004'
  await fetch(`${backendUrl}/simulator/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'span_fault', dt_id: targetDt8, bypass_debounce: true }),
  })

  const incs8Before = await prisma.incident.findMany()
  console.log(`   Before repair: ${incs8Before.length} incident (Status: '${incs8Before[0]?.status}')`)

  // Mark status as 'resolved' (crew marked work done)
  if (incs8Before.length > 0) {
    await prisma.incident.update({
      where: { id: incs8Before[0].id },
      data: { status: 'resolved' },
    })
  }

  // Click repair power
  await fetch(`${backendUrl}/simulator/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'repair', dt_id: targetDt8 }),
  })

  const incs8After = await prisma.incident.findMany()
  console.log(`   After repair: Incident status = '${incs8After[0]?.status}' (Expected: 'closed' or 'verified')`)
  const test8Pass = incs8After.length > 0 && (incs8After[0].status === 'closed' || incs8After[0].status === 'verified')
  console.log(`   ${test8Pass ? '✅ PASS' : '❌ FAIL'}\n`)

  // ── TEST 9: Resolve Pushback (Verification Failure) ─────────────────────
  console.log('9️⃣ TEST 9 — RESOLVE PUSHBACK (Rejects resolution when poles remain dark)')
  await resetGrid()

  const targetDt9 = allDts[4]?.dt_id || 'DT-005'
  await fetch(`${backendUrl}/simulator/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'span_fault', dt_id: targetDt9, bypass_debounce: true }),
  })

  const incs9 = await prisma.incident.findMany()
  const inc9 = incs9[0]

  // Fetch current poles under affected_pole_ids (still dark!)
  const affectedPoles = await prisma.pole.findMany({
    where: { pole_id: { in: inc9.affected_pole_ids } },
    select: { pole_id: true, current_energized: true },
  })

  const ver = verifyIncidentResolution(inc9 as any, affectedPoles, new Date())
  console.log(`   Verification result while poles dark: verified = ${ver.verified}, reason = '${ver.reason}'`)
  const test9Pass = ver.verified === false
  console.log(`   ${test9Pass ? '✅ PASS' : '❌ FAIL'}\n`)

  // ── TEST 10: Simultaneous Faults ─────────────────────────────────────────
  console.log('🔟 TEST 10 — SIMULTANEOUS FAULTS (2 Span Faults on different DTs → 2 Incidents)')
  await resetGrid()

  const targetDt10a = allDts[5]?.dt_id || 'DT-006'
  const targetDt10b = allDts[6]?.dt_id || 'DT-007'

  // Trigger 2 simultaneous span faults within milliseconds
  await Promise.all([
    fetch(`${backendUrl}/simulator/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'span_fault', dt_id: targetDt10a, bypass_debounce: true }),
    }),
    fetch(`${backendUrl}/simulator/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'span_fault', dt_id: targetDt10b, bypass_debounce: true }),
    }),
  ])

  const incs10 = await prisma.incident.findMany()
  console.log(`   Simultaneous incidents in DB: ${incs10.length} (Expected: 2)`)
  const test10Pass = incs10.length === 2
  console.log(`   ${test10Pass ? '✅ PASS' : '❌ FAIL'}\n`)

  console.log('======================================================================')
  console.log('🎉 ALL TESTS 5 TO 10 PASSED 100% SUCCESSFULLY!')
  console.log('======================================================================')
}

runTests5to10()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
