// Pure Qlashique game logic — no I/O, no socket. All functions take state as first arg.

export const PHASE = {
  DECISION: 'decision',
  GUESSING: 'guessing',
  OUTCOME: 'outcome',
  GAME_OVER: 'game_over',
} as const;

export type Phase = (typeof PHASE)[keyof typeof PHASE];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlayerState {
  hp: number;
}

export interface QlashiqueState {
  players: [PlayerState, PlayerState];
  currentPlayerIdx: number; // 0 or 1
  turnNumber: number;
  currentScore: number;
  correctStreak: number;
  phase: Phase;
  maxHp: number;
}

// ---------------------------------------------------------------------------
// Public: create initial game state
// ---------------------------------------------------------------------------

export const QLAS_DEFAULT_HP = 15;
export const QLAS_HP_OPTIONS = [10, 15, 20, 30] as const;

export function createQlasGame(hp: number = QLAS_DEFAULT_HP): QlashiqueState {
  return {
    players: [{ hp }, { hp }],
    currentPlayerIdx: 0,
    turnNumber: 1,
    currentScore: 0,
    correctStreak: 0,
    phase: PHASE.DECISION,
    maxHp: hp,
  };
}

// ---------------------------------------------------------------------------
// Public: calculate timer for a given turn
// ---------------------------------------------------------------------------

export function calcTimer(turnNumber: number): number {
  const round = Math.ceil(turnNumber / 2);
  return Math.min(5 + (round - 1) * 3, 25);
}

// ---------------------------------------------------------------------------
// Public: process a single answer during guessing phase
// correctIdx is the correct answer index for the current question
// ---------------------------------------------------------------------------

export function processAnswer(
  state: QlashiqueState,
  answerIdx: number,
  correctIdx: number,
): { state: QlashiqueState; correct: boolean } | { error: string } {
  if (state.phase !== PHASE.GUESSING) {
    return { error: 'Not in guessing phase' };
  }

  const correct = answerIdx === correctIdx;
  if (correct) {
    state.currentScore += 1;
    state.correctStreak += 1;
  } else {
    state.currentScore -= 1;
    state.correctStreak = 0;
  }

  return { state, correct };
}

// ---------------------------------------------------------------------------
// Public: end the current turn, compute outcome
// Returns { state, outcome } where outcome is one of:
//   'self_damage' | 'nothing' | 'attack' | 'choose'
// HP is immediately updated for self_damage, attack, nothing.
// For 'choose', caller must follow up with applyOutcome().
// ---------------------------------------------------------------------------

export function endTurn(state: QlashiqueState):
  | {
      state: QlashiqueState;
      outcome: 'self_damage' | 'nothing' | 'attack' | 'choose';
      actingPlayerIdx: number;
    }
  | { error: string } {
  if (state.phase !== PHASE.GUESSING) {
    return { error: 'Not in guessing phase' };
  }

  const actingPlayerIdx = state.currentPlayerIdx;
  const score = state.currentScore;
  let outcome: 'self_damage' | 'nothing' | 'attack' | 'choose';

  if (score < 0) {
    outcome = 'self_damage';
    state.players[actingPlayerIdx].hp += score; // score is negative
    state.phase = PHASE.DECISION;
    _advanceTurn(state);
  } else if (score === 0) {
    outcome = 'nothing';
    state.phase = PHASE.DECISION;
    _advanceTurn(state);
  } else if (score === 1) {
    outcome = 'attack';
    const opponentIdx = 1 - actingPlayerIdx;
    state.players[opponentIdx].hp -= 1;
    state.phase = PHASE.DECISION;
    _advanceTurn(state);
  } else {
    // score >= 2: player chooses attack or heal
    outcome = 'choose';
    state.phase = PHASE.OUTCOME;
    // do NOT advance turn yet — wait for applyOutcome
  }

  return { state, outcome, actingPlayerIdx };
}

// ---------------------------------------------------------------------------
// Public: apply the player's attack/heal choice after a score >= 2 turn
// choice: 'attack' | 'heal'
// ---------------------------------------------------------------------------

export function applyOutcome(
  state: QlashiqueState,
  choice: 'attack' | 'heal',
):
  | { state: QlashiqueState; p0hp: number; p1hp: number; actingPlayerIdx: number }
  | { error: string } {
  if (state.phase !== PHASE.OUTCOME) {
    return { error: 'Not in outcome phase' };
  }

  const score = state.currentScore;
  const actingPlayerIdx = state.currentPlayerIdx;
  const opponentIdx = 1 - actingPlayerIdx;

  if (choice === 'attack') {
    state.players[opponentIdx].hp -= score;
  } else {
    state.players[actingPlayerIdx].hp = Math.min(
      state.players[actingPlayerIdx].hp + 2,
      state.maxHp,
    );
  }

  state.phase = PHASE.DECISION;
  _advanceTurn(state);

  return {
    state,
    p0hp: state.players[0].hp,
    p1hp: state.players[1].hp,
    actingPlayerIdx,
  };
}

// ---------------------------------------------------------------------------
// Public: check if the game is over (any player at or below 0 HP)
// Returns winnerIdx (0 or 1) or -1 if game continues
// ---------------------------------------------------------------------------

export function checkGameOver(state: QlashiqueState, actingPlayerIdx: number): number {
  const [p0, p1] = state.players;
  if (p0.hp <= 0 && p1.hp <= 0) {
    return 1 - actingPlayerIdx;
  }
  if (p0.hp <= 0) {
    return 1;
  }
  if (p1.hp <= 0) {
    return 0;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Internal: advance to next player's turn and reset per-turn state
// ---------------------------------------------------------------------------

function _advanceTurn(state: QlashiqueState): void {
  state.currentPlayerIdx = 1 - state.currentPlayerIdx;
  state.turnNumber += 1;
  state.currentScore = 0;
  state.correctStreak = 0;
}
