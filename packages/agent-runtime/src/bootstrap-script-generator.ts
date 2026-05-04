/**
 * Generates a self-contained Node.js script that a coding agent
 * (Claude Code, Cursor, etc.) can save and run to join a poker table.
 *
 * The script uses only Node.js built-ins — zero npm dependencies.
 */

export interface BootstrapScriptOptions {
  inviteToken: string;
  platformBaseUrl: string;
  defaultBuyIn: number;
  agentName?: string | undefined;
}

export function generateBootstrapScript(opts: BootstrapScriptOptions): string {
  const name = opts.agentName ?? 'CodingAgent';
  return `#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// Agent Poker Platform — Bootstrap Agent Script
// Generated for invite token: ${opts.inviteToken}
// Platform: ${opts.platformBaseUrl}
// ═══════════════════════════════════════════════════════════════════════
//
// Usage:  node poker-agent.js
//
// This script:
//   1. Starts a local HTTP server on a random port
//   2. Joins the poker table via the invite link
//   3. Handles decision requests from the platform
//
// Customize the makeDecision() function below to implement your strategy.
// No npm install needed — uses only Node.js built-in modules.
// ═══════════════════════════════════════════════════════════════════════

const http = require('http');

// ─── Configuration ───────────────────────────────────────────────────
const INVITE_TOKEN = '${opts.inviteToken}';
const PLATFORM_BASE = '${opts.platformBaseUrl}';
const JOIN_URL = PLATFORM_BASE + '/api/v1/invites/' + INVITE_TOKEN + '/join';
const AGENT_NAME = '${name}';
const BUY_IN = ${opts.defaultBuyIn};

// ┌──────────────────────────────────────────────────────────────────┐
// │  CUSTOMIZE YOUR STRATEGY HERE                                    │
// │                                                                  │
// │  request.legalActions = [{ type, callAmount?, minAmount?,        │
// │                            maxAmount? }]                         │
// │  request.publicState   = { phase, communityCards, pots,          │
// │                            players, ... }                        │
// │  request.privateState  = { holeCards: [{rank, suit}, ...] }      │
// │                                                                  │
// │  Return: { actionType, amount? }                                 │
// │  actionType: 'fold' | 'check' | 'call' | 'bet' | 'raise' |     │
// │              'all-in'                                            │
// └──────────────────────────────────────────────────────────────────┘
function makeDecision(request) {
  const actions = request.legalActions;

  // Default strategy: call > check > fold
  const call = actions.find(a => a.type === 'call');
  if (call) return { actionType: 'call' };

  const check = actions.find(a => a.type === 'check');
  if (check) return { actionType: 'check' };

  return { actionType: 'fold' };
}
// ┌──────────────────────────────────────────────────────────────────┐
// │  END STRATEGY — Code below handles server & platform connection  │
// └──────────────────────────────────────────────────────────────────┘

// ─── HTTP Server ─────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', agent: AGENT_NAME }));
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const request = JSON.parse(body);
        const decision = makeDecision(request);
        const response = {
          requestId: request.requestId,
          agentId: request.agentId,
          actionType: decision.actionType,
          ...(decision.amount !== undefined ? { amount: decision.amount } : {}),
        };
        console.log(
          '[decision]',
          request.publicState.phase,
          '| hand:', request.privateState.holeCards.map(c => c.rank + c.suit).join(' '),
          '| action:', response.actionType,
          response.amount !== undefined ? response.amount : '',
        );
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (err) {
        console.error('[error] Failed to process request:', err.message);
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

// ─── Join Table ──────────────────────────────────────────────────────
function joinTable(endpointUrl) {
  const payload = JSON.stringify({
    name: AGENT_NAME,
    endpointUrl: endpointUrl,
    timeoutMs: 5000,
    buyIn: BUY_IN,
  });

  const url = new URL(JOIN_URL);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error('Join failed (' + res.statusCode + '): ' + data));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Start ───────────────────────────────────────────────────────────
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const endpointUrl = 'http://127.0.0.1:' + port;
  console.log('[agent] ' + AGENT_NAME + ' listening on ' + endpointUrl);

  try {
    const result = await joinTable(endpointUrl);
    console.log('[agent] Joined table!', JSON.stringify(result.data));
    console.log('[agent] Waiting for hands to start...');
  } catch (err) {
    console.error('[agent] Failed to join:', err.message);
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGINT', () => { console.log('[agent] Shutting down...'); server.close(); process.exit(0); });
process.on('SIGTERM', () => { server.close(); process.exit(0); });
`;
}
