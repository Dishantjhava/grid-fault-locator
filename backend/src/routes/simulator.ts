import { FastifyPluginAsync } from 'fastify'
import { localizeFaults, DTInfo } from '../services/localization.js'
import { verifyIncidentResolution } from '../services/verification.js'
import {
  generateAISummary,
  generateTemplateFallbackSummary,
} from '../services/aiSummary.js'

interface SimulatorInjectBody {
  action:
    | 'span_fault'
    | 'dt_fault'
    | 'feeder_fault'
    | 'dead_sensor'
    | 'scheduled_outage'
    | 'repair'
  dt_id?: string
  feeder_id?: string
  target_pole_id?: string
  reason?: string
}

const simulatorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: SimulatorInjectBody }>(
    '/simulator/inject',
    async (request, reply) => {
      const { action, dt_id, feeder_id, target_pole_id, reason } = request.body

      const now = new Date()

      if (action === 'repair') {
        // Repair fault: set poles back to energized = true
        let whereCondition: any = {}
        if (dt_id) whereCondition.dt_id = dt_id
        if (feeder_id) whereCondition.feeder_id = feeder_id
        if (target_pole_id) whereCondition.pole_id = target_pole_id

        await fastify.prisma.pole.updateMany({
          where: whereCondition,
          data: { current_energized: true, last_seen_at: now },
        })

        // Check any 'resolved' incidents and auto-advance them if verified
        const resolvedIncidents = await fastify.prisma.incident.findMany({
          where: { status: 'resolved' },
        })

        for (const inc of resolvedIncidents) {
          const poles = await fastify.prisma.pole.findMany({
            where: { pole_id: { in: inc.affected_pole_ids } },
            select: { pole_id: true, current_energized: true },
          })
          const verification = verifyIncidentResolution(inc, poles, now)
          if (verification.verified) {
            await fastify.prisma.incident.update({
              where: { id: inc.id },
              data: {
                status: 'closed',
                verified_at: now,
                closed_at: now,
              },
            })
          }
        }

        return reply.send({
          success: true,
          message: `Power restored for ${dt_id || feeder_id || 'all poles'}. Telemetry updated.`,
        })
      }

      if (action === 'scheduled_outage') {
        const targetId = dt_id || feeder_id || 'SUB-N-F1'
        const scope = dt_id ? 'dt' : 'feeder'
        const outage = await fastify.prisma.scheduledOutage.create({
          data: {
            scope,
            target_id: targetId,
            start: new Date(now.getTime() - 10 * 60 * 1000), // Started 10m ago
            end: new Date(now.getTime() + 2 * 60 * 60 * 1000), // 2h duration
            reason: reason || 'Routine Grid Maintenance',
          },
        })
        return reply.send({
          success: true,
          message: `Scheduled outage #${outage.id} triggered for ${targetId}.`,
        })
      }

      // Handle fault injections
      let targetDtId = dt_id
      if (!targetDtId) {
        const firstDt = await fastify.prisma.distributionTransformer.findFirst()
        targetDtId = firstDt?.dt_id ?? 'DT-001'
      }

      const dbDt = await fastify.prisma.distributionTransformer.findUnique({
        where: { dt_id: targetDtId },
        include: { poles: true },
      })

      if (!dbDt) {
        return reply.badRequest(`DT #${targetDtId} not found`)
      }

      let poleIdsToDarken: string[] = []

      if (action === 'dt_fault') {
        poleIdsToDarken = dbDt.poles.map((p) => p.pole_id)
      } else if (action === 'feeder_fault') {
        const feederDts = await fastify.prisma.distributionTransformer.findMany({
          where: { feeder_id: dbDt.feeder_id },
          include: { poles: true },
        })
        const allFeederPoles = feederDts.flatMap((d) => d.poles.map((p) => p.pole_id))
        await fastify.prisma.pole.updateMany({
          where: { pole_id: { in: allFeederPoles } },
          data: { current_energized: false, last_seen_at: now },
        })
        poleIdsToDarken = allFeederPoles
      } else if (action === 'dead_sensor') {
        // Darken single pole (e.g. pole #2), leave downstream energized
        const targetPole = dbDt.poles[1] || dbDt.poles[0]
        await fastify.prisma.pole.update({
          where: { pole_id: targetPole.pole_id },
          data: { current_energized: false, last_seen_at: now },
        })
      } else {
        // span_fault (default) — darken half of the poles starting mid-tree
        const halfIndex = Math.floor(dbDt.poles.length / 2)
        poleIdsToDarken = dbDt.poles.slice(halfIndex).map((p) => p.pole_id)
      }

      if (action !== 'dead_sensor' && poleIdsToDarken.length > 0) {
        await fastify.prisma.pole.updateMany({
          where: { pole_id: { in: poleIdsToDarken } },
          data: { current_energized: false, last_seen_at: now },
        })
      }

      // Run localization algorithm (Phase 3b)
      const refreshedDt = await fastify.prisma.distributionTransformer.findUnique({
        where: { dt_id: targetDtId },
        include: { poles: true },
      })

      const allDts = await fastify.prisma.distributionTransformer.findMany({
        where: { feeder_id: dbDt.feeder_id },
        include: { poles: true },
      })

      const outages = await fastify.prisma.scheduledOutage.findMany()

      const dtInfo: DTInfo = {
        dt_id: refreshedDt!.dt_id,
        feeder_id: refreshedDt!.feeder_id,
        lat: refreshedDt!.lat,
        lon: refreshedDt!.lon,
        households_served: refreshedDt!.households_served,
        poles: refreshedDt!.poles.map((p) => ({
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
        allDtsInFeeder: allDts.map((d) => ({
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
        scheduledOutages: outages.map((o) => ({
          id: o.id,
          scope: o.scope as any,
          target_id: o.target_id,
          start: o.start,
          end: o.end,
          reason: o.reason,
        })),
        now,
      })

      // Store detected incidents in DB immediately with template fallback summary
      for (const inc of localization.incidents) {
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

        const createdIncident = await fastify.prisma.incident.create({
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

        // ASYNC NON-BLOCKING: Trigger background AI summary update (updates DB if AI summary finishes)
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
              await fastify.prisma.incident.update({
                where: { id: createdIncident.id },
                data: { confidence_reason: aiText },
              })
            }
          })
          .catch(() => {})
      }

      return reply.send({
        success: true,
        action,
        incidents_created: localization.incidents.length,
        dead_sensors_flagged: localization.dead_sensors,
        suppressed_count: localization.suppressed_incidents.length,
      })
    }
  )
}

export default simulatorRoutes
