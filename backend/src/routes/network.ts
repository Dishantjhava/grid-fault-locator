import { FastifyPluginAsync } from 'fastify'

const networkRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/network', async (request, reply) => {
    const dts = await fastify.prisma.distributionTransformer.findMany({
      include: {
        poles: {
          select: {
            pole_id: true,
            lat: true,
            lon: true,
            device_id: true,
            current_energized: true,
            parent_pole_id: true,
            seq_on_line: true,
            pincode: true,
            ward: true,
            pole_type: true,
          },
        },
      },
    })

    return reply.send({ data: dts })
  })
}

export default networkRoutes
