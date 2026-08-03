import fp from 'fastify-plugin'
import { PrismaClient } from '@prisma/client'
import { FastifyPluginAsync } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
  }
}

const prismaPlugin: FastifyPluginAsync = async (server) => {
  const prisma = new PrismaClient()

  try {
    await prisma.$connect()
    server.log.info('Prisma Client connected to PostgreSQL database')
  } catch (err: any) {
    server.log.warn(
      `Prisma Client connection deferred or failed (DB down?): ${err.message}`
    )
  }

  server.decorate('prisma', prisma)

  server.addHook('onClose', async (instance) => {
    await instance.prisma.$disconnect()
  })
}

export default fp(prismaPlugin)
