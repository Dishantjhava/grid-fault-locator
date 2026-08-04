import { FastifyPluginAsync } from 'fastify'
import { verifyIncidentResolution } from '../services/verification.js'

const incidentRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /incidents — List all incidents (with optional status filtering)
  fastify.get<{ Querystring: { status?: string } }>(
    '/incidents',
    async (request, reply) => {
      const { status } = request.query
      const where = status ? { status: status as any } : {}
      const incidents = await fastify.prisma.incident.findMany({
        where,
        orderBy: { created_at: 'desc' },
      })
      return reply.send({ data: incidents })
    }
  )

  // GET /incidents/:id — Single incident details
  fastify.get<{ Params: { id: string } }>(
    '/incidents/:id',
    async (request, reply) => {
      const { id } = request.params
      const incident = await fastify.prisma.incident.findUnique({
        where: { id },
      })
      if (!incident) {
        return reply.notFound(`Incident #${id} not found`)
      }
      return reply.send({ data: incident })
    }
  )

  // POST /incidents/:id/acknowledge — State transition: detected -> acknowledged
  fastify.post<{ Params: { id: string } }>(
    '/incidents/:id/acknowledge',
    async (request, reply) => {
      const { id } = request.params
      const incident = await fastify.prisma.incident.findUnique({
        where: { id },
      })

      if (!incident) {
        return reply.notFound(`Incident #${id} not found`)
      }

      if (incident.status !== 'detected') {
        return reply.badRequest(
          `Cannot acknowledge incident #${id} from current status '${incident.status}'. Only 'detected' incidents can be acknowledged.`
        )
      }

      const updated = await fastify.prisma.incident.update({
        where: { id },
        data: { status: 'acknowledged' },
      })

      return reply.send({
        data: updated,
        message: `Incident #${id} acknowledged successfully.`,
      })
    }
  )

  // POST /incidents/:id/assign-crew — State transition: acknowledged -> crew_assigned
  fastify.post<{ Params: { id: string } }>(
    '/incidents/:id/assign-crew',
    async (request, reply) => {
      const { id } = request.params
      const incident = await fastify.prisma.incident.findUnique({
        where: { id },
      })

      if (!incident) {
        return reply.notFound(`Incident #${id} not found`)
      }

      if (incident.status !== 'acknowledged' && incident.status !== 'detected') {
        return reply.badRequest(
          `Cannot assign crew to incident #${id} from current status '${incident.status}'. Status must be 'acknowledged'.`
        )
      }

      const updated = await fastify.prisma.incident.update({
        where: { id },
        data: { status: 'crew_assigned' },
      })

      return reply.send({
        data: updated,
        message: `Field repair crew assigned to incident #${id}.`,
      })
    }
  )

  // POST /incidents/:id/resolve — State transition: crew_assigned -> resolved (with telemetry verification trigger)
  fastify.post<{ Params: { id: string } }>(
    '/incidents/:id/resolve',
    async (request, reply) => {
      const { id } = request.params
      const incident = await fastify.prisma.incident.findUnique({
        where: { id },
      })

      if (!incident) {
        return reply.notFound(`Incident #${id} not found`)
      }

      if (
        incident.status !== 'crew_assigned' &&
        incident.status !== 'acknowledged'
      ) {
        return reply.badRequest(
          `Cannot mark incident #${id} as resolved from current status '${incident.status}'. Must be 'crew_assigned' or 'acknowledged'.`
        )
      }

      // Step 1: Update status to 'resolved'
      let updatedIncident = await fastify.prisma.incident.update({
        where: { id },
        data: { status: 'resolved' },
      })

      // Step 2: Fetch current live/dark status of all affected_pole_ids from DB
      const poles = await fastify.prisma.pole.findMany({
        where: { pole_id: { in: updatedIncident.affected_pole_ids } },
        select: { pole_id: true, current_energized: true },
      })

      // Step 3: Run automated verification check
      const verification = verifyIncidentResolution(updatedIncident, poles)

      if (verification.verified) {
        // All affected poles are already energized -> Auto-advance status to closed
        updatedIncident = await fastify.prisma.incident.update({
          where: { id },
          data: {
            status: 'closed',
            verified_at: verification.verified_at,
            closed_at: verification.closed_at,
          },
        })

        return reply.send({
          data: updatedIncident,
          verified: true,
          dark_poles_count: 0,
          message: `Incident verified by IoT telemetry! All ${updatedIncident.affected_pole_ids.length} affected poles are energized. Ticket automatically closed.`,
        })
      }

      // If poles are still dark: Respond with 200 OK + clear operational status message
      return reply.send({
        data: updatedIncident,
        verified: false,
        dark_poles_count: verification.dark_pole_ids.length,
        dark_pole_ids: verification.dark_pole_ids,
        message: `Incident #${id} marked as 'resolved'. System is actively monitoring IoT telemetry for ${verification.dark_pole_ids.length} affected pole(s). Ticket will automatically transition to 'verified' and 'closed' once all sensors report power restored.`,
      })
    }
  )
}

export default incidentRoutes
