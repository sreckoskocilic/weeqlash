// Pure math-quiz scoring. Linear band: full credit within tol, linear decay to zero at range; exact = degenerate range===tol.

export const QUESTION_COUNT = 10;
export const TIMER_MS = 45000; // calculus problems need more time than MCQ
export const BASE_POINTS = 10;

export type Outcome = 'correct' | 'partial' | 'wrong' | 'skip';

export interface ScorableProblem {
  answer: number;
  scoring: 'exact' | 'proximity';
  tol: number;
  range: number;
  points: number;
  // Optional near-exact bonus: guess within bonusTol adds `bonus` on top of full credit.
  bonus?: number;
  bonusTol?: number;
}

// Score a single guess against one problem's band; null guess = skip/timeout → 0.
export function scorePick(
  p: ScorableProblem,
  guess: number | null,
): { earned: number; fraction: number; outcome: Outcome; bonus: boolean } {
  if (guess === null || guess === undefined || Number.isNaN(guess)) {
    return { earned: 0, fraction: 0, outcome: 'skip', bonus: false };
  }
  const d = Math.abs(guess - p.answer);
  let fraction: number;
  if (d <= p.tol) {
    fraction = 1;
  } else if (d >= p.range) {
    fraction = 0;
  } else {
    // p.range > p.tol guaranteed here (the two branches above cover equality)
    fraction = (p.range - d) / (p.range - p.tol);
  }
  let earned = Math.round(p.points * fraction);
  let bonus = false;
  if (p.bonus && p.bonusTol !== undefined && d <= p.bonusTol) {
    earned += p.bonus;
    bonus = true;
  }
  const outcome: Outcome = fraction === 1 ? 'correct' : fraction === 0 ? 'wrong' : 'partial';
  return { earned, fraction, outcome, bonus };
}

// Re-score a finished run; guesses[i] is the client's parsed value (null = skip/timeout).
export function scorePicks(
  problems: ScorableProblem[],
  guesses: (number | null)[],
): { score: number; results: Outcome[]; earned: number[] } {
  let score = 0;
  const results: Outcome[] = [];
  const earned: number[] = [];
  for (let i = 0; i < problems.length; i++) {
    const r = scorePick(problems[i], guesses[i]);
    score += r.earned;
    results.push(r.outcome);
    earned.push(r.earned);
  }
  return { score, results, earned };
}
