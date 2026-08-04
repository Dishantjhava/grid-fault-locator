/**
 * src/services/watchdogRunner.ts
 *
 * Periodic Background Watchdog Sweep for Silent-Device Staleness Detection.
 */

import { PrismaClient } from '@prisma/client'
import { identifyStalePoles, STALENESS_THRESHOLD_MS } from './staleness.js'
import { localizeFaults, DTInfo } from './localization.js'
import { generateTemplateFallbackSummary, generateAISummary } from './aiSummary.js'

export interface WatchdogSweepResult {
  sweep_time: Date
  stale_poles_count: number
  stale_pole_ids: string[]
  incidents_created_count: number
  dead_sensors_count: number
}

/**
 * Executes a full background sweep across all poles in the database.
 * Identifies silent poles (no heartbeat for >= 21 min) and triggers
 * the unified fault localization pipeline.
 */
export async function runStalenessWatchdogSweep(
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<WatchdogSweepResult> {
  const result: WatchdogSweepResult = {
    sweep_time: now,
    stale_poles_count: 0,
    stale_pole_ids: [],
    incidents_created_count: 0,
    dead_sensors_count: 0,
  }

  // 1. Fetch all poles from DB
  const allPoles = await prisma.pole.findMany({
    select: {
      pole_id: true,
      device_id: true,
      current_energized: true,
      last_seen_at: true,
      dt_id: true,
      feeder_id: true,
      lat: true,
      lon: true,
      pincode: true,
      seq_on_line: true,
      parent_pole_id: true,
    },
  })

  // 2. Identify stale poles
  const stalePoleIds = identifyStalePoles(allPoles, now, STALENESS_THRESHOLD_MS)
  result.stale_poles_count = stalePoleIds.length
  result.stale_pole_ids = stalePoleIds

  if (stalePoleIds.length === 0) {
    return result
  }

  // 3. Group poles by DT to run localization pass per DT
  const dtMap = new Map<string, typeof allPoles>()
  for (const p of allPoles) {
    const list = dtMap.get(p.dt_id) || []
    list.push(p)
    dtMap.set(p.dt_id, list)
  }

  const dtsInfo = await prisma.distributionTransformer.findMany({
    select: { dt_id: true, feeder_id: true, lat: true, lon: true, households_served: true },
  })

  const dtMetaMap = new Map<string, typeof dtsInfo[0]>()
  for (const d of dtsInfo) {
    dtMetaMap.set(d.dt_id, d)
  }

  const outages = await prisma.scheduledOutage.findMany()

  // 4. Run unified localization per DT affected by staleness
  for (const [dtId, dtPoles] of dtMap.entries()) {
    const hasStale = dtPoles.some((p) => stalePoleIds.includes(p.pole_id))
    if (!hasStale) continue

    const dtMeta = dtMetaMap.get(dtId)
    if (!dtMeta) continue

    const dtInfo: DTInfo = {
      dt_id: dtMeta.dt_id,
      feeder_id: dtMeta.feeder_id,
      lat: dtMeta.lat,
      lon: dtMeta.lon,
      households_served: dtMeta.households_served,
      poles: dtPoles.map((p) => ({
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
    }

    const localization = localizeFaults({
      dt: dtInfo,
      scheduledOutages: outages.map((o) => ({
        id: o.id,
        scope: o.scope as any,
        target_id: o.target_id,
        start: o.start,
        end: o.end,
        reason: o.reason,
      })),
      now,
      stalePoleIds,
    })

    result.dead_sensors_count += localization.dead_sensors.length

    // Store incidents created from silent device staleness
    for (const inc of localization.incidents) {
      // Check if an active incident already covers any of these affected poles or first_dark_pole
      const existing = await prisma.incident.findFirst({
        where: {
          status: { in: ['detected', 'acknowledged', 'crew_assigned'] },
          OR: [
            { first_dark_pole_id: inc.first_dark_pole_id },
            { affected_pole_ids: { hasSome: inc.affected_pole_ids } },
          ],
        },
      })

      if (existing) {
        // Active incident already exists for this fault — merge/extend affected_pole_ids if new poles found
        const mergedPoles = Array.from(
          new Set([...existing.affected_pole_ids, ...inc.affected_pole_ids])
        )
        if (mergedPoles.length > existing.affected_pole_ids.length) {
          await prisma.incident.update({
            where: { id: existing.id },
            data: { affected_pole_ids: mergedPoles },
          })
        }
      } else {
        const initialSummary = generateTemplateFallbackSummary({
          id: 'PENDING',
          fault_type: inc.fault_type,
          topology_source: inc.topology_source,
          affected_pole_ids: inc.affected_pole_ids,
          boundary_pole_id: inc.boundary_pole_id,
          boundary_pole_range: inc.boundary_pole_range,
          first_dark_pole_id: inc.first_dark_pole_id,
          confidence: inc.confidence,
          confidence_reason: inc.confidence_reason,
          pincode: inc.pincode,
          households_affected: inc.households_affected,
        })

        const createdIncident = await prisma.incident.create({
          data: {
            fault_type: inc.fault_type as any,
            status: 'detected',
            affected_pole_ids: inc.affected_pole_ids,
            boundary_pole_id: inc.boundary_pole_id,
            first_dark_pole_id: inc.first_dark_pole_id,
            confidence: inc.confidence,
            confidence_reason: initialSummary,
            lat: inc.lat,
            lon: inc.lon,
            pincode: inc.pincode,
            households_affected: inc.households_affected,
            topology_source: inc.topology_source as any,
          },
        })

        result.incidents_created_count++

        // Non-blocking AI Summary
        generateAISummary({
          id: createdIncident.id,
          fault_type: inc.fault_type,
          topology_source: inc.topology_source,
          affected_pole_ids: inc.affected_pole_ids,
          boundary_pole_id: inc.boundary_pole_id,
          boundary_pole_range: inc.boundary_pole_range,
          first_dark_pole_id: inc.first_dark_pole_id,
          confidence: inc.confidence,
          confidence_reason: inc.confidence_reason,
          pincode: inc.pincode,
          households_affected: inc.households_affected,
        })
          .then(async (aiText) => {
            if (aiText && aiText !== initialSummary) {
              await prisma.incident.update({
                where: { id: createdIncident.id },
                data: { confidence_reason: aiText },
              })
            }
          })
          .catch(() => {})
      }
    }
  }

  return result
}
