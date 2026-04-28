import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { describe, expect, it } from 'vitest';
import { AgentsPageContent, type UserAgentConfigPublic } from '../pages/AgentsPage.js';
import { AgentEditForm, AgentEndpointContract } from '../pages/AgentEditPage.js';

const agents: UserAgentConfigPublic[] = [
  {
    agentConfigId: 'agent-range',
    agentName: 'Range Scout',
    endpointUrl: 'https://range.example.test/decide',
    authHeaderName: 'Authorization',
    hasAuthHeader: true,
    timeoutMs: 5000,
    description: 'Tracks table texture and position.',
    createdAt: 1_777_280_000_000,
    updatedAt: 1_777_280_100_000,
  },
  {
    agentConfigId: 'agent-local',
    agentName: 'Local Caller',
    endpointUrl: 'http://localhost:8787/agent',
    authHeaderName: null,
    hasAuthHeader: false,
    timeoutMs: 1200,
    description: null,
    createdAt: 1_777_280_200_000,
    updatedAt: 1_777_280_300_000,
  },
];

function renderAgentsContent(props: Partial<Parameters<typeof AgentsPageContent>[0]> = {}): string {
  return renderToStaticMarkup(
    <StaticRouter location="/agents">
      <AgentsPageContent
        agents={agents}
        loading={false}
        error={null}
        busyId={null}
        deleteInFlight={false}
        deleteAgent={null}
        onRequestDelete={() => undefined}
        onCancelDelete={() => undefined}
        onConfirmDelete={() => undefined}
        {...props}
      />
    </StaticRouter>,
  );
}

describe('AgentsPageContent', () => {
  it('renders agent rows with name, endpoint, timeout, auth status, and description', () => {
    const html = renderAgentsContent();

    expect(html).toContain('Range Scout');
    expect(html).toContain('https://range.example.test/decide');
    expect(html).toContain('5000 ms');
    expect(html).toContain('Auth configured');
    expect(html).toContain('Authorization');
    expect(html).toContain('Tracks table texture and position.');

    expect(html).toContain('Local Caller');
    expect(html).toContain('http://localhost:8787/agent');
    expect(html).toContain('1200 ms');
    expect(html).toContain('No auth header');
    expect(html).toContain('No description');
  });

  it('renders delete confirmation with dialog markup instead of a native confirm surface', () => {
    const html = renderAgentsContent({ deleteAgent: agents[0]! });

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Delete Range Scout?');
    expect(html).toContain('Delete agent');
    expect(html).toContain('Cancel');
    expect(html).not.toContain('Delete this agent config?');
  });

  it('locks all delete actions while one delete is in flight', () => {
    const html = renderAgentsContent({ busyId: agents[0]!.agentConfigId, deleteInFlight: true });

    expect(html.match(/disabled=""/g)?.length).toBe(2);
    expect(html).toContain('Deleting');
  });
});

describe('AgentEditForm', () => {
  it('renders endpoint contract guidance on the edit page', () => {
    const html = renderToStaticMarkup(<AgentEndpointContract />);

    expect(html).toContain('Endpoint contract');
    expect(html).toContain('decision request');
    expect(html).toContain('table, hand, and action context');
    expect(html).toContain('legal actions from the request');
    expect(html).toContain('fold, check, call, bet, raise, or all-in');
    expect(html).toContain('Include an amount when the chosen legal action supplies minAmount or maxAmount bounds');
    expect(html).toContain('respond before the configured timeout');
    expect(html).toContain('configured auth header is sent on each request');
    expect(html).toContain('write-only');
  });

  it('keeps auth header value as a write-only password input', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/agents/agent-range/edit">
        <AgentEditForm
          mode="edit"
          agentName="Range Scout"
          endpointUrl="https://range.example.test/decide"
          authHeaderName="Authorization"
          authHeaderValue=""
          clearAuthHeader={false}
          timeoutMs={5000}
          description="Tracks table texture and position."
          hasAuthHeader={true}
          error={null}
          submitting={false}
          onAgentNameChange={() => undefined}
          onEndpointUrlChange={() => undefined}
          onAuthHeaderNameChange={() => undefined}
          onAuthHeaderValueChange={() => undefined}
          onClearAuthHeaderChange={() => undefined}
          onTimeoutMsChange={() => undefined}
          onDescriptionChange={() => undefined}
          onSubmit={() => undefined}
        />
      </StaticRouter>,
    );

    expect(html).toContain('Auth header value');
    expect(html).toContain('type="password"');
    expect(html).toContain('Leave blank to keep current');
    expect(html).toContain('value=""');
    expect(html).toContain('Write-only');
    expect(html).not.toContain('Bearer stored-secret');
  });
});
