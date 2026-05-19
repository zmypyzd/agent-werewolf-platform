// Heuristic: tag an agent display name with a short model family ('GPT-4',
// 'Claude', 'Llama'). The backend does not yet expose model per seat; this
// matches the demo lineup naming convention (Nova/Echo → GPT-4,
// Atlas/Sigma/Vector/Quanta → Claude, Pulse/Nimbus → Llama) so the room and
// meta strip can render the model-matchup chrome. Returns undefined when
// the name does not look like a known agent — caller hides the badge.
export function inferModelTag(displayName: string): string | undefined {
  const lower = displayName.toLowerCase();
  if (lower.includes('gpt') || lower.includes('nova') || lower.includes('echo')) return 'GPT-4';
  if (
    lower.includes('claude') ||
    lower.includes('atlas') ||
    lower.includes('sigma') ||
    lower.includes('vector') ||
    lower.includes('quanta')
  ) {
    return 'Claude';
  }
  if (lower.includes('llama') || lower.includes('pulse') || lower.includes('nimbus')) return 'Llama';
  return undefined;
}
