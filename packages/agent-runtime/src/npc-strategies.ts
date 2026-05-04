import type { AgentDecisionRequest, AgentDecisionResponse } from '@agent-poker/shared'
import { MockAgent } from './mock-agent.js'

export class TightAggressiveAgent extends MockAgent {
  async requestDecision(
    req: AgentDecisionRequest,
  ): Promise<AgentDecisionResponse> {
    const actions = req.legalActions
    if (actions.length === 0) return this.fallbackAction(req)

    const raise = actions.find((a) => a.type === 'raise')
    if (raise) {
      const min = raise.minAmount ?? 0
      const max = raise.maxAmount ?? min
      const amount = min + Math.floor((max - min) * 0.6)
      return {
        requestId: req.requestId,
        agentId: this.agentId,
        actionType: 'raise',
        amount,
      }
    }

    const bet = actions.find((a) => a.type === 'bet')
    if (bet) {
      const min = bet.minAmount ?? 0
      const max = bet.maxAmount ?? min
      const amount = min + Math.floor((max - min) * 0.5)
      return {
        requestId: req.requestId,
        agentId: this.agentId,
        actionType: 'bet',
        amount,
      }
    }

    // With ~40% probability fold marginal spots, otherwise call
    if (Math.random() < 0.4) {
      const fold = actions.find((a) => a.type === 'fold')
      if (fold) {
        return {
          requestId: req.requestId,
          agentId: this.agentId,
          actionType: 'fold',
        }
      }
    }

    const action = this.firstLegal(req, ['call', 'check', 'fold'])
    if (!action) return this.fallbackAction(req)
    return {
      requestId: req.requestId,
      agentId: this.agentId,
      actionType: action.type,
    }
  }
}

export class LoosePassiveAgent extends MockAgent {
  async requestDecision(
    req: AgentDecisionRequest,
  ): Promise<AgentDecisionResponse> {
    const actions = req.legalActions
    if (actions.length === 0) return this.fallbackAction(req)

    // Rarely fold (~10%), mostly call
    if (Math.random() < 0.1) {
      const fold = actions.find((a) => a.type === 'fold')
      if (fold) {
        return {
          requestId: req.requestId,
          agentId: this.agentId,
          actionType: 'fold',
        }
      }
    }

    const action = this.firstLegal(req, ['call', 'check', 'fold'])
    if (!action) return this.fallbackAction(req)
    return {
      requestId: req.requestId,
      agentId: this.agentId,
      actionType: action.type,
    }
  }
}

export class BalancedAgent extends MockAgent {
  async requestDecision(
    req: AgentDecisionRequest,
  ): Promise<AgentDecisionResponse> {
    const actions = req.legalActions
    if (actions.length === 0) return this.fallbackAction(req)

    const roll = Math.random()
    // 30% raise, 35% call, 20% check, 15% fold
    if (roll < 0.3) {
      const raise = actions.find((a) => a.type === 'raise')
      if (raise) {
        const min = raise.minAmount ?? 0
        const max = raise.maxAmount ?? min
        const amount = min + Math.floor(Math.random() * (max - min + 1))
        return {
          requestId: req.requestId,
          agentId: this.agentId,
          actionType: 'raise',
          amount,
        }
      }
      const bet = actions.find((a) => a.type === 'bet')
      if (bet) {
        const min = bet.minAmount ?? 0
        const max = bet.maxAmount ?? min
        const amount = min + Math.floor(Math.random() * (max - min + 1))
        return {
          requestId: req.requestId,
          agentId: this.agentId,
          actionType: 'bet',
          amount,
        }
      }
    } else if (roll < 0.65) {
      const action = this.firstLegal(req, ['call', 'check'])
      if (action) {
        return {
          requestId: req.requestId,
          agentId: this.agentId,
          actionType: action.type,
        }
      }
    } else if (roll < 0.85) {
      const check = actions.find((a) => a.type === 'check')
      if (check) {
        return {
          requestId: req.requestId,
          agentId: this.agentId,
          actionType: 'check',
        }
      }
    }

    // Fallback: fold or whatever is available
    const action = this.firstLegal(req, ['fold', 'check', 'call'])
    if (!action) return this.fallbackAction(req)
    return {
      requestId: req.requestId,
      agentId: this.agentId,
      actionType: action.type,
    }
  }
}

export class ManiacAgent extends MockAgent {
  async requestDecision(
    req: AgentDecisionRequest,
  ): Promise<AgentDecisionResponse> {
    const actions = req.legalActions
    if (actions.length === 0) return this.fallbackAction(req)

    // 30% chance all-in
    const allin = actions.find((a) => a.type === 'all-in')
    if (allin && Math.random() < 0.3) {
      return {
        requestId: req.requestId,
        agentId: this.agentId,
        actionType: 'all-in',
        ...(allin.maxAmount !== undefined ? { amount: allin.maxAmount } : {}),
      }
    }

    // Otherwise max raise
    const raise = actions.find((a) => a.type === 'raise')
    if (raise) {
      return {
        requestId: req.requestId,
        agentId: this.agentId,
        actionType: 'raise',
        amount: raise.maxAmount ?? raise.minAmount ?? 0,
      }
    }

    const bet = actions.find((a) => a.type === 'bet')
    if (bet) {
      return {
        requestId: req.requestId,
        agentId: this.agentId,
        actionType: 'bet',
        amount: bet.maxAmount ?? bet.minAmount ?? 0,
      }
    }

    // Never fold voluntarily
    const action = this.firstLegal(req, ['call', 'check', 'all-in', 'fold'])
    if (!action) return this.fallbackAction(req)
    return {
      requestId: req.requestId,
      agentId: this.agentId,
      actionType: action.type,
      ...(action.type === 'all-in' && action.maxAmount !== undefined
        ? { amount: action.maxAmount }
        : {}),
    }
  }
}
