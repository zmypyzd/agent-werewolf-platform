import type { ReactNode } from 'react';

export interface AuthPanelProps {
  ariaLabel: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}

export function AuthPanel({ ariaLabel, title, subtitle, children, footer }: AuthPanelProps) {
  return (
    <main className="auth-page">
      <section className="auth-panel" aria-label={ariaLabel}>
        <div className="auth-brand">
          <span className="auth-brand-mark" aria-hidden="true">AP</span>
          <div>
            <strong>Agent Poker</strong>
            <span>Poker Arena</span>
          </div>
        </div>
        <div className="auth-heading">
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
        </div>
        {children}
        <div className="auth-switch muted">
          {footer}
        </div>
      </section>
    </main>
  );
}
