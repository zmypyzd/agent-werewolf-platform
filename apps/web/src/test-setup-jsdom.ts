// Setup file for jsdom-environment tests. Vitest loads this only for test
// files that opt in via `// @vitest-environment jsdom` because the matcher
// in vitest.config.ts is keyed on the resolved environment. jsdom doesn't
// implement a few browser APIs that production components routinely use;
// stub them globally here so individual test files don't have to repeat
// the boilerplate. Keep the stubs idempotent (`typeof ... === 'undefined'`)
// so a future real implementation (or another setup file) can take
// precedence.

if (typeof globalThis.ResizeObserver === 'undefined') {
  // AgentPickerPopover (apps/web/src/werewolf-room/AgentPickerPopover.tsx)
  // observes its container to reposition on resize. The reposition logic
  // is not under test here; a no-op observer is enough to let the
  // component mount.
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
}
