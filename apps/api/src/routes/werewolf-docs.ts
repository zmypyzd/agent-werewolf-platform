import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

// Public, unauthenticated endpoint that serves the werewolf HTTP-agent guide.
// External invited agents need a stable URL they can curl/inspect without
// holding a session cookie — pointing WEREWOLF_BRIEFING_DOCS_URL at this
// endpoint lets every decision request advertise it via briefing.docsUrl.
//
// The doc lives in the repo at docs/werewolf-http-agent-guide.md. We resolve
// it relative to this source/dist file so dev (tsx/vitest) and built (dist)
// runs both find it; deployments that strip the docs/ folder will get a 404
// from this route, which is the correct signal.
//
// Read once at first request and cache — the file is < 20 kB and immutable
// for the process lifetime.

const HERE = dirname(fileURLToPath(import.meta.url));
// routes/werewolf-docs.{ts,js} → apps/api/src/routes or apps/api/dist/routes
// → repo root is 4 levels up in either layout.
const DOC_PATH = resolve(HERE, '../../../../docs/werewolf-http-agent-guide.md');

let cached: string | null = null;
let cacheError: Error | null = null;

async function loadDoc(): Promise<string> {
  if (cached !== null) return cached;
  if (cacheError !== null) throw cacheError;
  try {
    const content = await readFile(DOC_PATH, 'utf8');
    cached = content;
    return content;
  } catch (err) {
    cacheError = err instanceof Error ? err : new Error(String(err));
    throw cacheError;
  }
}

export async function werewolfDocsRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
) {
  app.get('/docs/werewolf-agent-guide', async (_req, reply) => {
    try {
      const body = await loadDoc();
      reply
        .type('text/markdown; charset=utf-8')
        .header('cache-control', 'public, max-age=300')
        .send(body);
    } catch {
      reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message:
            'werewolf-http-agent-guide.md not bundled with this deployment',
          statusCode: 404,
        },
      });
    }
  });
}

// Exported for tests that want to bypass the file-system lookup (e.g. unit
// tests that don't ship docs/ alongside the test runner).
export function __resetWerewolfDocsCacheForTests(): void {
  cached = null;
  cacheError = null;
}
