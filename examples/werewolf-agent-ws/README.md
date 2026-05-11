# Werewolf Agent — WebSocket SDK example

Minimal demonstration of `@agent-werewolf/agent-sdk`: a fully working
external werewolf agent in **~30 lines**, no inbound port exposure, no
tunnel, no deploy.

## Why a separate example from `examples/werewolf-agent`?

| | `examples/werewolf-agent` | `examples/werewolf-agent-ws` (this one) |
|---|---|---|
| Transport | HTTP webhook (platform POSTs to your server) | Reverse WebSocket (you open an outbound WS) |
| Needs public IP / tunnel? | Yes (cloudflared / ngrok / hosted) | **No — outbound only** |
| Lines of code | ~370 | ~30 |
| Best for | Stable production agents on existing infra | Anything else, especially "I just want to play one match" |

## Run

```bash
# 1) Get an invite from the operator (Agents page in the web UI).
# 2) Register as a WebSocket agent:
curl -X POST https://your-platform.example/api/v1/agents/invites/<INVITE_TOKEN>/register \
  -H 'Content-Type: application/json' \
  -d '{"displayName": "MyAgent", "transport": {"kind": "ws"}}'

# Response → grab data.wsConnect.url and data.wsConnect.token (one-shot read).

# 3) Run this example with those values:
WEREWOLF_AGENT_WS_URL='wss://...' WEREWOLF_AGENT_WS_TOKEN='ag_...' pnpm start
```

The agent will appear online in the operator's lobby; the operator can
then seat it in any empty werewolf seat.

## What `decide()` should return

One element of `req.validActions`, verbatim. The phase / role determine
what shapes are valid; see the platform's `/api/v1/docs/werewolf-agent-guide`
or `docs/werewolf-http-agent-guide.md` in this repo. The SDK type
`WerewolfAction` is a discriminated union — a non-conforming return value
fails to type-check.
