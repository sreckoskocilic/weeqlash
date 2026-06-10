// Pure SkipNoT logic: solo 20-Q quiz, 12s each. Scoring +13/-7/0/0 (correct/wrong/skip/timeout).

export const POINTS = {
  CORRECT: 13,
  WRONG: -7,
  SKIP: 0,
  TIMEOUT: 0,
} as const;

export const TIMER_MS = 12000;
export const QUESTION_COUNT = 20;
export const OPTIONS_PER_Q = 4;

export type Outcome = 'correct' | 'wrong' | 'skip' | 'timeout';

// Server-side re-score of a finished run; picks[i] is optionIdx or null (skip/timeout, both score 0).
export function scorePicks(
  questions: { a: number; id: string }[],
  picks: (number | null)[],
): { score: number; results: Outcome[] } {
  let score = 0;
  const results: Outcome[] = [];
  for (let i = 0; i < questions.length; i++) {
    const pick = picks[i];
    if (pick === null || pick === undefined) {
      results.push('skip');
      score += POINTS.SKIP;
    } else if (pick === questions[i].a) {
      results.push('correct');
      score += POINTS.CORRECT;
    } else {
      results.push('wrong');
      score += POINTS.WRONG;
    }
  }
  return { score, results };
}
