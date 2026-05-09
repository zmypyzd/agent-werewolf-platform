import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { UnauthenticatedError } from '@agent-poker/auth';
import type { IAuthService } from '@agent-poker/auth';

declare module 'fastify' {
  interface FastifyRequest {
    jwtUser?: { userId: string; jwt: string };
  }
  interface FastifyInstance {
    requireJwtAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export interface JwtAuthenticatedRequest extends FastifyRequest {
  jwtUser: { userId: string; jwt: string };
}

export function registerJwtAuthMiddleware(app: FastifyInstance, authService: IAuthService): void {
  app.decorate(
    'requireJwtAuth',
    async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      try {
        const { userId, jwt } = await authService.verifyJwt(req.headers.authorization);
        req.jwtUser = { userId, jwt };
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Auth failed';
        throw new UnauthenticatedError(`Invalid or missing credentials: ${message}`);
      }
    },
  );
}
