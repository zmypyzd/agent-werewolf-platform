import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Regression for the build failure captured 2026-05-11 on commit
// e2de74b: a new workspace package (packages/werewolf-agent-sdk) was
// added but the root Dockerfile's enumerated `COPY .../package.json
// .../` list wasn't updated. `pnpm install` in the builder stage then
// silently skipped fetching the new package's deps (because its
// package.json wasn't yet in the image), and `pnpm build` failed
// later with "Cannot find module 'ws'" — a cryptic symptom for a
// boring root cause. Render's prod redeploy went red until the
// follow-up commit (ba87029) added the two missing COPY lines.
//
// The Dockerfile's explicit enumeration is intentional (it preserves
// the install-layer cache across source-only changes), but it's also
// fragile — anyone adding a workspace package has to remember to sync
// the Dockerfile. This test makes that omission impossible to miss:
// it compares the set of on-disk workspace package.json files against
// the set the Dockerfile copies, and fails when they diverge in either
// direction.

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/api/src/__tests__ → 4 levels up to repo root
const REPO_ROOT = join(HERE, '../../../..');
const DOCKERFILE_PATH = join(REPO_ROOT, 'Dockerfile');

// pnpm-workspace.yaml maps to these directories. Hardcoded because the
// test deliberately doesn't import a YAML parser as a runtime dep just
// for this assertion — if the workspace list grows beyond apps/* +
// packages/* + examples/*, update this constant.
const WORKSPACE_DIRS = ['apps', 'packages', 'examples'];

function listWorkspacePackagesOnDisk(): Set<string> {
  const found = new Set<string>();
  for (const parent of WORKSPACE_DIRS) {
    const parentPath = join(REPO_ROOT, parent);
    if (!existsSync(parentPath)) continue;
    for (const name of readdirSync(parentPath)) {
      const dir = join(parentPath, name);
      if (!statSync(dir).isDirectory()) continue;
      // Match pnpm's behaviour: every directory under apps/* /
      // packages/* / examples/* that has a package.json counts as a
      // workspace package, regardless of name.
      if (existsSync(join(dir, 'package.json'))) {
        found.add(`${parent}/${name}`);
      }
    }
  }
  return found;
}

function listWorkspacePackagesCopiedByDockerfile(): Set<string> {
  const dockerfile = readFileSync(DOCKERFILE_PATH, 'utf8');
  const copied = new Set<string>();
  // Pattern: `COPY <relpath>/package.json <relpath>/`
  // The dest mirrors the source dir, which is the convention this
  // Dockerfile uses to keep package.json + node_modules layout
  // identical to the host workspace.
  const re = /^COPY\s+(apps|packages|examples)\/([^/\s]+)\/package\.json\s+/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(dockerfile)) !== null) {
    copied.add(`${match[1]}/${match[2]}`);
  }
  return copied;
}

describe('Dockerfile workspace package.json enumeration', () => {
  it('lists every on-disk workspace package — no silent build regressions when adding a new package', () => {
    const onDisk = listWorkspacePackagesOnDisk();
    const copied = listWorkspacePackagesCopiedByDockerfile();

    const missingFromDockerfile = [...onDisk].filter((p) => !copied.has(p)).sort();
    const stalePaths = [...copied].filter((p) => !onDisk.has(p)).sort();

    if (missingFromDockerfile.length > 0 || stalePaths.length > 0) {
      const lines: string[] = [];
      if (missingFromDockerfile.length > 0) {
        lines.push(
          `Dockerfile is missing COPY lines for these on-disk packages — add them in the builder stage so 'pnpm install --frozen-lockfile' can resolve their deps:`,
        );
        for (const pkg of missingFromDockerfile) {
          lines.push(`  COPY ${pkg}/package.json ${pkg}/`);
        }
      }
      if (stalePaths.length > 0) {
        lines.push(
          `Dockerfile references package paths that no longer exist on disk — remove these COPY lines:`,
        );
        for (const pkg of stalePaths) lines.push(`  ${pkg}/package.json`);
      }
      expect.fail(lines.join('\n'));
    }
  });
});
