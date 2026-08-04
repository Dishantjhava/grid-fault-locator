/**
 * src/services/localization.ts
 *
 * Deterministic fault localization, boundary finding, confidence scoring,
 * and scheduled outage suppression engine for electrical grid telemetry.
 */

import { buildDTPoleTree, DTPoleTree, TreeNode, haversineMeters } from './topology.js'

export interface PoleState {
  pole_id: string
  lat: number
  lon: number
  device_id: string | null
  pincode: string | null
  current_energized: boolean
  last_seen_at?: Date | string | null
  parent_pole_id: string | null
  seq_on_line: number | null
  households_count?: number
}

export interface DTInfo {
  dt_id: string
  feeder_id: string
  lat: number
  lon: number
  households_served: number
  poles: PoleState[]
}

export interface ScheduledOutageInfo {
  id: string
  scope: 'feeder' | 'dt'
  target_id: string
  start: Date | string
  end: Date | string
  reason: string
}

export interface LocalizationInput {
  dt: DTInfo
  allDtsInFeeder?: DTInfo[]
  scheduledOutages?: ScheduledOutageInfo[]
  now?: Date
  debounceWindowMs?: number // Default: 45,000 ms (45 seconds)
}

export interface DetectedIncident {
  id: string
  fault_type: 'span' | 'dt' | 'feeder'
  status: 'detected'
  topology_source: 'known' | 'inferred'
  affected_pole_ids: string[]
  boundary_pole_id: string | null
  boundary_pole_range?: string[] // Used when boundary pole has no IoT device
  first_dark_pole_id: string | null
  confidence: number // 0.0 to 1.0
  confidence_reason: string
  lat: number
  lon: number
  pincode: string | null
  households_affected: number
  created_at: Date
}

export interface SuppressedIncident {
  incident: DetectedIncident
  suppression_reason: string
  outage_id: string
}

export interface LocalizationResult {
  incidents: DetectedIncident[]
  suppressed_incidents: SuppressedIncident[]
  dead_sensors: string[] // List of pole_ids with dead telemetry sensors on live lines
  is_debouncing: boolean
}

/**
 * Pure deterministic fault localization function.
 * Given live/dark states of poles and grid topology, isolates exact fault boundaries.
 */
export function localizeFaults(input: LocalizationInput): LocalizationResult {
  const { dt, allDtsInFeeder, scheduledOutages = [], debounceWindowMs = 45000 } = input
  const now = input.now ? new Date(input.now) : new Date()

  const result: LocalizationResult = {
    incidents: [],
    suppressed_incidents: [],
    dead_sensors: [],
    is_debouncing: false,
  }

  if (!dt.poles || dt.poles.length === 0) {
    return result
  }

  // Map poles for O(1) lookup
  const poleMap = new Map<string, PoleState>()
  for (const p of dt.poles) {
    poleMap.set(p.pole_id, p)
  }

  // 1. Build in-memory topology tree (Phase 3a)
  const tree = buildDTPoleTree(dt, dt.poles)
  if (!tree.root) {
    return result
  }

  // 2. Identify Dead Sensors
  // A dark pole whose subtree contains any live pole is a dead sensor, not a grid fault.
  const deadSensorPoles = new Set<string>()

  function checkSubtreeHasLive(node: TreeNode): boolean {
    const pole = poleMap.get(node.pole_id)
    const isSelfEnergized = pole ? pole.current_energized : true

    let childHasLive = false
    for (const child of node.children) {
      if (checkSubtreeHasLive(child)) {
        childHasLive = true
      }
    }

    if (!isSelfEnergized && childHasLive) {
      deadSensorPoles.add(node.pole_id)
      return true
    }

    return isSelfEnergized || childHasLive
  }

  checkSubtreeHasLive(tree.root)
  result.dead_sensors = Array.from(deadSensorPoles)

  // Effective energized check treating dead sensors as electrically live
  const isEffectiveLive = (poleId: string): boolean => {
    if (deadSensorPoles.has(poleId)) return true
    const p = poleMap.get(poleId)
    return p ? p.current_energized : true
  }

  // Check debounce timing across all poles in this DT
  for (const p of dt.poles) {
    if (p.last_seen_at) {
      const lastSeen = new Date(p.last_seen_at)
      if (now.getTime() - lastSeen.getTime() < debounceWindowMs) {
        result.is_debouncing = true;
      }
    }
  }

  // Helper to collect all pole_ids in a subtree
  function collectSubtreePoleIds(node: TreeNode): string[] {
    const ids = [node.pole_id]
    for (const child of node.children) {
      ids.push(...collectSubtreePoleIds(child))
    }
    return ids
  }

  // Helper to find nearest pole with a non-null pincode
  function getNearestPincode(targetLat: number, targetLon: number): string | null {
    let minDistance = Infinity
    let bestPincode: string | null = null

    for (const p of dt.poles) {
      if (p.pincode) {
        const dist = haversineMeters(targetLat, targetLon, p.lat, p.lon)
        if (dist < minDistance) {
          minDistance = dist
          bestPincode = p.pincode
        }
      }
    }
    return bestPincode
  }

  // Helper to estimate households affected in a pole set
  function countHouseholds(poleIds: string[]): number {
    const totalPoles = dt.poles.length
    if (totalPoles === 0) return 0
    let customSum = 0
    let countedCustom = false

    for (const id of poleIds) {
      const p = poleMap.get(id)
      if (p && typeof p.households_count === 'number') {
        customSum += p.households_count
        countedCustom = true
      }
    }

    if (countedCustom) return customSum

    // Proportional estimate based on DT total households
    return Math.round((poleIds.length / totalPoles) * dt.households_served)
  }

  // 3. SPECIAL CASE: Check DT-wide or Feeder-wide fault
  const allPolesDark = dt.poles.every((p) => !isEffectiveLive(p.pole_id))

  if (allPolesDark) {
    let isFeederFault = false
    if (allDtsInFeeder && allDtsInFeeder.length > 0) {
      isFeederFault = allDtsInFeeder.every((otherDt) =>
        otherDt.poles.every((p) => !p.current_energized)
      )
    }

    const faultType = isFeederFault ? 'feeder' : 'dt'
    const rootPole = poleMap.get(tree.root.pole_id)!

    let confidence = tree.topology_source === 'known' ? 1.0 : 0.75
    let confidenceReason =
      tree.topology_source === 'known'
        ? `High confidence ${faultType.toUpperCase()}-level blackout verified by all connected sensors.`
        : `Medium confidence ${faultType.toUpperCase()}-level blackout based on inferred topology MST.`

    if (!rootPole.device_id) {
      confidence -= 0.2
      confidenceReason += ' Reduced: DT root pole lacks an IoT sensor.'
    }

    const allPoleIds = dt.poles.map((p) => p.pole_id)
    const pincode = rootPole.pincode ?? getNearestPincode(rootPole.lat, rootPole.lon)

    const incident: DetectedIncident = {
      id: `INC-${faultType.toUpperCase()}-${dt.dt_id}-${now.getTime()}`,
      fault_type: faultType,
      status: 'detected',
      topology_source: tree.topology_source,
      affected_pole_ids: allPoleIds,
      boundary_pole_id: null,
      first_dark_pole_id: rootPole.pole_id,
      confidence: Math.max(0.1, confidence),
      confidence_reason: confidenceReason,
      lat: rootPole.lat,
      lon: rootPole.lon,
      pincode,
      households_affected: isFeederFault
        ? allDtsInFeeder?.reduce((sum, d) => sum + d.households_served, 0) ?? dt.households_served
        : dt.households_served,
      created_at: now,
    }

    evaluateOutageSuppression(incident, dt, scheduledOutages, now, result)
    return result
  }

  // 4. SPAN FAULT BOUNDARY DETECTION
  // Walk tree to find boundaries where a live pole has a dark child
  const detectedSpanIncidents: DetectedIncident[] = []

  function findBoundaries(node: TreeNode) {
    const isNodeLive = isEffectiveLive(node.pole_id)

    for (const child of node.children) {
      const isChildLive = isEffectiveLive(child.pole_id)

      if (isNodeLive && !isChildLive) {
        // FOUND A SPAN FAULT BOUNDARY!
        // node = boundary_pole (last live pole)
        // child = first_dark_pole (first dark pole)
        const affectedIds = collectSubtreePoleIds(child)
        const livePoleState = poleMap.get(node.pole_id)!
        const darkPoleState = poleMap.get(child.pole_id)!

        let confidence = tree.topology_source === 'known' ? 1.0 : 0.75
        let confidenceReason =
          tree.topology_source === 'known'
            ? `Exact span fault isolated between live pole ${node.pole_id} and dark pole ${child.pole_id}.`
            : `Span fault isolated based on inferred MST topology between ${node.pole_id} and ${child.pole_id}.`

        let boundaryPoleId: string | null = node.pole_id
        let boundaryRange: string[] | undefined = undefined
        let repLat = (livePoleState.lat + darkPoleState.lat) / 2
        let repLon = (livePoleState.lon + darkPoleState.lon) / 2

        // Check if boundary pole has NO IoT device (device_id === null)
        if (!livePoleState.device_id || !darkPoleState.device_id) {
          confidence -= 0.2
          boundaryPoleId = null
          boundaryRange = [livePoleState.pole_id, darkPoleState.pole_id]
          confidenceReason += ` Boundary pole ${
            !livePoleState.device_id ? node.pole_id : child.pole_id
          } lacks an IoT sensor. Boundary reported as range [${livePoleState.pole_id}, ${child.pole_id}].`
        }

        const pincode =
          livePoleState.pincode ??
          darkPoleState.pincode ??
          getNearestPincode(repLat, repLon)

        const incident: DetectedIncident = {
          id: `INC-SPAN-${node.pole_id}-${child.pole_id}-${now.getTime()}`,
          fault_type: 'span',
          status: 'detected',
          topology_source: tree.topology_source,
          affected_pole_ids: affectedIds,
          boundary_pole_id: boundaryPoleId,
          boundary_pole_range: boundaryRange,
          first_dark_pole_id: child.pole_id,
          confidence: Math.max(0.1, confidence),
          confidence_reason: confidenceReason,
          lat: repLat,
          lon: repLon,
          pincode,
          households_affected: countHouseholds(affectedIds),
          created_at: now,
        }

        detectedSpanIncidents.push(incident)
      } else {
        // Recurse into child
        findBoundaries(child)
      }
    }
  }

  findBoundaries(tree.root)

  // 5. Evaluate Scheduled Outage Suppression for all detected span incidents
  for (const inc of detectedSpanIncidents) {
    evaluateOutageSuppression(inc, dt, scheduledOutages, now, result)
  }

  return result
}

/**
 * Checks if an incident falls within a Scheduled Outage window (+/- 30 min tolerance buffer).
 */
function evaluateOutageSuppression(
  incident: DetectedIncident,
  dt: DTInfo,
  scheduledOutages: ScheduledOutageInfo[],
  now: Date,
  result: LocalizationResult
) {
  const TOLERANCE_MS = 30 * 60 * 1000 // 30 minutes tolerance for overruns/early cuts

  for (const outage of scheduledOutages) {
    const isTargetMatch =
      (outage.scope === 'dt' && outage.target_id === dt.dt_id) ||
      (outage.scope === 'feeder' && outage.target_id === dt.feeder_id)

    if (isTargetMatch) {
      const outageStart = new Date(outage.start).getTime() - TOLERANCE_MS
      const outageEnd = new Date(outage.end).getTime() + TOLERANCE_MS
      const nowTime = now.getTime()

      if (nowTime >= outageStart && nowTime <= outageEnd) {
        result.suppressed_incidents.push({
          incident,
          suppression_reason: `Suppressed: Outage matches scheduled maintenance #${outage.id} (${outage.reason})`,
          outage_id: outage.id,
        })
        return
      }
    }
  }

  // Not suppressed — add to active incidents
  result.incidents.push(incident)
}
