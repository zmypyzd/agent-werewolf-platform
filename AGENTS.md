# Repository Guidelines

## Project Structure & Module Organization

This is a pnpm TypeScript monorepo for an agent poker platform. Core libraries live in `packages/*/src`: shared types, protocol schemas, poker engine, agent runtime, auth, persistence, realtime, and table orchestration. Applications live in `apps/api/src` for the Fastify API and `apps/web/src` for the React/Vite client. Tests are colocated in `src/__tests__`; web end-to-end tests live in `apps/web/e2e`. Documentation is in `docs/`, and demos are in `examples/`. Prefer editing source files over generated `dist/` output.

## Build, Test, and Development Commands

- `pnpm install`: install workspace dependencies. Requires Node 20 and pnpm.
- `pnpm build`: compile all packages and apps.
- `pnpm test`: run the full Vitest workspace.
- `pnpm test:watch`: run Vitest in watch mode.
- `pnpm test:coverage`: run tests with V8 coverage.
- `pnpm lint`: run TypeScript project checks with `tsc -b --noEmit`.
- `pnpm dev:api`: start the API at `http://localhost:3000/api/v1`.
- `pnpm --filter web dev`: start the Vite web app.
- `pnpm demo`: run the local multi-agent simulation.

Use filters for focused work, for example `pnpm --filter @agent-poker/poker-engine run test` or `pnpm --filter api run test`.

## Coding Style & Naming Conventions

Use TypeScript with ES modules and strict settings from `tsconfig.base.json`. Keep two-space indentation, single quotes, and explicit exported interfaces/types where they clarify package boundaries. Use `PascalCase` for React components and classes, `camelCase` for functions and variables, and lowercase hyphenated directories. Workspace packages use the `@agent-poker/*` naming pattern where applicable.

## Testing Guidelines

Vitest is the primary test runner. Name tests `*.test.ts` or `*.test.tsx` and place them in the nearest `src/__tests__` directory unless a package has a more specific convention. Add focused tests for poker rules, orchestration flows, auth/session behavior, API routes, and persistence changes. Run `pnpm test` before broad changes; run package filters during iteration.

## Commit & Pull Request Guidelines

This workspace does not include local Git history, so no commit convention can be inferred. Use short, imperative commit messages such as `Add table seat ownership tests` and keep unrelated work separate. Pull requests should include a concise summary, affected packages or apps, test commands run, linked issues, and screenshots or short recordings for UI changes.

## Security & Configuration Tips

This project is for entertainment and technical research only. Do not add real-money gambling, deposits, withdrawals, betting odds, or financial transaction features. Keep secrets out of source and prefer local environment configuration for credentials or database paths.
