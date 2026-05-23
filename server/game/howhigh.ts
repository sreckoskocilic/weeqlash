// Pure HowHigh? game logic — no I/O, no socket, no DB.
// Async 2-player challenge: 10 questions (13s), dice bonus after Q3,
// GoWild card after Q6 (extends to 12 questions at 10s).

export const POINTS = { CORRECT: 2, WRONG: -2 } as const;
export const DON_MULTIPLIER = 2;
export const TIME_CRUNCH_POINTS = { CORRECT: 3, WRONG: -3 } as const;
export const TIME_CRUNCH_TIMER_MS = 7000;
export const TIME_CRUNCH_Q_COUNT = 2;
export const BASE_TIMER_MS = 13000;
export const GOWILD_TIMER_MS = 10000;
export const BASE_Q_COUNT = 10;
export const GOWILD_Q_COUNT = 12;
export const DICE_AFTER_Q = 3;
export const GOWILD_AFTER_Q = 6;
export const DON_AFTER_Q = 3;
export const DON_Q_COUNT = 2;
export const OPTIONS_PER_Q = 4;

export type BonusQ3 = 'dice' | 'double_or_nothing';
export type BonusQ6 = 'gowild' | 'time_crunch';

export type Outcome = 'correct' | 'wrong' | 'timeout';

export function pickBonusQ3(): BonusQ3 {
  return Math.random() < 0.5 ? 'dice' : 'double_or_nothing';
}

export function pickBonusQ6(): BonusQ6 {
  return Math.random() < 0.5 ? 'gowild' : 'time_crunch';
}

export interface ScorePicksOpts {
  dice: { die1: number; die2: number; accepted: boolean };
  bonusQ3: BonusQ3;
  bonusQ6: BonusQ6;
  donAccepted: boolean;
  timeCrunchAccepted: boolean;
}

export function scorePicks(
  questions: { a: number; id: string }[],
  picks: (number | null)[],
  opts: ScorePicksOpts,
): { score: number; results: Outcome[] } {
  let score = 0;
  const results: Outcome[] = [];
  const { dice, bonusQ3, bonusQ6, donAccepted, timeCrunchAccepted } = opts;
  const diceSum = dice.die1 + dice.die2;

  for (let i = 0; i < questions.length; i++) {
    const pick = picks[i];
    const isDiceQ = i === DICE_AFTER_Q && bonusQ3 === 'dice' && dice.accepted;
    const isDonQ =
      bonusQ3 === 'double_or_nothing' &&
      donAccepted &&
      i >= DON_AFTER_Q &&
      i < DON_AFTER_Q + DON_Q_COUNT;
    const isTimeCrunchQ =
      bonusQ6 === 'time_crunch' &&
      timeCrunchAccepted &&
      i >= GOWILD_AFTER_Q &&
      i < GOWILD_AFTER_Q + TIME_CRUNCH_Q_COUNT;

    let pts: number;
    if (pick === null || pick === undefined) {
      results.push('timeout');
      if (isDiceQ) {
        pts = POINTS.WRONG - Math.ceil(diceSum / 2);
      } else if (isDonQ) {
        pts = POINTS.WRONG * DON_MULTIPLIER;
      } else if (isTimeCrunchQ) {
        pts = TIME_CRUNCH_POINTS.WRONG;
      } else {
        pts = POINTS.WRONG;
      }
    } else if (pick === questions[i].a) {
      results.push('correct');
      if (isDiceQ) {
        pts = POINTS.CORRECT + diceSum;
      } else if (isDonQ) {
        pts = POINTS.CORRECT * DON_MULTIPLIER;
      } else if (isTimeCrunchQ) {
        pts = TIME_CRUNCH_POINTS.CORRECT;
      } else {
        pts = POINTS.CORRECT;
      }
    } else {
      results.push('wrong');
      if (isDiceQ) {
        pts = POINTS.WRONG - Math.ceil(diceSum / 2);
      } else if (isDonQ) {
        pts = POINTS.WRONG * DON_MULTIPLIER;
      } else if (isTimeCrunchQ) {
        pts = TIME_CRUNCH_POINTS.WRONG;
      } else {
        pts = POINTS.WRONG;
      }
    }
    score += pts;
  }
  return { score, results };
}
