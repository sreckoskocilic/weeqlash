// Pure Qlashique game logic — no I/O, no socket. All functions take state as first arg.

export const PHASE = {
  CLASS_SELECT: 'class_select',
  DECISION: 'decision',
  GUESSING: 'guessing',
  OUTCOME: 'outcome',
  GAME_OVER: 'game_over',
};

export const CLASSES = {
  SLOWPOKE: 'slowpoke',
  REROLL: 'reroll',
};

// ---------------------------------------------------------------------------
// Public: create initial game state
// ---------------------------------------------------------------------------

export function createQlasGame(p0classId, p1classId, hp = 30) {
  return {
    players: [
      { hp, classId: p0classId, rerollUsed: false },
      { hp, classId: p1classId, rerollUsed: false },
    ],
    currentPlayerIdx: 0,
    turnNumber: 1,
    currentScore: 0,
    correctStreak: 0,
    phase: PHASE.DECISION,
  };
}

// ---------------------------------------------------------------------------
// Public: calculate timer for a given turn + class
// ---------------------------------------------------------------------------

export function calcTimer(turnNumber, classId) {
  const base = Math.min(5 + (turnNumber - 1) * 3, 25);
  return classId === CLASSES.SLOWPOKE ? base + 2 : base;
}

// ---------------------------------------------------------------------------
// Public: process a single answer during guessing phase
// correctIdx is the correct answer index for the current question
// ---------------------------------------------------------------------------

export function processAnswer(state, answerIdx, correctIdx) {
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
// Public: use reroll ability (Reroll class only, once per turn)
// ---------------------------------------------------------------------------

export function processReroll(state) {
  if (state.phase !== PHASE.GUESSING) {
    return { error: 'Not in guessing phase' };
  }
  const player = state.players[state.currentPlayerIdx];
  if (player.classId !== CLASSES.REROLL) {
    return { error: 'Class cannot reroll' };
  }
  if (player.rerollUsed) {
    return { error: 'Reroll already used this turn' };
  }
  player.rerollUsed = true;
  return { state };
}

// ---------------------------------------------------------------------------
// Public: end the current turn, compute outcome
// Returns { state, outcome } where outcome is one of:
//   'self_damage' | 'nothing' | 'attack' | 'choose'
// HP is immediately updated for self_damage, attack, nothing.
// For 'choose', caller must follow up with applyOutcome().
// ---------------------------------------------------------------------------

export function endTurn(state) {
  if (state.phase !== PHASE.GUESSING) {
    return { error: 'Not in guessing phase' };
  }

  const score = state.currentScore;
  let outcome;

  if (score < 0) {
    outcome = 'self_damage';
    state.players[state.currentPlayerIdx].hp += score; // score is negative
    state.phase = PHASE.DECISION;
    _advanceTurn(state);
  } else if (score === 0) {
    outcome = 'nothing';
    state.phase = PHASE.DECISION;
    _advanceTurn(state);
  } else if (score === 1) {
    outcome = 'attack';
    const opponentIdx = 1 - state.currentPlayerIdx;
    state.players[opponentIdx].hp -= 1;
    state.phase = PHASE.DECISION;
    _advanceTurn(state);
  } else {
    // score >= 2: player chooses attack or heal
    outcome = 'choose';
    state.phase = PHASE.OUTCOME;
    // do NOT advance turn yet — wait for applyOutcome
  }

  return { state, outcome };
}

// ---------------------------------------------------------------------------
// Public: apply the player's attack/heal choice after a score >= 2 turn
// choice: 'attack' | 'heal'
// ---------------------------------------------------------------------------

export function applyOutcome(state, choice) {
  if (state.phase !== PHASE.OUTCOME) {
    return { error: 'Not in outcome phase' };
  }

  const score = state.currentScore;
  const playerIdx = state.currentPlayerIdx;
  const opponentIdx = 1 - playerIdx;

  if (choice === 'attack') {
    state.players[opponentIdx].hp -= score;
  } else {
    state.players[playerIdx].hp += 2;
  }

  state.phase = PHASE.DECISION;
  _advanceTurn(state);

  return {
    state,
    p0hp: state.players[0].hp,
    p1hp: state.players[1].hp,
  };
}

// ---------------------------------------------------------------------------
// Public: check instant win condition
// Must be called at end of guessing phase, before endTurn() mutates state.
// ---------------------------------------------------------------------------

export function checkInstantWin(state) {
  return state.currentScore >= 10 && state.correctStreak === state.currentScore;
}

// ---------------------------------------------------------------------------
// Public: check if the game is over (any player at or below 0 HP)
// Returns winnerIdx (0 or 1) or -1 if game continues
// ---------------------------------------------------------------------------

export function checkGameOver(state) {
  const [p0, p1] = state.players;
  if (p0.hp <= 0 && p1.hp <= 0) {
    // Both dead simultaneously: current player loses (self-damage scenario)
    return 1 - state.currentPlayerIdx;
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

function _advanceTurn(state) {
  state.currentPlayerIdx = 1 - state.currentPlayerIdx;
  state.turnNumber += 1;
  state.currentScore = 0;
  state.correctStreak = 0;
  state.players[state.currentPlayerIdx].rerollUsed = false;
}
