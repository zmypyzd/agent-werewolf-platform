import type {
  ActionType,
  AgentDecisionRequest,
  AgentDecisionResponse,
  ReasoningConsideredAction,
  ReasoningIntent,
  ReasoningRiskLevel,
  ReasoningSummary,
} from '@agent-poker/shared'
import type { IAgent } from './agent-interface.js'

export type NpcPersonality =
  | 'tight-aggressive'
  | 'loose-passive'
  | 'balanced'
  | 'maniac'

export interface NpcConfig {
  thinkingDelayRange: [min: number, max: number]
  personality: NpcPersonality
}

const DEFAULT_CONFIG: NpcConfig = {
  thinkingDelayRange: [1200, 3000],
  personality: 'balanced',
}

export class NpcAgent implements IAgent<AgentDecisionRequest, AgentDecisionResponse> {
  readonly agentId: string
  readonly name: string
  private readonly inner: IAgent
  private readonly config: NpcConfig

  constructor(
    agentId: string,
    name: string,
    inner: IAgent,
    config?: Partial<NpcConfig>,
  ) {
    this.agentId = agentId
    this.name = name
    this.inner = inner
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async requestDecision(
    req: AgentDecisionRequest,
  ): Promise<AgentDecisionResponse> {
    const decision = await this.inner.requestDecision(req)

    const [min, max] = this.config.thinkingDelayRange
    const delay = min + Math.random() * (max - min)
    await new Promise<void>((resolve) => setTimeout(resolve, delay))

    decision.reasoningSummary = generateReasoning(
      decision,
      req,
      this.config.personality,
    )
    return decision
  }
}

function generateReasoning(
  decision: AgentDecisionResponse,
  req: AgentDecisionRequest,
  personality: NpcPersonality,
): ReasoningSummary {
  const intent = pickIntent(decision.actionType, personality)
  const riskLevel = pickRiskLevel(decision.actionType)
  const confidence = pickConfidence(decision.actionType, personality)
  const keyObservations = pickObservations(req, decision, personality)
  const consideredActions = pickConsideredActions(req, decision)

  return { intent, confidence, riskLevel, keyObservations, consideredActions }
}

function pickIntent(
  action: ActionType,
  personality: NpcPersonality,
): ReasoningIntent {
  const intents: Record<ActionType, ReasoningIntent[]> = {
    fold: ['pot_control', 'survival'],
    check: ['pot_control', 'information'],
    call: ['information', 'pot_control', 'value'],
    bet: ['value', 'bluff', 'protection'],
    raise: ['value', 'bluff', 'semi_bluff', 'protection'],
    'all-in': ['value', 'bluff'],
  }

  const pool = intents[action] ?? ['unknown']

  if (personality === 'maniac' && (action === 'raise' || action === 'all-in'))
    return 'bluff'
  if (personality === 'tight-aggressive' && action === 'raise') return 'value'
  if (personality === 'loose-passive' && action === 'call')
    return 'information'

  return pool[Math.floor(Math.random() * pool.length)]!
}

function pickRiskLevel(action: ActionType): ReasoningRiskLevel {
  if (action === 'fold' || action === 'check') return 'low'
  if (action === 'call') return 'medium'
  if (action === 'all-in') return 'high'
  return Math.random() < 0.5 ? 'medium' : 'high'
}

function pickConfidence(
  action: ActionType,
  personality: NpcPersonality,
): number {
  const base: Record<ActionType, [number, number]> = {
    fold: [0.55, 0.75],
    check: [0.5, 0.7],
    call: [0.5, 0.7],
    bet: [0.6, 0.85],
    raise: [0.65, 0.9],
    'all-in': [0.7, 0.95],
  }

  const [lo, hi] = base[action] ?? [0.5, 0.7]
  let value = lo + Math.random() * (hi - lo)

  if (personality === 'tight-aggressive') value = Math.min(value + 0.05, 1)
  if (personality === 'maniac') value = Math.max(value - 0.08, 0)

  return Math.round(value * 100) / 100
}

const OBSERVATION_TEMPLATES = {
  position: [
    'Late position provides fold equity',
    'Early position calls for caution',
    'Button position allows wider range',
  ],
  potOdds: [
    'Pot odds favor a call here',
    'Getting good implied odds to continue',
    'Pot size warrants aggression',
  ],
  board: [
    'Board texture is relatively dry',
    'Wet board increases draw potential',
    'Paired board reduces opponent combinations',
    'Coordinated board favors connected ranges',
  ],
  opponent: [
    'Opponent showing weakness with checks',
    'Betting pattern suggests medium strength',
    'Aggression from opponent signals strength',
    'Multiple opponents still in the hand',
  ],
  strength: [
    'Current holding has showdown value',
    'Hand strength warrants protection bet',
    'Position and range advantage here',
    'Marginal hand needs pot control',
  ],
}

function pickObservations(
  req: AgentDecisionRequest,
  decision: AgentDecisionResponse,
  personality: NpcPersonality,
): string[] {
  const observations: string[] = []
  const categories = Object.keys(
    OBSERVATION_TEMPLATES,
  ) as (keyof typeof OBSERVATION_TEMPLATES)[]

  // Pick 2-3 observations from different categories
  const shuffled = categories.sort(() => Math.random() - 0.5)
  const count = 2 + Math.floor(Math.random() * 2)

  for (let i = 0; i < count && i < shuffled.length; i++) {
    const pool = OBSERVATION_TEMPLATES[shuffled[i]!]!
    observations.push(pool[Math.floor(Math.random() * pool.length)]!)
  }

  // Add personality-specific observation
  if (personality === 'tight-aggressive' && decision.actionType === 'fold') {
    observations.push('Discipline to fold marginal hands is key')
  } else if (
    personality === 'maniac' &&
    (decision.actionType === 'raise' || decision.actionType === 'all-in')
  ) {
    observations.push('Maximum pressure forces opponents into difficult spots')
  }

  return observations.slice(0, 5)
}

function pickConsideredActions(
  req: AgentDecisionRequest,
  decision: AgentDecisionResponse,
): ReasoningConsideredAction[] {
  const result: ReasoningConsideredAction[] = []

  // The chosen action always appears
  result.push({
    actionType: decision.actionType,
    ...(decision.amount !== undefined ? { amount: decision.amount } : {}),
    reason: 'Best expected value given current game state',
  })

  // Add 1-2 alternatives from legal actions
  const alternatives = req.legalActions.filter(
    (a) => a.type !== decision.actionType,
  )
  const altReasons: Record<string, string> = {
    fold: 'Minimize losses with a weak holding',
    check: 'Control pot size and gain information',
    call: 'See another card at a reasonable price',
    bet: 'Build the pot with a strong hand',
    raise: 'Apply pressure and extract value',
    'all-in': 'Maximize fold equity with a shove',
  }

  const shuffledAlts = alternatives.sort(() => Math.random() - 0.5)
  const altCount = Math.min(1 + Math.floor(Math.random() * 2), shuffledAlts.length)

  for (let i = 0; i < altCount; i++) {
    const alt = shuffledAlts[i]!
    result.push({
      actionType: alt.type,
      ...(alt.minAmount !== undefined ? { amount: alt.minAmount } : {}),
      reason: altReasons[alt.type] ?? 'Alternative play considered',
    })
  }

  return result.slice(0, 6)
}
