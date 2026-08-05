import { FastifyPluginAsync } from 'fastify'
import { processDTLocalization } from '../services/localizationRunner.js'
import { buildDTPoleTree, TreeNode } from '../services/topology.js'
import { verifyIncidentResolution } from '../services/verification.js'

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
  bypass_debounce?: boolean
}

const simulatorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: SimulatorInjectBody }>(
    '/simulator/inject',
    async (request, reply) => {
      const { action, dt_id, feeder_id, target_pole_id, reason, bypass_debounce = false } = request.body

      const now = new Date()

      if (action === 'repair') {
        // Repair fault: set all poles back to energized = true across grid
        await fastify.prisma.pole.updateMany({
          data: { current_energized: true, last_seen_at: now },
        })

        // Clear active incidents and scheduled outages from previous testing runs
        await fastify.prisma.incident.deleteMany()
        await fastify.prisma.scheduledOutage.deleteMany()

        return reply.send({
          success: true,
          message: `Power restored for all poles. Cleared past test incidents -> 0 Active Incidents.`,
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
        // span_fault (default) — build topological tree (known or inferred MST)
        // and darken a downstream subtree starting from a mid-tree node
        const tree = buildDTPoleTree(
          { dt_id: dbDt.dt_id, lat: dbDt.lat, lon: dbDt.lon },
          dbDt.poles.map((p) => ({
            pole_id: p.pole_id,
            lat: p.lat,
            lon: p.lon,
            parent_pole_id: p.parent_pole_id,
            seq_on_line: p.seq_on_line,
          }))
        )

        if (tree.root && tree.root.children.length > 0) {
          // Pick a child node of the root node
          const targetNode = tree.root.children[0]
          const getSubtreeIds = (node: TreeNode): string[] => {
            const ids = [node.pole_id]
            for (const child of node.children) {
              ids.push(...getSubtreeIds(child))
            }
            return ids
          }
          poleIdsToDarken = getSubtreeIds(targetNode)
        } else {
          // Fallback if tree has no children
          const halfIndex = Math.floor(dbDt.poles.length / 2)
          poleIdsToDarken = dbDt.poles.slice(halfIndex).map((p) => p.pole_id)
        }
      }

      if (action !== 'dead_sensor' && poleIdsToDarken.length > 0) {
        await fastify.prisma.pole.updateMany({
          where: { pole_id: { in: poleIdsToDarken } },
          data: { current_energized: false, last_seen_at: now },
        })
      }

      // Run localization algorithm (Phase 3b)
      const result = await processDTLocalization(fastify.prisma, targetDtId, {
        now,
        bypassDebounce: bypass_debounce,
      })

      return reply.send({
        success: true,
        action,
        incidents_created: result.incidents_created,
        is_debouncing: result.is_debouncing,
        dead_sensors_flagged: result.dead_sensors,
        suppressed_count: result.suppressed_incidents?.length ?? 0,
      })
    }
  )
}

export default simulatorRoutes
