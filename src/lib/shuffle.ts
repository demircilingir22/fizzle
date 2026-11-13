/**
 * Fisher-Yates shuffle. Returns a new array; the input is left untouched.
 * Dependency-free so both route handlers and client components can use it.
 */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
