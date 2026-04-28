import { useReducer, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  api,
  type SimulateRequest,
  type SimulationStrategy,
} from '../lib/api.js';

export const MAX_SIMULATION_HANDS = 20;

const SIMULATION_STRATEGIES = [
  'random',
  'always-call',
  'always-fold',
  'aggressive',
] as const satisfies readonly SimulationStrategy[];

const STRATEGY_LABELS = {
  random: 'Random',
  'always-call': 'Always call',
  'always-fold': 'Always fold',
  aggressive: 'Aggressive',
} satisfies Record<SimulationStrategy, string>;

export interface SimulateAgentFormState {
  name: string;
  strategy: SimulationStrategy;
  buyIn: number;
}

export interface SimulateFormState {
  name: string;
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  seed: string;
  defaultTimeoutMs: number;
  numHands: number;
  agents: SimulateAgentFormState[];
}

export type SimulateRequestResult =
  | { ok: true; request: SimulateRequest }
  | { ok: false; error: string };

export interface SimulateSubmissionState {
  error: string | null;
  matchId: string | null;
  submitting: boolean;
}

export type SimulateSubmissionTransition =
  | { type: 'submit-start' }
  | { type: 'validation-error'; error: string }
  | { type: 'api-error'; error: string }
  | { type: 'api-success'; matchId: string };

const defaultFormState: SimulateFormState = {
  name: 'Research simulation',
  maxSeats: 6,
  smallBlind: 25,
  bigBlind: 50,
  ante: 0,
  seed: '',
  defaultTimeoutMs: 5000,
  numHands: 5,
  agents: [
    { name: 'Random Bot', strategy: 'random', buyIn: 2000 },
    { name: 'Caller Bot', strategy: 'always-call', buyIn: 2000 },
  ],
};

const initialSubmissionState: SimulateSubmissionState = {
  error: null,
  matchId: null,
  submitting: false,
};

export function reduceSimulateSubmissionState(
  _state: SimulateSubmissionState,
  transition: SimulateSubmissionTransition,
): SimulateSubmissionState {
  switch (transition.type) {
    case 'submit-start':
      return { error: null, matchId: null, submitting: true };
    case 'validation-error':
    case 'api-error':
      return { error: transition.error, matchId: null, submitting: false };
    case 'api-success':
      return { error: null, matchId: transition.matchId, submitting: false };
  }
}

export function buildSimulateRequest(input: SimulateFormState): SimulateRequestResult {
  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: 'Match name is required.' };
  }

  if (!Number.isInteger(input.maxSeats) || input.maxSeats < 2 || input.maxSeats > 9) {
    return { ok: false, error: 'Max seats must be between 2 and 9.' };
  }

  if (!Number.isInteger(input.smallBlind) || input.smallBlind < 1) {
    return { ok: false, error: 'Small blind must be at least 1.' };
  }

  if (!Number.isInteger(input.bigBlind) || input.bigBlind < input.smallBlind) {
    return { ok: false, error: 'Big blind must be greater than or equal to small blind.' };
  }

  if (!Number.isInteger(input.ante) || input.ante < 0) {
    return { ok: false, error: 'Ante cannot be negative.' };
  }

  if (!Number.isInteger(input.defaultTimeoutMs) || input.defaultTimeoutMs <= 0) {
    return { ok: false, error: 'Timeout must be greater than 0 ms.' };
  }

  if (!Number.isInteger(input.numHands) || input.numHands < 1) {
    return { ok: false, error: 'Number of hands must be at least 1.' };
  }

  if (input.numHands > MAX_SIMULATION_HANDS) {
    return { ok: false, error: 'Number of hands cannot exceed 20.' };
  }

  if (input.agents.length < 2) {
    return { ok: false, error: 'Add at least two agents.' };
  }

  if (input.agents.length > input.maxSeats) {
    return { ok: false, error: 'Agent count cannot exceed max seats.' };
  }

  const agents: SimulateRequest['agents'] = [];
  for (const [index, agent] of input.agents.entries()) {
    const agentName = agent.name.trim();
    const ordinal = index + 1;

    if (!agentName) {
      return { ok: false, error: `Agent ${ordinal} name is required.` };
    }

    if (!isSimulationStrategy(agent.strategy)) {
      return {
        ok: false,
        error: `Agent ${ordinal} strategy must be random, always-call, always-fold, or aggressive.`,
      };
    }

    if (!Number.isInteger(agent.buyIn) || agent.buyIn <= 0) {
      return { ok: false, error: `Agent ${ordinal} buy-in must be greater than 0 chips.` };
    }

    agents.push({
      name: agentName,
      strategy: agent.strategy,
      buyIn: agent.buyIn,
    });
  }

  const seed = input.seed.trim();
  return {
    ok: true,
    request: {
      name,
      maxSeats: input.maxSeats,
      blindConfig: {
        smallBlind: input.smallBlind,
        bigBlind: input.bigBlind,
        ante: input.ante,
      },
      ...(seed ? { seed } : {}),
      defaultTimeoutMs: input.defaultTimeoutMs,
      agents,
      numHands: input.numHands,
    },
  };
}

export function SimulationSuccessActions({ matchId }: { matchId: string }) {
  return (
    <section className="panel simulation-success" role="status" aria-live="polite">
      <div>
        <h2>Match generated</h2>
        <p className="muted">Replay artifact {matchId} is ready.</p>
      </div>
      <div className="page-actions">
        <Link className="button-primary" to={`/matches/${matchId}`}>Open replay</Link>
        <Link className="button-secondary" to="/matches">Match replays</Link>
      </div>
    </section>
  );
}

export function SimulatePage() {
  const [form, setForm] = useState<SimulateFormState>(defaultFormState);
  const [submission, dispatchSubmission] = useReducer(
    reduceSimulateSubmissionState,
    initialSubmissionState,
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    dispatchSubmission({ type: 'submit-start' });

    const result = buildSimulateRequest(form);
    if (!result.ok) {
      dispatchSubmission({ type: 'validation-error', error: result.error });
      return;
    }

    try {
      const response = await api.simulate(result.request);
      dispatchSubmission({ type: 'api-success', matchId: response.matchArtifact.matchId });
    } catch (e) {
      dispatchSubmission({
        type: 'api-error',
        error: e instanceof ApiError ? e.message : 'Failed to run simulation',
      });
    }
  }

  function updateField<K extends keyof Omit<SimulateFormState, 'agents'>>(
    field: K,
    value: SimulateFormState[K],
  ) {
    setForm(current => ({ ...current, [field]: value }));
  }

  function updateAgent<K extends keyof SimulateAgentFormState>(
    index: number,
    field: K,
    value: SimulateAgentFormState[K],
  ) {
    setForm(current => ({
      ...current,
      agents: current.agents.map((agent, agentIndex) =>
        agentIndex === index ? { ...agent, [field]: value } : agent,
      ),
    }));
  }

  function addAgent() {
    setForm(current => ({
      ...current,
      agents: [
        ...current.agents,
        {
          name: `Agent ${current.agents.length + 1}`,
          strategy: 'random',
          buyIn: 2000,
        },
      ],
    }));
  }

  function removeAgent(index: number) {
    setForm(current => ({
      ...current,
      agents: current.agents.filter((_, agentIndex) => agentIndex !== index),
    }));
  }

  return (
    <div className="page simulate-page">
      <div className="page-header">
        <div>
          <h1>Simulation Studio</h1>
          <p className="muted">Generate chip-based mock-agent matches for replay review.</p>
        </div>
        <div className="page-actions">
          <Link to="/matches">Match replays</Link>
          <Link to="/lobby">Lobby</Link>
        </div>
      </div>

      <div className="simulate-layout">
        <form className="panel simulate-form" onSubmit={onSubmit}>
          <section className="simulate-form-section" aria-label="Match configuration">
            <div className="section-heading">
              <div>
                <h2>Match setup</h2>
                <p className="muted">Configure blinds, timing, and run length.</p>
              </div>
              <span className="status-chip">{MAX_SIMULATION_HANDS}-hand cap</span>
            </div>

            <div className="simulate-field-grid">
              <label>
                Match name
                <input
                  value={form.name}
                  onChange={e => updateField('name', e.currentTarget.value)}
                  required
                  minLength={1}
                />
              </label>
              <label>
                Max seats
                <input
                  type="number"
                  min={2}
                  max={9}
                  value={form.maxSeats}
                  onChange={e => updateField('maxSeats', Number(e.currentTarget.value))}
                />
              </label>
              <label>
                Small blind
                <input
                  type="number"
                  min={1}
                  value={form.smallBlind}
                  onChange={e => updateField('smallBlind', Number(e.currentTarget.value))}
                />
              </label>
              <label>
                Big blind
                <input
                  type="number"
                  min={1}
                  value={form.bigBlind}
                  onChange={e => updateField('bigBlind', Number(e.currentTarget.value))}
                />
              </label>
              <label>
                Ante
                <input
                  type="number"
                  min={0}
                  value={form.ante}
                  onChange={e => updateField('ante', Number(e.currentTarget.value))}
                />
              </label>
              <label>
                Seed
                <input
                  value={form.seed}
                  onChange={e => updateField('seed', e.currentTarget.value)}
                  placeholder="Optional"
                />
              </label>
              <label>
                Timeout (ms)
                <input
                  type="number"
                  min={1}
                  value={form.defaultTimeoutMs}
                  onChange={e => updateField('defaultTimeoutMs', Number(e.currentTarget.value))}
                />
              </label>
              <label>
                Number of hands
                <input
                  type="number"
                  min={1}
                  max={MAX_SIMULATION_HANDS}
                  value={form.numHands}
                  onChange={e => updateField('numHands', Number(e.currentTarget.value))}
                />
              </label>
            </div>
          </section>

          <section className="simulate-form-section" aria-label="Agent configuration">
            <div className="section-heading">
              <div>
                <h2>Agents</h2>
                <p className="muted">Use mock strategies and buy-in chips for each seat.</p>
              </div>
              <button
                className="button-secondary"
                type="button"
                onClick={addAgent}
                disabled={form.agents.length >= form.maxSeats}
              >
                Add agent
              </button>
            </div>

            <div className="simulate-agent-list">
              {form.agents.map((agent, index) => (
                <div className="simulate-agent-row" key={index}>
                  <label>
                    Agent name
                    <input
                      value={agent.name}
                      onChange={e => updateAgent(index, 'name', e.currentTarget.value)}
                      required
                    />
                  </label>
                  <label>
                    Strategy
                    <select
                      value={agent.strategy}
                      onChange={e =>
                        updateAgent(index, 'strategy', e.currentTarget.value as SimulationStrategy)
                      }
                    >
                      {SIMULATION_STRATEGIES.map(strategy => (
                        <option key={strategy} value={strategy}>
                          {STRATEGY_LABELS[strategy]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Buy-in chips
                    <input
                      type="number"
                      min={1}
                      value={agent.buyIn}
                      onChange={e => updateAgent(index, 'buyIn', Number(e.currentTarget.value))}
                    />
                  </label>
                  <button
                    className="button-secondary"
                    type="button"
                    onClick={() => removeAgent(index)}
                    disabled={form.agents.length <= 2}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>

          {submission.error && (
            <div className="error alert-error" role="alert">{submission.error}</div>
          )}

          <div className="simulate-submit-row">
            <button className="button-primary" type="submit" disabled={submission.submitting}>
              {submission.submitting ? 'Running simulation...' : 'Run simulation'}
            </button>
          </div>
        </form>

        {submission.matchId ? <SimulationSuccessActions matchId={submission.matchId} /> : null}
      </div>
    </div>
  );
}

function isSimulationStrategy(value: string): value is SimulationStrategy {
  return SIMULATION_STRATEGIES.includes(value as SimulationStrategy);
}
