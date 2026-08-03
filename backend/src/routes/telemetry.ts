import { FastifyPluginAsync } from 'fastify'
import { Prisma } from '@prisma/client'

interface TelemetryBody {
  device_id: string
  pole_id: string
  event: 'heartbeat' | 'power_lost' | 'power_restored' | 'boot'
  energized: boolean
  ts: string
  seq: number
  battery_mv?: number
  rssi?: number
  fw?: string
}

const telemetryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: TelemetryBody }>(
    '/telemetry',
    {
      schema: {
        body: {
          type: 'object',
          required: ['device_id', 'pole_id', 'event', 'energized', 'ts', 'seq'],
          properties: {
            device_id: { type: 'string' },
            pole_id: { type: 'string' },
            event: {
              type: 'string',
              enum: ['heartbeat', 'power_lost', 'power_restored', 'boot'],
            },
            energized: { type: 'boolean' },
            ts: { type: 'string' },
            seq: { type: 'integer' },
            battery_mv: { type: 'integer' },
            rssi: { type: 'integer' },
            fw: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body

      /**
       * INGESTION ARCHITECTURE & DESIGN REASONING:
       *
       * 1. Append-Only Event Log:
       *    Every valid telemetry payload is saved into `TelemetryEvent`.
       *    We never overwrite past events because historical time-series data
       *    is critical for fault investigation, ML models, and post-incident reporting.
       *
       * 2. Sequence Number Ordering (`seq` vs `ts`):
       *    We use `seq` (monotonically-increasing hardware counter) rather than `ts` (clock timestamp)
       *    to order device updates because real-time clocks on IoT edge devices suffer from drift,
       *    boot-time epoch resets (1970-01-01), or lack of NTP sync. `seq` strictly guarantees
       *    causal ordering per device.
       *
       * 3. Idempotent Deduplication:
       *    Devices retry network transmissions on flaky cellular connections. The schema has a
       *    `@@unique([device_id, seq])` constraint. If a duplicate packet arrives, Prisma throws P2002.
       *    We catch P2002 and silently return 202 Accepted without duplicating records.
       *
       * 4. Asynchronous / Fast Response:
       *    Heavy grid fault localization graph operations are decoupled and handled out-of-band.
       *    This endpoint performs minimal atomic DB operations and immediately returns HTTP 202 Accepted.
       */
      try {
        await fastify.prisma.$transaction(async (tx) => {
          // Store event in append-only log
          await tx.telemetryEvent.create({
            data: {
              device_id: body.device_id,
              pole_id: body.pole_id,
              event: body.event,
              energized: body.energized,
              device_ts: new Date(body.ts),
              seq: body.seq,
              battery_mv: body.battery_mv ?? null,
              rssi: body.rssi ?? null,
              fw: body.fw ?? null,
            },
          })

          // Check if this newly inserted event has the highest sequence number for this device
          const newestEvent = await tx.telemetryEvent.findFirst({
            where: { device_id: body.device_id },
            orderBy: { seq: 'desc' },
            select: { seq: true },
          })

          // Update Pole current_energized and last_seen_at ONLY if this event is the newest sequence
          if (newestEvent && newestEvent.seq === body.seq) {
            await tx.pole.updateMany({
              where: { pole_id: body.pole_id },
              data: {
                current_energized: body.energized,
                last_seen_at: new Date(body.ts),
              },
            })
          }
        })

        return reply.status(202).send({ status: 'accepted' })
      } catch (err: any) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Idempotent ingest: Duplicate event (device_id + seq) already stored
          return reply.status(202).send({ status: 'accepted', duplicate: true })
        }
        throw err
      }
    }
  )
}

export default telemetryRoutes
