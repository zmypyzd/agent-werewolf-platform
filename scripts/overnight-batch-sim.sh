#!/usr/bin/env bash
# Run pnpm demo:werewolf N times with varying seeds. Outputs go to
# examples/werewolf-local-simulation/output/matches/audit-<n>/. Use the
# scanner script after to check invariants. Stops on first failure.

set -e

N="${1:-30}"
PREFIX="${2:-audit}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"

ok=0
failed=0
for i in $(seq 1 "$N"); do
  game="${PREFIX}-$(printf '%03d' "$i")"
  seed="seed-$(printf '%03d' "$i")-$(date +%s%N)"
  if pnpm demo:werewolf -- "$game" "$seed" > "/tmp/werewolf-sim-${game}.log" 2>&1; then
    ok=$((ok+1))
    printf '.'
  else
    failed=$((failed+1))
    printf 'F'
    echo
    echo "FAILED game=${game} seed=${seed}"
    tail -40 "/tmp/werewolf-sim-${game}.log"
  fi
done

echo
echo "ok=${ok} failed=${failed} total=${N}"
