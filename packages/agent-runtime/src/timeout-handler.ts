import type { AgentDecisionRequest, AgentDecisionResponse, LegalAction } from '@agent-poker/shared';
import type { IAgent } from './agent-interface.js';

export interface TimeoutResult<TRes> {
  response: TRes;
  timedOut: boolean;
}

export type FallbackBuilder<TReq, TRes> = (req: TReq) => TRes;

export class TimeoutHandler<
  TReq = AgentDecisionRequest,
  TRes = AgentDecisionResponse,
> {
  constructor(
    private readonly agent: IAgent<TReq, TRes>,
    private readonly timeoutMs: number,
    private readonly fallback: FallbackBuilder<TReq, TRes>,
  ) {}

  async requestDecision(req: TReq): Promise<TimeoutResult<TRes>> {
    return new Promise((resolve) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ response: this.fallback(req), timedOut: true });
        }
      }, this.timeoutMs);

      this.agent
        .requestDecision(req)
        .then((response) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ response, timedOut: false });
          }
        })
        .catch(() => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ response: this.fallback(req), timedOut: true });
          }
        });
    });
  }
}

// Poker-specific fallback preserved for poker call sites that previously relied on
// TimeoutHandler picking 'check' when available else 'fold'. Pass this explicitly
// when constructing a poker TimeoutHandler.
export function pokerFallback(
  req: AgentDecisionRequest,
): AgentDecisionResponse {
  const hasCheck = req.legalActions.some((a: LegalAction) => a.type === 'check');
  return {
    requestId: req.requestId,
    agentId: req.agentId,
    actionType: hasCheck ? 'check' : 'fold',
  };
}
