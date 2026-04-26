// Pure SkipNoT game logic — no I/O, no socket, no DB.
// Solo quiz: 20 questions, 12s each. Click an option, skip, or timeout.
// Scoring: +13 correct / -7 wrong / 0 skip / 0 timeout (linear shift +3 from
// strict +10/-10/-3, so a perfect run is +260 and an all-wrong run is -140).

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

export interface SkipNotState {
  questionIds: string[];
  currentIdx: number;
  score: number;
  results: Outcome[];
  finished: boolean;
}

export function createSession(questionIds: string[]): SkipNotState {
  if (questionIds.length !== QUESTION_COUNT) {
    throw new Error(`SkipNoT requires ${QUESTION_COUNT} questions, got ${questionIds.length}`);
  }
  return {
    questionIds: questionIds.slice(),
    currentIdx: 0,
    score: 0,
    results: [],
    finished: false,
  };
}

function _advance(state: SkipNotState, outcome: Outcome, delta: number): void {
  state.score += delta;
  state.results.push(outcome);
  state.currentIdx += 1;
  if (state.currentIdx >= QUESTION_COUNT) {
    state.finished = true;
  }
}

export function processAnswer(
  state: SkipNotState,
  optionIdx: number,
  correctIdx: number,
): { state: SkipNotState; correct: boolean; finished: boolean } | { error: string } {
  if (state.finished) {
    return { error: 'Session finished' };
  }
  const correct = optionIdx === correctIdx;
  _advance(state, correct ? 'correct' : 'wrong', correct ? POINTS.CORRECT : POINTS.WRONG);
  return { state, correct, finished: state.finished };
}

export function processSkip(
  state: SkipNotState,
): { state: SkipNotState; finished: boolean } | { error: string } {
  if (state.finished) {
    return { error: 'Session finished' };
  }
  _advance(state, 'skip', POINTS.SKIP);
  return { state, finished: state.finished };
}

export function processTimeout(
  state: SkipNotState,
): { state: SkipNotState; finished: boolean } | { error: string } {
  if (state.finished) {
    return { error: 'Session finished' };
  }
  _advance(state, 'timeout', POINTS.TIMEOUT);
  return { state, finished: state.finished };
}

// Server-side re-scoring of a finished client run. Takes the questions that
// were issued at start (full objects with correct-index `a`) and the picks the
// client reported (optionIdx | null per question; null = skip or timeout —
// indistinguishable here, both score 0 so it doesn't matter for the total).
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
