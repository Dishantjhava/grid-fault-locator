import { describe, it, expect } from 'vitest'
import { localizeFaults, DTInfo, PoleState } from '../src/services/localization.js'
import { identifyStalePoles, STALENESS_THRESHOLD_MS } from '../src/services/staleness.js'

describe('Fix 1 — Silent-Device Staleness Watchdog & Localization', () => {
  const baseDt: DTInfo = {
    dt_id: 'DT-301',
    feeder_id: 'SUB-N-F1',
    lat: 12.97,
    lon: 77.59,
    households_served: 150,
    poles: [],
  }

  const now = new Date('2026-08-04T12:00:00Z')

  it('1. Firmware 1.2 style pole (heartbeats stop >21m ago, no power_lost event): should be included in fault incident', () => {
    const lastSeen25m = new Date(now.getTime() - 25 * 60 * 1000)
    const lastSeen1m = new Date(now.getTime() - 1 * 60 * 1000)

    const poles: PoleState[] = [
      {
        pole_id: 'P1',
        lat: 12.97,
        lon: 77.59,
        device_id: 'DEV-1',
        pincode: '560001',
        current_energized: true,
        last_seen_at: lastSeen1m,
        parent_pole_id: null,
        seq_on_line: 0,
      },
      {
        pole_id: 'P2',
        lat: 12.971,
        lon: 77.59,
        device_id: 'DEV-2', // Legacy FW 1.2.x sensor! Never sent power_lost
        pincode: '560001',
        current_energized: true, // Still true in DB!
        last_seen_at: lastSeen25m, // STALE! > 21 min
        parent_pole_id: 'P1',
        seq_on_line: 1,
      },
      {
        pole_id: 'P3',
        lat: 12.972,
        lon: 77.59,
        device_id: 'DEV-3',
        pincode: '560001',
        current_energized: true,
        last_seen_at: lastSeen25m, // STALE!
        parent_pole_id: 'P2',
        seq_on_line: 2,
      },
    ]

    const staleIds = identifyStalePoles(poles, now, STALENESS_THRESHOLD_MS)
    expect(staleIds.sort()).toEqual(['P2', 'P3'])

    const result = localizeFaults({
      dt: { ...baseDt, poles },
      now,
    })

    expect(result.incidents.length).toBe(1)
    const inc = result.incidents[0]
    expect(inc.fault_type).toBe('span')
    expect(inc.boundary_pole_id).toBe('P1')
    expect(inc.first_dark_pole_id).toBe('P2')
    expect(inc.affected_pole_ids.sort()).toEqual(['P2', 'P3'])

    expect(inc.confidence_reason).toContain(
      'inferred from silent device staleness (no heartbeat for >21 min)'
    )
  })

  it('2. Stale pole with live downstream children: should route to dead_sensors, NOT create a fault incident', () => {
    const lastSeen25m = new Date(now.getTime() - 25 * 60 * 1000)
    const lastSeen1m = new Date(now.getTime() - 1 * 60 * 1000)

    const poles: PoleState[] = [
      {
        pole_id: 'P1',
        lat: 12.97,
        lon: 77.59,
        device_id: 'DEV-1',
        pincode: '560001',
        current_energized: true,
        last_seen_at: lastSeen1m,
        parent_pole_id: null,
        seq_on_line: 0,
      },
      {
        pole_id: 'P2',
        lat: 12.971,
        lon: 77.59,
        device_id: 'DEV-2',
        pincode: '560001',
        current_energized: true,
        last_seen_at: lastSeen25m, // Stale sensor / dead modem!
        parent_pole_id: 'P1',
        seq_on_line: 1,
      },
      {
        pole_id: 'P3',
        lat: 12.972,
        lon: 77.59,
        device_id: 'DEV-3',
        pincode: '560001',
        current_energized: true, // Downstream child is LIVE!
        last_seen_at: lastSeen1m,
        parent_pole_id: 'P2',
        seq_on_line: 2,
      },
    ]

    const result = localizeFaults({
      dt: { ...baseDt, poles },
      now,
    })

    expect(result.incidents.length).toBe(0)
    expect(result.dead_sensors).toEqual(['P2'])
  })

  it('3. Under-threshold pole (silent for 10 min): should NOT be flagged as stale, 0 premature incidents', () => {
    const lastSeen10m = new Date(now.getTime() - 10 * 60 * 1000)

    const poles: PoleState[] = [
      {
        pole_id: 'P1',
        lat: 12.97,
        lon: 77.59,
        device_id: 'DEV-1',
        pincode: '560001',
        current_energized: true,
        last_seen_at: lastSeen10m,
        parent_pole_id: null,
        seq_on_line: 0,
      },
    ]

    const staleIds = identifyStalePoles(poles, now, STALENESS_THRESHOLD_MS)
    expect(staleIds.length).toBe(0)

    const result = localizeFaults({
      dt: { ...baseDt, poles },
      now,
    })

    expect(result.incidents.length).toBe(0)
  })

  it('4. Exact threshold boundary test: 20m44s is NOT stale, 21m00s IS stale', () => {
    const lastSeen20m44s = new Date(now.getTime() - (20 * 60 * 1000 + 44 * 1000))
    const lastSeen21m00s = new Date(now.getTime() - 21 * 60 * 1000)

    const poleNotStale: PoleState = {
      pole_id: 'P_BORDER_1',
      lat: 12.97,
      lon: 77.59,
      device_id: 'DEV-B1',
      pincode: '560001',
      current_energized: true,
      last_seen_at: lastSeen20m44s,
      parent_pole_id: null,
      seq_on_line: 0,
    }

    const poleStale: PoleState = {
      pole_id: 'P_BORDER_2',
      lat: 12.971,
      lon: 77.59,
      device_id: 'DEV-B2',
      pincode: '560001',
      current_energized: true,
      last_seen_at: lastSeen21m00s,
      parent_pole_id: null,
      seq_on_line: 1,
    }

    const checkResult1 = identifyStalePoles([poleNotStale], now, STALENESS_THRESHOLD_MS)
    expect(checkResult1).toEqual([])

    const checkResult2 = identifyStalePoles([poleStale], now, STALENESS_THRESHOLD_MS)
    expect(checkResult2).toEqual(['P_BORDER_2'])
  })

  it('5. Single stale leaf pole ambiguity: should output reduced confidence and ambiguity rationale text', () => {
    const lastSeen25m = new Date(now.getTime() - 25 * 60 * 1000)
    const lastSeen1m = new Date(now.getTime() - 1 * 60 * 1000)

    // P1 (live) -> P2 (stale leaf pole with NO children)
    const poles: PoleState[] = [
      {
        pole_id: 'P1',
        lat: 12.97,
        lon: 77.59,
        device_id: 'DEV-1',
        pincode: '560001',
        current_energized: true,
        last_seen_at: lastSeen1m,
        parent_pole_id: null,
        seq_on_line: 0,
      },
      {
        pole_id: 'P2',
        lat: 12.971,
        lon: 77.59,
        device_id: 'DEV-2',
        pincode: '560001',
        current_energized: true,
        last_seen_at: lastSeen25m, // Stale leaf pole!
        parent_pole_id: 'P1',
        seq_on_line: 1,
      },
    ]

    const result = localizeFaults({ dt: { ...baseDt, poles }, now })

    expect(result.incidents.length).toBe(1)
    const inc = result.incidents[0]
    expect(inc.affected_pole_ids).toEqual(['P2'])
    expect(inc.confidence).toBeLessThanOrEqual(0.75) // Reduced confidence due to leaf ambiguity
    expect(inc.confidence_reason).toContain('Ambiguity Notice: Single stale leaf pole')
  })

  it('6. Flip-flop recovery: late heartbeat un-flags stale pole and clears fault incident', () => {
    const lastSeen25m = new Date(now.getTime() - 25 * 60 * 1000)
    const lastSeenJustNow = new Date(now.getTime())

    // Step 1: Stale state
    const stalePoles: PoleState[] = [
      {
        pole_id: 'P1',
        lat: 12.97,
        lon: 77.59,
        device_id: 'DEV-1',
        pincode: '560001',
        current_energized: true,
        last_seen_at: new Date(now.getTime() - 1 * 60 * 1000),
        parent_pole_id: null,
        seq_on_line: 0,
      },
      {
        pole_id: 'P2',
        lat: 12.971,
        lon: 77.59,
        device_id: 'DEV-2',
        pincode: '560001',
        current_energized: true,
        last_seen_at: lastSeen25m, // Stale
        parent_pole_id: 'P1',
        seq_on_line: 1,
      },
    ]

    const initialResult = localizeFaults({ dt: { ...baseDt, poles: stalePoles }, now })
    expect(initialResult.incidents.length).toBe(1)

    // Step 2: Late heartbeat arrives from P2!
    const recoveredPoles: PoleState[] = [
      stalePoles[0],
      {
        ...stalePoles[1],
        last_seen_at: lastSeenJustNow, // Heartbeat received!
      },
    ]

    const recoveredResult = localizeFaults({ dt: { ...baseDt, poles: recoveredPoles }, now })
    expect(recoveredResult.stale_poles_detected.length).toBe(0)
    expect(recoveredResult.incidents.length).toBe(0) // No lingering incident!
  })

  it('7. Combined fault: explicit power_lost on P2 + silent staleness on P3 in SAME line break should group into ONE incident', () => {
    const lastSeen25m = new Date(now.getTime() - 25 * 60 * 1000)
    const lastSeen1m = new Date(now.getTime() - 1 * 60 * 1000)

    // P1 (live) -> P2 (sent explicit power_lost, current_energized: false) -> P3 (FW 1.2 silent, current_energized: true in DB, but last_seen 25m ago)
    const poles: PoleState[] = [
      {
        pole_id: 'P1',
        lat: 12.97,
        lon: 77.59,
        device_id: 'DEV-1',
        pincode: '560001',
        current_energized: true,
        last_seen_at: lastSeen1m,
        parent_pole_id: null,
        seq_on_line: 0,
      },
      {
        pole_id: 'P2',
        lat: 12.971,
        lon: 77.59,
        device_id: 'DEV-2',
        pincode: '560001',
        current_energized: false, // Sent explicit power_lost!
        last_seen_at: lastSeen1m,
        parent_pole_id: 'P1',
        seq_on_line: 1,
      },
      {
        pole_id: 'P3',
        lat: 12.972,
        lon: 77.59,
        device_id: 'DEV-3', // FW 1.2 silent pole
        pincode: '560001',
        current_energized: true,
        last_seen_at: lastSeen25m, // Stale!
        parent_pole_id: 'P2',
        seq_on_line: 2,
      },
    ]

    const result = localizeFaults({ dt: { ...baseDt, poles }, now })

    // MUST group both P2 and P3 into EXACTLY ONE single incident!
    expect(result.incidents.length).toBe(1)
    const inc = result.incidents[0]
    expect(inc.boundary_pole_id).toBe('P1')
    expect(inc.first_dark_pole_id).toBe('P2')
    expect(inc.affected_pole_ids.sort()).toEqual(['P2', 'P3'])
  })
})
