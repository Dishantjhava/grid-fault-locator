import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import prismaPlugin from './plugins/prisma.js'
import telemetryRoutes from './routes/telemetry.js'
import incidentRoutes from './routes/incidents.js'
import networkRoutes from './routes/network.js'
import simulatorRoutes from './routes/simulator.js'
import watchdogRoutes from './routes/watchdog.js'
import { runStalenessWatchdogSweep } from './services/watchdogRunner.js'

const server = Fastify({
  logger: process.env.NODE_ENV !== 'production' ? { level: 'info' } : false,
})

// Allow all origins in dev so the Vite frontend can call this API.
await server.register(cors, { origin: true })
await server.register(sensible)

// Register Prisma Client plugin
await server.register(prismaPlugin)

// Register routes
await server.register(telemetryRoutes)
await server.register(incidentRoutes)
await server.register(networkRoutes)
await server.register(simulatorRoutes)
await server.register(watchdogRoutes)

server.get('/health', async () => {
  return { status: 'ok' }
})

// Start background watchdog timer (runs every 60 seconds)
const WATCHDOG_INTERVAL_MS = 60 * 1000
setInterval(async () => {
  try {
    if (server.prisma) {
      await runStalenessWatchdogSweep(server.prisma)
    }
  } catch (err: any) {
    server.log.warn(`Staleness watchdog sweep error: ${err.message}`)
  }
}, WATCHDOG_INTERVAL_MS)

const port = Number(process.env.PORT) || 3001

await server.listen({ port, host: '0.0.0.0' })
