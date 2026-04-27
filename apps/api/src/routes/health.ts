import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

const startedAt = Date.now();

export async function healthRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  app.get('/health', async (_req, reply) => {
    reply.send({
      data: {
        status: 'ok',
        uptimeMs: Date.now() - startedAt,
        version: process.env['npm_package_version'] ?? '0.1.0',
      },
    });
  });
}
