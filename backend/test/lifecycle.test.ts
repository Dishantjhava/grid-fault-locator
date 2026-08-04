import { describe, it, expect } from 'vitest'
import {
  verifyIncidentResolution,
  IncidentState,
  VerificationPoleState,
} from '../src/services/verification.js'

describe('Incident Ticket Lifecycle & Automated Telemetry Verification (Phase 4)', () => {
  it('1. Mark resolved while a pole is still dark: status MUST stay "resolved", NOT advance to "verified" or "closed"', () => {
    const incident: IncidentState = {
      id: 'INC-SPAN-P1-P2-1001',
      status: 'resolved', // Operator clicked Resolve
      affected_pole_ids: ['P2', 'P3'],
    }

    // P2 is energized, but P3 is STILL DARK!
    const poles: VerificationPoleState[] = [
      { pole_id: 'P2', current_energized: true },
      { pole_id: 'P3', current_energized: false }, // Dark!
    ]

    const result = verifyIncidentResolution(incident, poles)

    // MUST NOT auto-advance to verified or closed while any pole is dark!
    expect(result.verified).toBe(false)
    expect(result.current_status).toBe('resolved')
    expect(result.all_poles_energized).toBe(false)
    expect(result.dark_pole_ids).toEqual(['P3'])
  })

  it('2. Telemetry update: when remaining dark pole comes online (energized = true), status MUST auto-advance to closed', () => {
    const incident: IncidentState = {
      id: 'INC-SPAN-P1-P2-1001',
      status: 'resolved', // Currently watching telemetry
      affected_pole_ids: ['P2', 'P3'],
    }

    // Simulation: IoT sensor on P3 reports power_restored (current_energized = true)
    const updatedPoles: VerificationPoleState[] = [
      { pole_id: 'P2', current_energized: true },
      { pole_id: 'P3', current_energized: true }, // Power restored!
    ]

    const result = verifyIncidentResolution(incident, updatedPoles)

    // SHOULD AUTO-ADVANCE to closed!
    expect(result.verified).toBe(true)
    expect(result.current_status).toBe('closed')
    expect(result.all_poles_energized).toBe(true)
    expect(result.dark_pole_ids.length).toBe(0)
    expect(result.verified_at).toBeDefined()
    expect(result.closed_at).toBeDefined()
  })

  it('3. Non-resolved incident: verification check should return current status without modification', () => {
    const incident: IncidentState = {
      id: 'INC-SPAN-P1-P2-1002',
      status: 'crew_assigned',
      affected_pole_ids: ['P2', 'P3'],
    }

    const poles: VerificationPoleState[] = [
      { pole_id: 'P2', current_energized: true },
      { pole_id: 'P3', current_energized: true },
    ]

    const result = verifyIncidentResolution(incident, poles)

    expect(result.verified).toBe(false)
    expect(result.current_status).toBe('crew_assigned')
  })
})
