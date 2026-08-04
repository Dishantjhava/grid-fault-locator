/**
 * src/services/localizationRunner.ts
 *
 * Centralized fault localization coordinator for telemetry ingestion (POST /telemetry),
 * simulator triggers (POST /simulator/inject), and background watchdog sweeps.
 */

import { PrismaClient } from '@prisma/client'
import { localizeFaults, DTInfo } from './localization.js'
import { generateAISummary, generateTemplateFallbackSummary } from './aiSummary.js'

// Active debounce timers map per DT (dt_id -> NodeJS.Timeout)
const activeDebounceTimers = new Map<string, NodeJS.Timeout>()

export async function processDTLocalization(
  prisma: PrismaClient,
  targetDtId: string,
  options: { now?: Date; bypassDebounce?: boolean } = {}
) {
  const now = options.now || new Date()
  const bypassDebounce = options.bypassDebounce ?? false

  const dbDt = await prisma.distributionTransformer.findUnique({
    where: { dt_id: targetDtId },
    include: { poles: true },
  })
  if (!dbDt) return { incidents_created: 0, is_debouncing: false }

  const feederDts = await prisma.distributionTransformer.findMany({
    where: { feeder_id: dbDt.feeder_id },
    include: { poles: true },
  })

  const outages = await prisma.scheduledOutage.findMany()

  const dtInfo: DTInfo = {
    dt_id: dbDt.dt_id,
    feeder_id: dbDt.feeder_id,
    lat: dbDt.lat,
    lon: dbDt.lon,
    households_served: dbDt.households_served,
    poles: dbDt.poles.map((p) => ({
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
    allDtsInFeeder: feederDts.map((d) => ({
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
        last_seen_at: p.last_seen_at,
        parent_pole_id: p.parent_pole_id,
        seq_on_line: p.seq_on_line,
      })),
    })),
    scheduledOutages: outages.map((o) => ({
      id: o.id,
      scope: o.scope as any,
      target_id: o.target_id,
      start: o.start,
      end: o.end,
      reason: o.reason,
    })),
    now,
    bypassDebounce,
  })

  // Store detected incidents immediately in PostgreSQL
  for (const inc of localization.incidents) {
    await persistIncident(prisma, inc)
  }

  // Handle Debounce Window Stabilization:
  // If state changes occurred and bypassDebounce is false, schedule (or reset) the 45s timer
  if (localization.is_debouncing && !bypassDebounce) {
    // Clear any existing timer for this DT to reset the 45s stabilization window (cascade storm collapse)
    if (activeDebounceTimers.has(targetDtId)) {
      clearTimeout(activeDebounceTimers.get(targetDtId)!)
    }

    const timer = setTimeout(async () => {
      activeDebounceTimers.delete(targetDtId)
      try {
        await processDTLocalization(prisma, targetDtId, {
          now: new Date(),
          bypassDebounce: true,
        })
      } catch (err) {
        console.error(`Error processing debounced localization for ${targetDtId}:`, err)
      }
    }, 45000)

    activeDebounceTimers.set(targetDtId, timer)
  }

  return {
    incidents_created: localization.incidents.length,
    is_debouncing: localization.is_debouncing,
    dead_sensors: localization.dead_sensors,
    suppressed_incidents: localization.suppressed_incidents,
  }
}

export async function persistIncident(prisma: PrismaClient, inc: any) {
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

  // ASYNC NON-BLOCKING: Trigger background AI summary update
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

  return createdIncident
}
