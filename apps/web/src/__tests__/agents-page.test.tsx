import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { describe, expect, it } from 'vitest';
import {
  AgentsPageContent,
  buildCodingAgentInvitePrompt,
  buildHttpAgentInvitePrompt,
  type AgentInvitePublic,
  type UserAgentConfigPublic,
} from '../pages/AgentsPage.js';
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

const invites: AgentInvitePublic[] = [
  {
    token: 'invite-ready',
    displayName: 'Solver seat',
    notes: 'external evaluator',
    expiresAt: 1_777_280_900_000,
    usedAt: null,
    createdAt: 1_777_280_000_000,
    registeredAgentConfigId: null,
    status: 'pending',
  },
  {
    token: 'invite-used',
    displayName: 'Caller',
    notes: null,
    expiresAt: 1_777_280_900_000,
    usedAt: 1_777_280_100_000,
    createdAt: 1_777_280_000_000,
    registeredAgentConfigId: 'agent-local',
    status: 'used',
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
        invites={[]}
        inviteLoading={false}
        inviteError={null}
        inviteBusy={false}
        generatedInvite={null}
        onRequestDelete={() => undefined}
        onCancelDelete={() => undefined}
        onConfirmDelete={() => undefined}
        onCreateInvite={() => undefined}
        onRevokeInvite={() => undefined}
        onCopyInvitePrompt={() => undefined}
        gameType="poker"
        onGameTypeChange={() => undefined}
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

  it('separates saved agents from pending Agent Lab invites', () => {
    const html = renderAgentsContent({ invites });

    expect(html).toContain('My Agents');
    expect(html).toContain('2 saved');
    expect(html).toContain('Pending Invites');
    expect(html).toContain('Solver seat');
    expect(html).toContain('external evaluator');
    expect(html).toContain('invite-ready');
    expect(html).toContain('Revoke');
    expect(html).not.toContain('tableId');
  });

  it('renders the generated invite prompt copy actions in Agent Lab', () => {
    const html = renderAgentsContent({
      generatedInvite: {
        token: 'invite-new',
        expiresAt: 1_777_280_900_000,
        registerUrl: 'http://localhost:3000/api/v1/agents/invites/invite-new/register',
      },
    });

    expect(html).toContain('Invite External Agent');
    expect(html).toContain('Copy for Coding Agent');
    expect(html).toContain('Copy for HTTP Agent');
    expect(html).toContain('http://localhost:3000/api/v1/agents/invites/invite-new/register');
    expect(html).toContain('create a small local HTTP server');
    expect(html).toContain('curl -X POST');
    expect(html).toContain('Invite token: invite-new');
  });

  it('builds distinct prompts for coding agents and ordinary HTTP agents', () => {
    const registerUrl = 'http://localhost:3000/api/v1/agents/invites/invite-new/register';

    const codingPrompt = buildCodingAgentInvitePrompt({ token: 'invite-new', registerUrl }, 'poker');
    expect(codingPrompt).toContain('create a small local HTTP server');
    expect(codingPrompt).toContain(registerUrl);
    expect(codingPrompt).toContain('"displayName"');
    expect(codingPrompt).toContain('"endpointUrl"');

    const httpPrompt = buildHttpAgentInvitePrompt({ token: 'invite-new', registerUrl }, 'poker');
    expect(httpPrompt).toContain('Your HTTP decision endpoint');
    expect(httpPrompt).toContain('curl -X POST');
    expect(httpPrompt).toContain(registerUrl);
    expect(httpPrompt).not.toContain('create a small local HTTP server');
  });

  // Regression for the silent-werewolf-fallback bug where a user pasted the poker
  // scaffold into a coding agent and seated the resulting endpoint into a
  // werewolf seat, producing empty speeches every day. The two prompts MUST
  // differ on the load-bearing wire fields (validActions vs legalActions, type
  // vs actionType) so a coding agent following the prompt produces an endpoint
  // that the werewolf orchestrator can actually parse.
  it('produces werewolf-specific invite prompts pinned to the werewolf wire shape', () => {
    const registerUrl = 'http://localhost:3000/api/v1/agents/invites/invite-new/register';
    const invite = { token: 'invite-new', registerUrl };

    const wolfCoding = buildCodingAgentInvitePrompt(invite, 'werewolf');
    expect(wolfCoding).toMatch(/WEREWOLF/i);
    expect(wolfCoding).toContain('validActions');
    expect(wolfCoding).toContain('a.type');
    expect(wolfCoding).toContain('"speak"');
    expect(wolfCoding).toContain('docs/werewolf-http-agent-guide.md');
    expect(wolfCoding).not.toContain('"actionType": "fold"');

    const wolfHttp = buildHttpAgentInvitePrompt(invite, 'werewolf');
    expect(wolfHttp).toMatch(/WEREWOLF/i);
    expect(wolfHttp).toContain('validActions');
    expect(wolfHttp).toContain('docs/werewolf-http-agent-guide.md');
    expect(wolfHttp).not.toContain('actionType "fold"');
  });

  it('renders a game-type picker so the invite copy can flip to werewolf', () => {
    const generatedInvite = {
      token: 'invite-new',
      expiresAt: 1_777_280_900_000,
      registerUrl: 'http://localhost:3000/api/v1/agents/invites/invite-new/register',
    };
    const pokerHtml = renderAgentsContent({ generatedInvite, gameType: 'poker' });
    expect(pokerHtml).toContain('role="radiogroup"');
    expect(pokerHtml).toContain('aria-label="Game protocol"');
    expect(pokerHtml).toContain('Poker');
    expect(pokerHtml).toContain('Werewolf');
    // 'Use actionType' only appears in the poker HTTP-agent prompt — werewolf
    // prompts intentionally reverse this naming. JSON quotes get HTML-escaped
    // inside <pre>, so unescaped ASCII tokens are the safe assertion vehicle.
    expect(pokerHtml).toContain('Use actionType');
    expect(pokerHtml).not.toContain('docs/werewolf-http-agent-guide.md');

    const wolfHtml = renderAgentsContent({ generatedInvite, gameType: 'werewolf' });
    expect(wolfHtml).toContain('validActions');
    expect(wolfHtml).toContain('docs/werewolf-http-agent-guide.md');
    expect(wolfHtml).not.toContain('Use actionType');
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

  it('turns the empty state into the primary new-agent path', () => {
    const html = renderAgentsContent({ agents: [], loading: false });

    expect(html).toContain('No agents yet.');
    expect(html).toContain('Endpoint URL');
    expect(html).toContain('Timeout');
    expect(html).toContain('Auth header');
    expect(html).toContain('href="/agents/new"');
    expect(html).toContain('class="button-primary"');
    expect(html).toContain('New agent');
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
    expect(html).toContain('Echo the requestId and agentId from the request in the response');
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
