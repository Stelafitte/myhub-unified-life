/**
 * Smart search scoring:
 * - full prefix match gets highest score
 * - acronym / word-initial match gets high score (e.g. "fb" → "Facebook")
 * - subsequence match gets lower score
 * Returns 0 when no match.
 */
export function smartScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase().trim();
  if (!q || !t) return 0;
  if (t.startsWith(q)) return 1000 + q.length;

  // Acronym / word-initial match
  const words = t.split(/[\s\-_.@]+/).filter(Boolean);
  let qi = 0;
  let acScore = 0;
  for (let i = 0; i < words.length && qi < q.length; i++) {
    if (words[i][0] === q[qi]) {
      acScore += 40;
      qi++;
    }
  }
  if (qi === q.length) return acScore + 200;

  // Subsequence match
  let ti = 0;
  qi = 0;
  let consecutive = 0;
  let subScore = 0;
  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      subScore += 1 + consecutive;
      consecutive++;
      qi++;
    } else {
      consecutive = 0;
    }
    ti++;
  }
  if (qi < q.length) return 0;
  return subScore;
}

/** Quick exact-substring check first, then fallback to smartScore. */
export function smartMatch(query: string, text: string): boolean {
  const qt = query.toLowerCase().trim();
  if (!qt) return true;
  const t = text.toLowerCase();
  if (t.includes(qt)) return true;
  return smartScore(query, text) > 0;
}
