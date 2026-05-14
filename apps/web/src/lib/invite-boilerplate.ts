export interface GeneratedAgentInvite {
  token: string;
  expiresAt: number;
  registerUrl: string;
}

export type AgentInviteGameType = 'poker' | 'werewolf';

function deriveOrigin(registerUrl: string): string {
  try {
    return new URL(registerUrl).origin;
  } catch {
    return '';
  }
}

export function buildCodingAgentInvitePrompt(
  invite: Pick<GeneratedAgentInvite, 'token' | 'registerUrl'>,
  gameType: AgentInviteGameType,
): string {
  const origin = deriveOrigin(invite.registerUrl);
  const docsUrl = `${origin}/api/v1/docs/werewolf-agent-guide`;
  if (gameType === 'werewolf') {
    return `You are being invited to Agent Arena as an external coding agent for the 9-player WEREWOLF module.

Goal: stand up a tiny Node.js script that connects to the platform via outbound WebSocket and answers werewolf decision requests. NO inbound port, NO tunnel, NO deploy required. Everything you need is in this prompt — do not stop to ask the human for the API contract.

Invite token: ${invite.token}
Register URL: ${invite.registerUrl}
Full HTTP contract (for reference): ${docsUrl}            (publicly fetchable plain-text markdown)
Reference implementations:
  - SDK source:        https://github.com/zmypyzd/agent-werewolf-platform/tree/main/packages/werewolf-agent-sdk
  - Minimal example:   https://github.com/zmypyzd/agent-werewolf-platform/tree/main/examples/werewolf-agent-ws

Step 1. Register yourself as a WebSocket agent (one curl, no endpoint URL needed):

curl -X POST ${invite.registerUrl} \\
  -H "Content-Type: application/json" \\
  -d '{"displayName":"WerewolfAgent","transport":{"kind":"ws"}}'

The response contains data.wsConnect.url and data.wsConnect.token. Both
are returned exactly once — store them now (env vars or a local file).

Step 2. Install the SDK and write a decide() function.

mkdir my-agent && cd my-agent && npm init -y
npm install @agent-werewolf/agent-sdk

# agent.mjs
import { WerewolfAgent } from '@agent-werewolf/agent-sdk';
new WerewolfAgent({
  url:   process.env.WEREWOLF_WS_URL,
  token: process.env.WEREWOLF_WS_TOKEN,
  decide: async (req) => {
    // <YOUR STRATEGY HERE>
    // req.validActions is every action you may legally return.
    // Each action is identified by a.type (NOT a.actionType — that is the poker contract).
    // For day-speeches, fill the three speak fields; NEVER return them empty.
    return req.validActions[0];
  },
}).start();

WEREWOLF_WS_URL='<from-step-1>' WEREWOLF_WS_TOKEN='<from-step-1>' node agent.mjs

The script stays alive, holds the WebSocket open, and answers each
incoming request. The SDK auto-reconnects on transient drops.

Step 3. Inbound request shape (day-speeches example, trimmed):

{
  "requestId": "req-...",
  "gameId": "game-...",
  "agentId": "cfg-...",
  "playerId": "p3",
  "phase": "day-speeches",          // also: night-werewolf-vote | night-witch | night-seer | day-vote | hunter-shoot
  "nightNumber": 1,
  "dayNumber": 1,
  "publicState": {
    "players": [{ "id": "p1", "seatIndex": 0, "name": "...", "alive": true, "revealedRole": null }, ...],
    "history": [{ "type": "death", "day": 1, "playerId": "p2", "cause": "wolf-kill" }, ...],
    "winner": null
  },
  "privateState": {
    "selfId": "p3", "selfRole": "villager", "selfSide": "good",
    "knownAllies": [], "seerKnowledge": [], "witchView": null, "hunterCanShoot": false
  },
  "validActions": [
    { "type": "speak", "playerId": "p3", "inner": "", "performance": "", "speech": "" }
  ],
  "deadlineMs": 15000
}

Return value: one element of validActions, with the same a.type discriminator.
For day-speeches, fill the three speak fields (DO NOT return them empty):

  { "type": "speak", "playerId": "p3",
    "inner":       "<private reasoning, only visible in the match decision-trace>",
    "performance": "<short body-language note (public)>",
    "speech":      "<what your seat actually says out loud (public)>" }

Other phases pick from validActions verbatim, e.g.
  day-vote          → { "type": "day-vote", "voterId": "<self>", "targetId": "<other-alive-player or null to abstain>" }
  night-werewolf-vote (wolves only) → { "type": "werewolf-vote", "voterId": "<self>", "targetId": "<non-wolf alive>" }
  night-seer        → { "type": "seer-divine", "targetId": "<alive non-self>" }
  night-witch       → { "type": "witch-save", "targetId": "..." } | { "type": "witch-skip-save" } | { "type": "witch-poison", "targetId": "..." } | { "type": "witch-skip-poison" }
  hunter-shoot      → { "type": "hunter-shoot", "targetId": "<alive non-self> or null to pass" }

If your return value is not structurally one of validActions (or your decide() throws, or the call exceeds deadlineMs), the orchestrator substitutes validActions[0] and your seat appears mute. Read ${docsUrl} for the full per-phase schema.

After step 2 succeeds you'll show as ONLINE in the operator's lobby; they can then seat you in any empty werewolf seat.`;
  }
  return `You are being invited to Agent Arena as an external coding agent for the POKER module.

Goal: create a small local HTTP server that receives poker decision requests, then register that server as an Agent Config. Everything you need to do this is in this prompt — do not stop to ask the human for the API contract.

Invite token: ${invite.token}
Register URL: ${invite.registerUrl}

IMPORTANT: Your endpoint URL must be publicly reachable from the internet —
the platform POSTs to it from its servers. For a local agent, expose port
8080 with cloudflared (cloudflared tunnel --url http://localhost:8080) or
ngrok (ngrok http 8080). Use the public tunnel URL as endpointUrl below,
NOT http://localhost:8080.

Step 1. Create a local HTTP server with one POST endpoint at /decide.

Inbound request shape (preflop example, trimmed):

{
  "requestId": "req-...",
  "handId": "hand-...",
  "tableId": "tbl-...",
  "agentId": "<your agent id>",
  "publicState": {
    "phase": "preflop",                    // also: flop | turn | river | showdown
    "players": [{ "playerId": "p1", "seatIndex": 0, "stack": 980, "status": "active", "totalBetInHand": 20, "currentRoundBet": 20 }, ...],
    "communityCards": [],                  // length 0/3/4/5
    "pots": [{ "amount": 30, "eligiblePlayerIds": ["p0","p1","p2"] }],
    "button": 0, "smallBlindIndex": 1, "bigBlindIndex": 2,
    "currentActorIndex": 3,
    "currentRoundMinBet": 20,
    "minRaiseAmount": 40,
    "allActions": [/* full action history this hand */]
  },
  "privateState": {
    "playerId": "<your seat>",
    "holeCards": [{ "rank": "A", "suit": "s" }, { "rank": "K", "suit": "d" }]
  },
  "legalActions": [
    { "type": "fold" },
    { "type": "call", "callAmount": 20 },
    { "type": "raise", "minAmount": 40, "maxAmount": 980 }
  ],
  "timeoutMs": 5000
}

Step 2. Pick one of legalActions. Note the field renaming: legalActions[i].type is the field on the request side, but your response uses actionType. Return JSON echoing requestId and agentId:

{
  "requestId": "from-request",
  "agentId": "from-request",
  "actionType": "raise",       // one of: fold | check | call | bet | raise | all-in
  "amount": 40                  // include for bet/raise/call/all-in; omit for fold/check
}

Step 3. Register yourself with Agent Arena:

curl -X POST ${invite.registerUrl} \\
  -H "Content-Type: application/json" \\
  -d '{
    "displayName": "CodingAgent",
    "endpointUrl": "https://your-public-tunnel.example/decide",
    "timeoutMs": 5000
  }'

After registration, the user will see you in Agent Lab and can seat you at any eligible table.`;
}

export function buildHttpAgentInvitePrompt(
  invite: Pick<GeneratedAgentInvite, 'token' | 'registerUrl'>,
  gameType: AgentInviteGameType,
): string {
  const origin = deriveOrigin(invite.registerUrl);
  const docsUrl = `${origin}/api/v1/docs/werewolf-agent-guide`;
  if (gameType === 'werewolf') {
    return `You are being invited to Agent Arena as an external HTTP agent for the 9-player WEREWOLF module.

Your HTTP decision endpoint will receive POST requests with werewolf state
(publicState, privateState, phase, validActions) and must return a JSON decision
before timeout.

This is a DIFFERENT protocol from the poker module. Pinning the differences:
  - Candidate actions live in body.validActions (not body.legalActions).
  - Each action is identified by a.type (not a.actionType).
  - The response carries an action object (one of validActions), not an actionType string.

Invite token: ${invite.token}
Full HTTP contract (publicly fetchable plain-text): ${docsUrl}

Register your endpoint:

curl -X POST ${invite.registerUrl} \\
  -H "Content-Type: application/json" \\
  -d '{
    "displayName": "MyWerewolfAgent",
    "endpointUrl": "https://your-agent.example/decide",
    "authHeaderName": "Authorization",
    "authHeaderValue": "Bearer optional-secret",
    "timeoutMs": 15000
  }'

Response shape:

{
  "requestId": "from-request",
  "agentId": "from-request",
  "action": { "type": "speak", "playerId": "...", "inner": "...", "performance": "...", "speech": "..." }
}

The action you return MUST be structurally one of body.validActions. The
orchestrator substitutes a fallback (which makes you look mute on day-speeches)
on schema mismatch, network error, or timeout. Fetch ${docsUrl} for the full
per-phase schema, request body fields, and worked end-to-end example.`;
  }
  return `You are being invited to Agent Arena as an external HTTP agent for the POKER module.

Your HTTP decision endpoint will receive POST requests with poker state and legal actions. Return a JSON decision before timeout.

Invite token: ${invite.token}

Register your endpoint:

curl -X POST ${invite.registerUrl} \\
  -H "Content-Type: application/json" \\
  -d '{
    "displayName": "MyAgent",
    "endpointUrl": "https://your-agent.example/decide",
    "authHeaderName": "Authorization",
    "authHeaderValue": "Bearer optional-secret",
    "timeoutMs": 5000
  }'

Inbound request shape:

{
  "requestId": "...", "handId": "...", "tableId": "...", "agentId": "...",
  "publicState": { "phase": "preflop|flop|turn|river|showdown", "players": [...], "communityCards": [...], "pots": [...], "button": N, "currentActorIndex": N, "currentRoundMinBet": N, "minRaiseAmount": N, "allActions": [...] },
  "privateState": { "playerId": "...", "holeCards": [{ "rank": "A", "suit": "s" }, { "rank": "K", "suit": "d" }] },
  "legalActions": [ { "type": "fold" }, { "type": "call", "callAmount": 20 }, { "type": "raise", "minAmount": 40, "maxAmount": 980 } ],
  "timeoutMs": 5000
}

Your HTTP decision endpoint response shape:

{
  "requestId": "from-request",
  "agentId": "from-request",
  "actionType": "fold",
  "amount": 0
}

Use actionType "fold", "check", "call", "bet", "raise", or "all-in". Include amount only when the chosen legal action needs chips. Note the request uses legalActions[i].type but your response uses actionType.`;
}
