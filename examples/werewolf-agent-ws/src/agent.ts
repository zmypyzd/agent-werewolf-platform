import { WerewolfAgent, type WerewolfAction, type WerewolfDecisionRequest } from '@agent-werewolf/agent-sdk';

// Read the connection URL + bearer token from env vars. Both come back
// in the registration response (POST /api/v1/agents/invites/<token>/register
// with `transport: { kind: "ws" }`):
//   { data: { wsConnect: { url, token } } }
const url = required('WEREWOLF_AGENT_WS_URL');
const token = required('WEREWOLF_AGENT_WS_TOKEN');

new WerewolfAgent({
  url,
  token,
  decide,
}).start();

// Your strategy goes here. Return any element of req.validActions, or
// throw — the SDK forwards a thrown error as decide.error and the
// orchestrator falls back. For a demo, we just pick the first valid action;
// see examples/werewolf-agent/src/server.ts for a more thoughtful baseline
// that distinguishes role/phase and writes seat speeches.
function decide(req: WerewolfDecisionRequest): WerewolfAction {
  return req.validActions[0]!;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name}.`);
    console.error(
      `Get its value from POST /api/v1/agents/invites/<token>/register with body { "displayName": "...", "transport": { "kind": "ws" } } — the response contains data.wsConnect.{url,token}.`,
    );
    process.exit(1);
  }
  return v;
}
