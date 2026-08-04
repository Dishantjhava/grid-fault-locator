import { FastifyPluginAsync } from 'fastify'
import { runStalenessWatchdogSweep } from '../services/watchdogRunner.js'

const watchdogRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /watchdog/sweep — Manual/scheduled trigger to run background staleness watchdog sweep
  fastify.post('/watchdog/sweep', async (request, reply) => {
    try {
      const sweepResult = await runStalenessWatchdogSweep(fastify.prisma)
      return reply.send({
        success: true,
        data: sweepResult,
      })
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: err.message,
      })
    }
  })
}

export default watchdogRoutes
