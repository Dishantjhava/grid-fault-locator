/**
 * src/services/verification.ts
 *
 * Automated telemetry verification service for resolved grid incident tickets.
 */

export interface IncidentState {
  id: string
  status:
    | 'detected'
    | 'acknowledged'
    | 'crew_assigned'
    | 'resolved'
    | 'verified'
    | 'closed'
  affected_pole_ids: string[]
  verified_at?: Date | string | null
  closed_at?: Date | string | null
}

export interface VerificationPoleState {
  pole_id: string
  current_energized: boolean
}

export interface VerificationResult {
  verified: boolean
  previous_status: string
  current_status:
    | 'detected'
    | 'acknowledged'
    | 'crew_assigned'
    | 'resolved'
    | 'verified'
    | 'closed'
  all_poles_energized: boolean
  dark_pole_ids: string[]
  verified_at?: Date
  closed_at?: Date
}

/**
 * ARCHITECTURE & DESIGN REASONING FOR TELEMETRY VERIFICATION:
 *
 * Why we do NOT trust the manual "Resolve" click alone:
 * 1. Human Error & Radio Communication Gaps:
 *    Field repair crews operating on midnight shifts frequently declare work completed over radio
 *    the moment physical splicing or tree-clearing is done, prior to line re-energization.
 * 2. Unseen Secondary Faults:
 *    Closing an upstream breaker can immediately trigger a secondary downstream fault or fuse blow
 *    that goes unnoticed by field crews who have already left the location.
 * 3. Metric Integrity (SAIDI/SAIFI):
 *    Prematurely marking tickets as closed distorts utility SLA reports and leaves affected citizens
 *    without active dispatch tracking.
 *
 * AUTOMATED LIFECYCLE RULE:
 * Marking an incident as "resolved" moves it to status `resolved` and initiates IoT telemetry monitoring.
 * Only when 100% of poles in `affected_pole_ids` report `current_energized = true` via telemetry
 * does the system auto-advance the ticket to `verified` and `closed`.
 */
export function verifyIncidentResolution(
  incident: IncidentState,
  poles: VerificationPoleState[],
  now: Date = new Date()
): VerificationResult {
  // If incident is not in resolved status, return current status
  if (incident.status !== 'resolved') {
    return {
      verified: incident.status === 'verified' || incident.status === 'closed',
      previous_status: incident.status,
      current_status: incident.status,
      all_poles_energized: false,
      dark_pole_ids: [],
    }
  }

  const poleMap = new Map<string, boolean>()
  for (const p of poles) {
    poleMap.set(p.pole_id, p.current_energized)
  }

  const darkPoles: string[] = []
  for (const poleId of incident.affected_pole_ids) {
    const isEnergized = poleMap.get(poleId) ?? false
    if (!isEnergized) {
      darkPoles.push(poleId)
    }
  }

  const allEnergized =
    darkPoles.length === 0 && incident.affected_pole_ids.length > 0

  if (allEnergized) {
    return {
      verified: true,
      previous_status: 'resolved',
      current_status: 'closed', // Auto-advances through verified to closed
      all_poles_energized: true,
      dark_pole_ids: [],
      verified_at: now,
      closed_at: now,
    }
  }

  return {
    verified: false,
    previous_status: 'resolved',
    current_status: 'resolved', // Remains in resolved status while poles stay dark
    all_poles_energized: false,
    dark_pole_ids: darkPoles,
  }
}
