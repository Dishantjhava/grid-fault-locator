import { describe, it, expect } from 'vitest'
import {
  localizeFaults,
  DTInfo,
  PoleState,
  ScheduledOutageInfo,
} from '../src/services/localization.js'

describe('Fault Localization & Boundary Finding (Phase 3b)', () => {
  const baseDt: DTInfo = {
    dt_id: 'DT-101',
    feeder_id: 'SUB-N-F1',
    lat: 12.97,
    lon: 77.59,
    households_served: 200,
    poles: [],
  }

  it('1. Single span fault: should isolate exact boundary pole and dark subtree', () => {
    // 4 poles in a line: P1 (live) -> P2 (live) -> P3 (dark) -> P4 (dark)
    const poles: PoleState[] = [
      {
        pole_id: 'P1',
        lat: 12.97,
        lon: 77.59,
        device_id: 'DEV-1',
        pincode: '560001',
        current_energized: true,
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
        parent_pole_id: 'P1',
        seq_on_line: 1,
      },
      {
        pole_id: 'P3',
        lat: 12.972,
        lon: 77.59,
        device_id: 'DEV-3',
        pincode: '560001',
        current_energized: false,
        parent_pole_id: 'P2',
        seq_on_line: 2,
      },
      {
        pole_id: 'P4',
        lat: 12.973,
        lon: 77.59,
        device_id: 'DEV-4',
        pincode: '560001',
        current_energized: false,
        parent_pole_id: 'P3',
        seq_on_line: 3,
      },
    ]

    const result = localizeFaults({ dt: { ...baseDt, poles } })

    expect(result.incidents.length).toBe(1)
    const inc = result.incidents[0]
    expect(inc.fault_type).toBe('span')
    expect(inc.boundary_pole_id).toBe('P2') // P2 is last live pole
    expect(inc.first_dark_pole_id).toBe('P3') // P3 is first dark pole
    expect(inc.affected_pole_ids.sort()).toEqual(['P3', 'P4'])
    expect(inc.confidence).toBe(1.0)
    expect(result.dead_sensors.length).toBe(0)
  })

  it('2. DT-wide fault: should classify as DT fault when all poles under DT are dark', () => {
    const poles: PoleState[] = [
      {
        pole_id: 'P1',
        lat: 12.97,
        lon: 77.59,
        device_id: 'DEV-1',
        pincode: '560001',
        current_energized: false,
        parent_pole_id: null,
        seq_on_line: 0,
      },
      {
        pole_id: 'P2',
        lat: 12.971,
        lon: 77.59,
        device_id: 'DEV-2',
        pincode: '560001',
        current_energized: false,
        parent_pole_id: 'P1',
        seq_on_line: 1,
      },
    ]

    const result = localizeFaults({ dt: { ...baseDt, poles } })

    expect(result.incidents.length).toBe(1)
    expect(result.incidents[0].fault_type).toBe('dt')
    expect(result.incidents[0].affected_pole_ids.sort()).toEqual(['P1', 'P2'])
    expect(result.incidents[0].households_affected).toBe(200)
  })

  it('3. Feeder-wide fault: should classify as feeder fault when all DTs in feeder are dark', () => {
    const dt1Poles: PoleState[] = [
      {
        pole_id: 'P1',
        lat: 12.97,
        lon: 77.59,
        device_id: 'DEV-1',
        pincode: '560001',
        current_energized: false,
        parent_pole_id: null,
        seq_on_line: 0,
      },
    ]
    const dt2Poles: PoleState[] = [
      {
        pole_id: 'P2',
        lat: 12.98,
        lon: 77.59,
        device_id: 'DEV-2',
        pincode: '560001',
        current_energized: false,
        parent_pole_id: null,
        seq_on_line: 0,
      },
    ]

    const dt1: DTInfo = { ...baseDt, dt_id: 'DT-1', poles: dt1Poles }
    const dt2: DTInfo = { ...baseDt, dt_id: 'DT-2', poles: dt2Poles }

    const result = localizeFaults({
      dt: dt1,
      allDtsInFeeder: [dt1, dt2],
    })

    expect(result.incidents.length).toBe(1)
    expect(result.incidents[0].fault_type).toBe('feeder')
  })

  it('4. Lone dead sensor: dark pole with live downstream children should NOT trigger incident', () => {
    // P1 (live) -> P2 (DARK SENSOR!) -> P3 (live)
    const poles: PoleState[] = [
      {
        pole_id: 'P1',
        lat: 12.97,
        lon: 77.59,
        device_id: 'DEV-1',
        pincode: '560001',
        current_energized: true,
        parent_pole_id: null,
        seq_on_line: 0,
      },
      {
        pole_id: 'P2',
        lat: 12.971,
        lon: 77.59,
        device_id: 'DEV-2',
        pincode: '560001',
        current_energized: false, // Broken sensor!
        parent_pole_id: 'P1',
        seq_on_line: 1,
      },
      {
        pole_id: 'P3',
        lat: 12.972,
        lon: 77.59,
        device_id: 'DEV-3',
        pincode: '560001',
        current_energized: true, // downstream is energized!
        parent_pole_id: 'P2',
        seq_on_line: 2,
      },
    ]

    const result = localizeFaults({ dt: { ...baseDt, poles } })

    expect(result.incidents.length).toBe(0) // No grid fault incident!
    expect(result.dead_sensors).toEqual(['P2']) // Flagged as dead sensor
  })

  it('5. Simultaneous double faults: should create two separate incidents for two branch boundaries', () => {
    // Trunk: P1 (live) -> P2 (live)
    // Branch 1 off P2: -> P3 (dark) -> P4 (dark)
    // Branch 2 off P2: -> P5 (dark) -> P6 (dark)
    const poles: PoleState[] = [
      {
        pole_id: 'P1',
        lat: 12.97,
        lon: 77.59,
        device_id: 'DEV-1',
        pincode: '560001',
        current_energized: true,
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
        parent_pole_id: 'P1',
        seq_on_line: 1,
      },
      {
        pole_id: 'P3',
        lat: 12.971,
        lon: 77.591,
        device_id: 'DEV-3',
        pincode: '560001',
        current_energized: false,
        parent_pole_id: 'P2',
        seq_on_line: 2,
      },
      {
        pole_id: 'P4',
        lat: 12.971,
        lon: 77.592,
        device_id: 'DEV-4',
        pincode: '560001',
        current_energized: false,
        parent_pole_id: 'P3',
        seq_on_line: 3,
      },
      {
        pole_id: 'P5',
        lat: 12.971,
        lon: 77.589,
        device_id: 'DEV-5',
        pincode: '560001',
        current_energized: false,
        parent_pole_id: 'P2',
        seq_on_line: 4,
      },
      {
        pole_id: 'P6',
        lat: 12.971,
        lon: 77.588,
        device_id: 'DEV-6',
        pincode: '560001',
        current_energized: false,
        parent_pole_id: 'P5',
        seq_on_line: 5,
      },
    ]

    const result = localizeFaults({ dt: { ...baseDt, poles } })

    expect(result.incidents.length).toBe(2)
    const darkFirstPoles = result.incidents.map((i) => i.first_dark_pole_id).sort()
    expect(darkFirstPoles).toEqual(['P3', 'P5'])
  })

  it('6. Boundary pole with no device: should output range and lower confidence score', () => {
    // P1 (live) -> P2 (dark, device_id: null!) -> P3 (dark)
    const poles: PoleState[] = [
      {
        pole_id: 'P1',
        lat: 12.97,
        lon: 77.59,
        device_id: 'DEV-1',
        pincode: '560001',
        current_energized: true,
        parent_pole_id: null,
        seq_on_line: 0,
      },
      {
        pole_id: 'P2',
        lat: 12.971,
        lon: 77.59,
        device_id: null, // NO SENSOR INSTALLED!
        pincode: '560001',
        current_energized: false,
        parent_pole_id: 'P1',
        seq_on_line: 1,
      },
      {
        pole_id: 'P3',
        lat: 12.972,
        lon: 77.59,
        device_id: 'DEV-3',
        pincode: '560001',
        current_energized: false,
        parent_pole_id: 'P2',
        seq_on_line: 2,
      },
    ]

    const result = localizeFaults({ dt: { ...baseDt, poles } })

    expect(result.incidents.length).toBe(1)
    const inc = result.incidents[0]
    expect(inc.boundary_pole_id).toBeNull()
    expect(inc.boundary_pole_range).toEqual(['P1', 'P2'])
    expect(inc.confidence).toBe(0.8) // 1.0 - 0.20 penalty
    expect(inc.confidence_reason).toContain('lacks an IoT sensor')
  })

  it('7. Scheduled Outage: should suppress incident if within outage window +/- 30 min buffer', () => {
    const poles: PoleState[] = [
      {
        pole_id: 'P1',
        lat: 12.97,
        lon: 77.59,
        device_id: 'DEV-1',
        pincode: '560001',
        current_energized: false,
        parent_pole_id: null,
        seq_on_line: 0,
      },
    ]

    const now = new Date('2026-08-04T10:00:00Z')

    const scheduledOutages: ScheduledOutageInfo[] = [
      {
        id: 'OUTAGE-99',
        scope: 'dt',
        target_id: 'DT-101',
        start: new Date('2026-08-04T09:45:00Z'), // Started 15m ago
        end: new Date('2026-08-04T12:00:00Z'),
        reason: 'Transformer maintenance',
      },
    ]

    const result = localizeFaults({
      dt: { ...baseDt, poles },
      scheduledOutages,
      now,
    })

    expect(result.incidents.length).toBe(0) // Suppressed!
    expect(result.suppressed_incidents.length).toBe(1)
    expect(result.suppressed_incidents[0].outage_id).toBe('OUTAGE-99')
    expect(result.suppressed_incidents[0].suppression_reason).toContain(
      'Transformer maintenance'
    )
  })

  it('8. Pincode Fallback: incident boundary pole with null pincode resolves to nearest neighbor pincode', () => {
    const poles: PoleState[] = [
      {
        pole_id: 'P1',
        lat: 12.9700,
        lon: 77.5900,
        device_id: 'DEV-1',
        pincode: null, // Boundary pole has NULL pincode!
        current_energized: true,
        parent_pole_id: null,
        seq_on_line: 0,
      },
      {
        pole_id: 'P2',
        lat: 12.9701,
        lon: 77.5901,
        device_id: 'DEV-2',
        pincode: null, // Dark pole also NULL pincode!
        current_energized: false,
        parent_pole_id: 'P1',
        seq_on_line: 1,
      },
      {
        pole_id: 'P3',
        lat: 12.9702,
        lon: 77.5902,
        device_id: 'DEV-3',
        pincode: '560034', // Neighbor pole under same DT has valid pincode!
        current_energized: true,
        parent_pole_id: 'P1',
        seq_on_line: 2,
      },
    ]

    const result = localizeFaults({ dt: { ...baseDt, poles } })

    expect(result.incidents.length).toBe(1)
    const inc = result.incidents[0]
    expect(inc.boundary_pole_id).toBe('P1')
    expect(inc.first_dark_pole_id).toBe('P2')
    // Pincode MUST resolve to nearest neighbor "560034"!
    expect(inc.pincode).toBe('560034')
  })
})
