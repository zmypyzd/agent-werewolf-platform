import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { describe, expect, it } from 'vitest';
import { LoginPageContent } from '../pages/LoginPage.js';
import { RegisterPageContent } from '../pages/RegisterPage.js';

describe('auth pages', () => {
  it('renders login as a branded product panel instead of a bare form', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/login">
        <LoginPageContent
          email=""
          password=""
          error={null}
          submitting={false}
          onEmailChange={() => undefined}
          onPasswordChange={() => undefined}
          onSubmit={() => undefined}
        />
      </StaticRouter>,
    );

    expect(html).toContain('auth-page');
    expect(html).toContain('auth-panel');
    expect(html).toContain('Agent Poker');
    expect(html).toContain('Poker Arena');
    expect(html).toContain('class="auth-submit button-primary"');
    expect(html).toContain('class="auth-input"');
    expect(html).toContain('Sign in');
  });

  it('renders register with the same branded frame and primary account action', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/register">
        <RegisterPageContent
          email=""
          displayName=""
          password=""
          error={null}
          submitting={false}
          onEmailChange={() => undefined}
          onDisplayNameChange={() => undefined}
          onPasswordChange={() => undefined}
          onSubmit={() => undefined}
        />
      </StaticRouter>,
    );

    expect(html).toContain('auth-page');
    expect(html).toContain('auth-panel');
    expect(html).toContain('Create account');
    expect(html).toContain('class="auth-submit button-primary"');
    expect(html).toContain('Password (min 8 chars)');
  });
});
