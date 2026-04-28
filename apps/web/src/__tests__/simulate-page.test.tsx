import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { describe, expect, it } from 'vitest';
import {
  SimulatePage,
  SimulationSuccessActions,
  buildSimulateRequest,
  reduceSimulateSubmissionState,
  type SimulateFormState,
  type SimulateSubmissionState,
} from '../pages/SimulatePage.js';

const validInput: SimulateFormState = {
  name: '  Research Match  ',
  maxSeats: 6,
  smallBlind: 25,
  bigBlind: 50,
  ante: 5,
  seed: '  repeatable-seed  ',
  defaultTimeoutMs: 7500,
  numHands: 12,
  agents: [
    { name: '  Baseline Bot  ', strategy: 'random', buyIn: 2000 },
    { name: 'Caller Bot', strategy: 'always-call', buyIn: 2000 },
    { name: 'Aggro Bot', strategy: 'aggressive', buyIn: 2500 },
  ],
};

function renderSimulatePage(): string {
  return renderToStaticMarkup(
    <StaticRouter location="/simulate">
      <SimulatePage />
    </StaticRouter>,
  );
}

describe('buildSimulateRequest', () => {
  it('builds the exact simulation request body for valid input', () => {
    expect(buildSimulateRequest(validInput)).toEqual({
      ok: true,
      request: {
        name: 'Research Match',
        maxSeats: 6,
        blindConfig: { smallBlind: 25, bigBlind: 50, ante: 5 },
        seed: 'repeatable-seed',
        defaultTimeoutMs: 7500,
        numHands: 12,
        agents: [
          { name: 'Baseline Bot', strategy: 'random', buyIn: 2000 },
          { name: 'Caller Bot', strategy: 'always-call', buyIn: 2000 },
          { name: 'Aggro Bot', strategy: 'aggressive', buyIn: 2500 },
        ],
      },
    });
  });

  it('rejects requests above the 20-hand cap', () => {
    expect(buildSimulateRequest({ ...validInput, numHands: 21 })).toEqual({
      ok: false,
      error: 'Number of hands cannot exceed 20.',
    });
  });

  it('requires at least two agents', () => {
    expect(buildSimulateRequest({ ...validInput, agents: [validInput.agents[0]!] })).toEqual({
      ok: false,
      error: 'Add at least two agents.',
    });
  });

  it('rejects invalid blind values', () => {
    expect(buildSimulateRequest({ ...validInput, smallBlind: 50, bigBlind: 25 })).toEqual({
      ok: false,
      error: 'Big blind must be greater than or equal to small blind.',
    });

    expect(buildSimulateRequest({ ...validInput, ante: -1 })).toEqual({
      ok: false,
      error: 'Ante cannot be negative.',
    });
  });

  it('rejects strategy values outside the backend schema', () => {
    const agents = [
      validInput.agents[0]!,
      { ...validInput.agents[1]!, strategy: 'tight-passive' as SimulateFormState['agents'][number]['strategy'] },
    ];

    expect(buildSimulateRequest({ ...validInput, agents })).toEqual({
      ok: false,
      error: 'Agent 2 strategy must be random, always-call, always-fold, or aggressive.',
    });
  });
});

describe('reduceSimulateSubmissionState', () => {
  it('clears a previous success result when a rerun starts and fails validation', () => {
    const previousSuccess: SimulateSubmissionState = {
      error: null,
      matchId: 'match-old',
      submitting: false,
    };

    const submitting = reduceSimulateSubmissionState(previousSuccess, { type: 'submit-start' });
    expect(submitting).toEqual({
      error: null,
      matchId: null,
      submitting: true,
    });

    expect(
      reduceSimulateSubmissionState(submitting, {
        type: 'validation-error',
        error: 'Number of hands cannot exceed 20.',
      }),
    ).toEqual({
      error: 'Number of hands cannot exceed 20.',
      matchId: null,
      submitting: false,
    });
  });
});

describe('SimulatePage', () => {
  it('renders controls for all simulation inputs', () => {
    const html = renderSimulatePage();

    expect(html).toContain('Simulation Studio');
    expect(html).toContain('Match name');
    expect(html).toContain('Max seats');
    expect(html).toContain('Small blind');
    expect(html).toContain('Big blind');
    expect(html).toContain('Ante');
    expect(html).toContain('Seed');
    expect(html).toContain('Timeout (ms)');
    expect(html).toContain('Number of hands');
    expect(html).toContain('Agent name');
    expect(html).toContain('Strategy');
    expect(html).toContain('Buy-in chips');
    expect(html).toContain('max="20"');
  });

  it('renders generated match replay actions with a primary open-replay link', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/simulate">
        <SimulationSuccessActions matchId="match-123" />
      </StaticRouter>,
    );

    expect(html).toContain('href="/matches/match-123"');
    expect(html).toContain('Open replay');
    expect(html).toContain('class="button-primary"');
  });
});
