// Pure HowHigh? game logic — no I/O, no socket, no DB.
// Async 2-player challenge: 10 questions (7s), dice bonus after Q3,
// GoWild card after Q6 (extends to 12 questions at 5s).

export const POINTS = { CORRECT: 2, WRONG: -2 } as const;
export const BASE_TIMER_MS = 7000;
export const GOWILD_TIMER_MS = 5000;
export const BASE_Q_COUNT = 10;
export const GOWILD_Q_COUNT = 12;
export const DICE_AFTER_Q = 3;
export const GOWILD_AFTER_Q = 6;
export const OPTIONS_PER_Q = 4;

export type Outcome = 'correct' | 'wrong' | 'timeout';
export type Phase = 'answering' | 'dice_offer' | 'gowild_offer' | 'finished';

export interface DiceState {
  die1: number;
  die2: number;
  accepted: boolean | null;
}

export interface HowHighState {
  questionIds: string[];
  currentIdx: number;
  score: number;
  results: Outcome[];
  phase: Phase;
  dice: DiceState;
  goWildAccepted: boolean | null;
  totalQuestions: number;
  timerMs: number;
  finished: boolean;
}

export function createSession(
  questionIds: string[],
  dice: { die1: number; die2: number },
): HowHighState {
  if (questionIds.length !== BASE_Q_COUNT) {
    throw new Error(`HowHigh requires ${BASE_Q_COUNT} base questions, got ${questionIds.length}`);
  }
  if (dice.die1 < 1 || dice.die1 > 6 || dice.die2 < 1 || dice.die2 > 6) {
    throw new Error('Dice values must be 1-6');
  }
  return {
    questionIds: questionIds.slice(),
    currentIdx: 0,
    score: 0,
    results: [],
    phase: 'answering',
    dice: { die1: dice.die1, die2: dice.die2, accepted: null },
    goWildAccepted: null,
    totalQuestions: BASE_Q_COUNT,
    timerMs: BASE_TIMER_MS,
    finished: false,
  };
}

function _diceSum(d: DiceState): number {
  return d.die1 + d.die2;
}

function _scoreDelta(state: HowHighState, correct: boolean): number {
  const base = correct ? POINTS.CORRECT : POINTS.WRONG;
  if (state.currentIdx === DICE_AFTER_Q && state.dice.accepted) {
    const sum = _diceSum(state.dice);
    return correct ? base + sum : base - Math.ceil(sum / 2);
  }
  return base;
}

function _nextPhase(state: HowHighState): Phase | undefined {
  if (state.currentIdx === DICE_AFTER_Q && state.phase === 'answering') {
    return 'dice_offer';
  }
  if (state.currentIdx === GOWILD_AFTER_Q && state.phase === 'answering') {
    return 'gowild_offer';
  }
  return undefined;
}

function _advance(
  state: HowHighState,
  outcome: Outcome,
  correct: boolean,
): { finished: boolean; nextPhase?: Phase } {
  state.score += _scoreDelta(state, correct);
  state.results.push(outcome);
  state.currentIdx += 1;
  if (state.currentIdx >= state.totalQuestions) {
    state.finished = true;
    state.phase = 'finished';
    return { finished: true };
  }
  const np = _nextPhase(state);
  if (np) {
    state.phase = np;
    return { finished: false, nextPhase: np };
  }
  return { finished: false };
}

export function processAnswer(
  state: HowHighState,
  optionIdx: number,
  correctIdx: number,
):
  | { state: HowHighState; correct: boolean; finished: boolean; nextPhase?: Phase }
  | { error: string } {
  if (state.finished) {return { error: 'Session finished' };}
  if (state.phase !== 'answering') {return { error: `Cannot answer in phase ${state.phase}` };}
  const correct = optionIdx === correctIdx;
  const res = _advance(state, correct ? 'correct' : 'wrong', correct);
  return { state, correct, ...res };
}

export function processTimeout(
  state: HowHighState,
): { state: HowHighState; finished: boolean; nextPhase?: Phase } | { error: string } {
  if (state.finished) {return { error: 'Session finished' };}
  if (state.phase !== 'answering') {return { error: `Cannot timeout in phase ${state.phase}` };}
  const res = _advance(state, 'timeout', false);
  return { state, ...res };
}

export function acceptDice(state: HowHighState): { state: HowHighState } | { error: string } {
  if (state.phase !== 'dice_offer') {return { error: 'Not in dice offer phase' };}
  state.dice.accepted = true;
  state.phase = 'answering';
  return { state };
}

export function declineDice(state: HowHighState): { state: HowHighState } | { error: string } {
  if (state.phase !== 'dice_offer') {return { error: 'Not in dice offer phase' };}
  state.dice.accepted = false;
  state.phase = 'answering';
  return { state };
}

export function acceptGoWild(
  state: HowHighState,
  extraQuestionIds: string[],
): { state: HowHighState } | { error: string } {
  if (state.phase !== 'gowild_offer') {return { error: 'Not in GoWild offer phase' };}
  if (extraQuestionIds.length !== GOWILD_Q_COUNT - BASE_Q_COUNT) {
    return { error: `Need ${GOWILD_Q_COUNT - BASE_Q_COUNT} extra questions` };
  }
  state.goWildAccepted = true;
  state.totalQuestions = GOWILD_Q_COUNT;
  state.timerMs = GOWILD_TIMER_MS;
  state.questionIds.push(...extraQuestionIds);
  state.phase = 'answering';
  return { state };
}

export function declineGoWild(state: HowHighState): { state: HowHighState } | { error: string } {
  if (state.phase !== 'gowild_offer') {return { error: 'Not in GoWild offer phase' };}
  state.goWildAccepted = false;
  state.phase = 'answering';
  return { state };
}

export function scorePicks(
  questions: { a: number; id: string }[],
  picks: (number | null)[],
  dice: { die1: number; die2: number; accepted: boolean },
): { score: number; results: Outcome[] } {
  let score = 0;
  const results: Outcome[] = [];
  const diceSum = dice.die1 + dice.die2;

  for (let i = 0; i < questions.length; i++) {
    const pick = picks[i];
    if (pick === null || pick === undefined) {
      results.push('timeout');
      const base = POINTS.WRONG;
      if (i === DICE_AFTER_Q && dice.accepted) {
        score += base - Math.ceil(diceSum / 2);
      } else {
        score += base;
      }
    } else if (pick === questions[i].a) {
      results.push('correct');
      const base = POINTS.CORRECT;
      if (i === DICE_AFTER_Q && dice.accepted) {
        score += base + diceSum;
      } else {
        score += base;
      }
    } else {
      results.push('wrong');
      const base = POINTS.WRONG;
      if (i === DICE_AFTER_Q && dice.accepted) {
        score += base - Math.ceil(diceSum / 2);
      } else {
        score += base;
      }
    }
  }
  return { score, results };
}
