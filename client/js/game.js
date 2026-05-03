// ============================================================
// GAME INTERACTION
// ============================================================

import { el, showError, showScreen, getPlayerName } from './dom.js';
import { initBoard, renderAll, renderChangedTiles } from './render.js';
import { PHASE, COORD_BASE, TIMING } from './constants.js';
import { state } from './state.js';
import { getSocket } from './socket.js';
import { showQuestion, stopTimer, gameModalOptionBtns } from './question.js';
import { renderPlayers } from './lobby.js';

export { initBoard };

// Peg click handler
export function onPegClick(pegId) {
  const gameState = state.gameState;
  if (!gameState || state.myPlayerIndex === null) {
    return;
  }
  if (gameState.currentPlayerIdx !== state.myPlayerIndex) {
    return;
  }
  const phase = state.localPhase ?? gameState.phase;
  if (phase !== PHASE.SELECT_PEG && phase !== PHASE.SELECT_TILE) {
    return;
  }
  const myPlayer = gameState.players[state.myPlayerIndex];
  if (!myPlayer?.pegIds.includes(pegId)) {
    return;
  }
  // Deselect current peg
  if (phase === PHASE.SELECT_TILE && pegId === state.localSelectedPegId) {
    state.localSelectedPegId = null;
    state.localPhase = PHASE.SELECT_PEG;
    state.validMovesSet = new Set();
    renderAll(gameState);
    return;
  }

  const socket = getSocket();
  socket.emit(
    'action:select_peg',
    { code: state.myRoom?.code, pegId },
    ({ ok, error, validMoves }) => {
      if (error || !ok) {
        return;
      }
      state.localSelectedPegId = pegId;
      state.localPhase = PHASE.SELECT_TILE;
      state.validMovesSet = new Set(validMoves);
      renderAll(gameState);
    },
  );
}

// Tile click handler
export function onTileClick(r, c) {
  const gameState = state.gameState;
  if (!gameState || state.myPlayerIndex === null) {
    return;
  }
  if (gameState.currentPlayerIdx !== state.myPlayerIndex) {
    return;
  }
  const phase = state.localPhase ?? gameState.phase;
  if (phase !== PHASE.SELECT_TILE) {
    return;
  }
  if (!state.localSelectedPegId) {
    return;
  }
  const coord = r * COORD_BASE + c;
  if (!state.validMovesSet.has(coord)) {
    return;
  }

  const defPegId = gameState.board[r]?.[c]?.pegId;
  if (defPegId && gameState.pegs[defPegId]?.playerId !== state.myPlayerIndex) {
    state.pendingCombatDefenderIdx = gameState.pegs[defPegId].playerId;
  } else {
    state.pendingCombatDefenderIdx = null;
  }

  const socket = getSocket();
  socket.emit(
    'action:select_tile',
    { code: state.myRoom?.code, pegId: state.localSelectedPegId, r, c },
    ({ ok, error, moveType, question: q, questionsTotal, defenderPlayerIdx }) => {
      if (error || !ok) {
        return;
      }
      if (defenderPlayerIdx !== undefined) {
        state.pendingCombatDefenderIdx = defenderPlayerIdx;
      }
      state.localPhase = 'answering';
      state.pendingMove = {
        pegId: state.localSelectedPegId,
        targetR: r,
        targetC: c,
        moveType,
      };
      state.pendingQuestions = q ? [q] : [];
      state.pendingQuestionsTotal = questionsTotal ?? 1;
      state.pendingAnswers = [];
      state.currentQIdx = 0;
      state.spectateGen = state.spectateGen + 1;
      showQuestion(0);
    },
  );
}

// Submit turn
export function submitTurn() {
  const lastAnswer = state.pendingAnswers[state.pendingAnswers.length - 1];
  state.lastSubmittedPegId = state.pendingMove?.pegId ?? state.lastSubmittedPegId;
  state.lastSubmittedMoveType = state.pendingMove?.moveType ?? state.lastSubmittedMoveType;

  const socket = getSocket();
  socket.emit(
    'turn:submit',
    {
      code: state.myRoom?.code,
      submission: {
        pegId: state.pendingMove.pegId,
        targetR: state.pendingMove.targetR,
        targetC: state.pendingMove.targetC,
        answerIdx: lastAnswer?.answerIdx ?? -1,
      },
    },
    ({ error }) => {
      if (error) {
        console.error('submit:', error);
        showError(error);
        // Recover UI state
        state.localPhase = null;
        state.localSelectedPegId = null;
        state.validMovesSet = new Set();
        state.pendingMove = null;
        state.pendingQuestions = [];
        state.pendingAnswers = [];
        stopTimer();
        el('modal-overlay').classList.remove('visible');
      }
    },
  );

  state.localSelectedPegId = null;
  state.validMovesSet = new Set();
  state.localPhase = 'answering';
}

// Turn announcement
export function showTurnAnnounce(player, isMe) {
  const container = el('turn-announce');
  if (!container) {
    return;
  }
  const nameEl = el('turn-announce-name');
  const subEl = el('turn-announce-sub');
  nameEl.textContent = player.name;
  nameEl.style.color = player.color;
  subEl.textContent = isMe ? 'YOUR TURN' : 'THEIR TURN';
  container.classList.add('visible');
  setTimeout(() => container.classList.remove('visible'), 2000);
}

// Navigation cursor
export function initNavCursor(gameState) {
  const cp = gameState.players[gameState.currentPlayerIdx];
  const firstPegId = cp?.pegIds?.[0];
  if (firstPegId) {
    const peg = gameState.pegs[firstPegId];
    if (peg) {
      state.navCursor = { row: peg.row, col: peg.col };
    }
  }
}

export function setNavCursorToPeg(gameState, pegId) {
  const peg = pegId ? gameState.pegs?.[pegId] : null;
  if (!peg) {
    return false;
  }
  const changed = state.navCursor.row !== peg.row || state.navCursor.col !== peg.col;
  state.navCursor = { row: peg.row, col: peg.col };
  return changed;
}

// ============================================================
// BOARD-MODE SOCKET AND GAME EVENT HANDLERS (moved from main.js)
// ============================================================

// Walk through combat result entries after the last answer, advancing the modal
// one question at a time on a setTimeout chain. Guarded by spectateGen so stale
// timers from a previous combat sequence are discarded.
function advanceSpectateResult(results, idx, moreQuestionsInProgress) {
  const gen = state.spectateGen;
  setTimeout(() => {
    if (state.spectateGen !== gen || !state.pendingQuestions.length) {
      return;
    }
    const next = idx + 1;
    if (moreQuestionsInProgress && next < state.pendingQuestions.length) {
      state.currentQIdx = next;
      showQuestion(next);
      return;
    }
    if (next < results.length && next < state.pendingQuestions.length) {
      state.currentQIdx = next;
      showQuestion(next);
      const r = results[next];
      if (r?.chosenIdx >= 0) {
        gameModalOptionBtns[r.chosenIdx]?.classList.add(
          r.correct ? 'answer-correct' : 'answer-wrong',
        );
      }
      advanceSpectateResult(results, next, moreQuestionsInProgress);
      return;
    }
    state.spectatingQuestion = false;
    state.pendingQuestions = [];
    state.pendingAnswers = [];
    el('modal-overlay').classList.remove('visible');
  }, TIMING.RESULT_DISPLAY_MS);
}

function handleStateUpdate(
  newState,
  events,
  gameOver,
  winner,
  validMoves,
  results,
  moreQuestionsInProgress,
) {
  const shouldShowResults = results?.length && state.pendingQuestions.length > 0;
  const isNormalAttackerFlow =
    !state.spectatingQuestion && state.lastSubmittedMoveType === 'normal';
  const isNormalSpectatorFlow = state.spectatingQuestion && state.spectatingMoveType === 'normal';

  if (
    shouldShowResults &&
    state.pendingQuestions.length &&
    (isNormalAttackerFlow || isNormalSpectatorFlow)
  ) {
    stopTimer();
    state.spectateGen = state.spectateGen + 1;
    state.spectatingQuestion = false;
    state.pendingQuestions = [];
    state.pendingAnswers = [];
    state.lastSubmittedMoveType = null;
    el('modal-overlay').classList.remove('visible');
  } else if (shouldShowResults && state.pendingQuestions.length) {
    stopTimer();
    const startIdx = results.length - 1;
    state.currentQIdx = startIdx;
    const r = results[startIdx];
    if (r?.chosenIdx >= 0) {
      gameModalOptionBtns[r.chosenIdx]?.classList.add(
        r.correct ? 'answer-correct' : 'answer-wrong',
      );
    }
    advanceSpectateResult(results, startIdx, moreQuestionsInProgress);
  } else if (state.spectatingQuestion) {
    stopTimer();
    state.spectateGen = state.spectateGen + 1;
    state.spectatingQuestion = false;
    state.pendingQuestions = [];
    el('modal-overlay').classList.remove('visible');
  }

  const oldState = state.gameState;
  const prevPlayerIdx = oldState?.currentPlayerIdx;

  if (prevPlayerIdx !== newState.currentPlayerIdx) {
    if (!shouldShowResults) {
      state.spectateGen = state.spectateGen + 1;
      state.pendingQuestions = [];
      state.pendingAnswers = [];
      state.spectatingQuestion = false;
      stopTimer();
      el('modal-overlay').classList.remove('visible');
    }
  }

  const prevNavRow = state.navCursor.row;
  const prevNavCol = state.navCursor.col;
  state.gameState = newState;

  if (
    !moreQuestionsInProgress &&
    newState.phase === 'selectTile' &&
    newState.selectedPegId &&
    newState.currentPlayerIdx === state.myPlayerIndex &&
    validMoves
  ) {
    if (state.lastSubmittedPegId && newState.selectedPegId === state.lastSubmittedPegId) {
      state.localPhase = 'selectPeg';
      state.localSelectedPegId = null;
      state.validMovesSet.clear();
      setNavCursorToPeg(newState, newState.selectedPegId);
    } else {
      state.localPhase = 'selectTile';
      state.localSelectedPegId = newState.selectedPegId;
      state.validMovesSet = new Set(validMoves);
    }
  } else if (!moreQuestionsInProgress && state.localPhase !== 'selectTile') {
    state.localPhase = null;
    state.localSelectedPegId = null;
    state.validMovesSet.clear();
  }

  if (newState.currentPlayerIdx === state.myPlayerIndex && newState.phase === 'selectPeg') {
    const preferredPegId =
      state.lastSubmittedPegId &&
      newState.pegs[state.lastSubmittedPegId] &&
      newState.pegs[state.lastSubmittedPegId].playerId === state.myPlayerIndex
        ? state.lastSubmittedPegId
        : null;
    if (preferredPegId) {
      setNavCursorToPeg(newState, preferredPegId);
    } else {
      initNavCursor(newState);
    }
  }

  if (
    prevPlayerIdx !== newState.currentPlayerIdx ||
    newState.currentPlayerIdx !== state.myPlayerIndex
  ) {
    state.lastSubmittedPegId = null;
    state.lastSubmittedMoveType = null;
  }

  const navCursorChanged = prevNavRow !== state.navCursor.row || prevNavCol !== state.navCursor.col;
  if (navCursorChanged) {
    renderAll(newState);
  } else if (oldState && oldState.board) {
    renderChangedTiles(oldState, newState, events);
  } else {
    renderAll(newState);
  }

  if (!gameOver && prevPlayerIdx !== undefined && prevPlayerIdx !== newState.currentPlayerIdx) {
    const newPlayer = newState.players[newState.currentPlayerIdx];
    if (newPlayer) {
      showTurnAnnounce(newPlayer, newState.currentPlayerIdx === state.myPlayerIndex);
    }
  }

  if (gameOver) {
    setTimeout(() => showGameOver(winner, newState), 400);
  }
}

function showGameOver(winnerIdx, gameState) {
  const winner = gameState.players[winnerIdx];
  el('winner-text').textContent = `${winner?.name ?? 'Unknown'} wins!`;
  el('winner-text').style.color = winner?.color ?? '#ffd700';
  el('screen-gameover').style.display = 'flex';
  state.localPhase = null;
  state.localSelectedPegId = null;
  state.validMovesSet.clear();
  state.pendingMove = null;
  state.pendingQuestions = [];
  state.pendingAnswers = [];
  state.spectatingQuestion = false;
  stopTimer();
  el('modal-overlay').classList.remove('visible');
}

export function setupBoardSocketHandlers(sock) {
  sock.on('room:player_joined', ({ players }) => {
    renderPlayers(players, state.setupPlayerCount);
    el('lobby-status').textContent = `${players.length} / ${state.setupPlayerCount} players`;
    if (players.length === state.setupPlayerCount && state.isHost) {
      el('btn-start').disabled = false;
      el('btn-start').textContent = 'Start game';
    }
  });

  sock.on('game:player_disconnected', ({ playerName }) => {
    showError(`${playerName} disconnected.`);
    state.localPhase = null;
    state.localSelectedPegId = null;
    state.validMovesSet.clear();
    state.pendingMove = null;
    state.pendingQuestions = [];
    state.pendingAnswers = [];
    state.spectatingQuestion = false;
    stopTimer();
    el('modal-overlay').classList.remove('visible');
  });

  sock.on('room:player_left', ({ playerName, players }) => {
    renderPlayers(players, state.setupPlayerCount);
    el('lobby-status').textContent =
      `${players.length} / ${state.setupPlayerCount} players — ${playerName} left`;
    el('btn-start').disabled = true;
    el('btn-start').textContent = 'Waiting for players…';
  });

  sock.on('room:full', ({ players }) => {
    renderPlayers(players, state.setupPlayerCount);
    el('lobby-status').textContent = 'Room full — host can start the game';
    if (state.isHost) {
      el('btn-start').disabled = false;
      el('btn-start').textContent = 'Start game';
    }
  });

  sock.on('game:start', ({ settings, state: gameState }) => {
    state.timerDuration = settings.timer ?? 30;
    state.gameState = gameState;
    initBoard(gameState);
    if (gameState.currentPlayerIdx === state.myPlayerIndex) {
      initNavCursor(gameState);
    }
    renderAll(gameState);
    showScreen('screen-game');
  });

  sock.on(
    'state:update',
    ({
      state: newState,
      events,
      gameOver,
      winner,
      validMoves,
      results,
      moreQuestionsInProgress,
    }) => {
      handleStateUpdate(
        newState,
        events,
        gameOver,
        winner,
        validMoves,
        results,
        moreQuestionsInProgress,
      );
    },
  );

  sock.on(
    'game:question_start',
    ({ playerIdx, moveType, question: q, questionsTotal, defenderPlayerIdx }) => {
      if (state.myPlayerIndex === playerIdx) {
        return;
      }
      state.spectatingQuestion = true;
      state.spectatingMoveType = moveType;
      state.spectatingPlayerIdx = playerIdx;
      state.spectatingDefenderIdx = defenderPlayerIdx ?? null;
      state.pendingQuestions = q ? [q] : [];
      state.pendingQuestionsTotal = questionsTotal ?? 1;
      state.currentQIdx = 0;
      state.spectateGen = state.spectateGen + 1;
      showQuestion(0);
    },
  );

  sock.on('game:next_question', ({ question: q, questionIdx }) => {
    state.currentQIdx = questionIdx;
    state.pendingQuestions[questionIdx] = q;
    showQuestion(questionIdx);
  });

  sock.on('game:answer_preview', ({ questionIdx, answerIdx, correct }) => {
    if (!state.spectatingQuestion || state.currentQIdx !== questionIdx) {
      return;
    }
    gameModalOptionBtns[answerIdx]?.classList.add(correct ? 'answer-correct' : 'answer-wrong');
  });
}

export function setupBoardGameHandlers(sock) {
  el('btn-create').addEventListener('click', () => {
    const playerName = getPlayerName();
    if (!playerName) {return;}
    if (state.setupEnabledCats.length === 0) {
      return showError('Select at least one category.');
    }
    sock.emit(
      'room:create',
      {
        playerName,
        playerCount: state.setupPlayerCount,
        boardSize: state.setupBoardSize,
        timer: state.setupTimer,
        enabledCats: state.setupEnabledCats,
      },
      ({ error, code, players, token }) => {
        if (error) {return showError(error);}
        const me = players.find((p) => p.id === state.myId);
        if (me) {
          el('player-name').value = me.name;
        }
        state.myToken = token;
        state.myPlayerIndex = 0;
        state.myRoom = {
          code,
          settings: { playerCount: state.setupPlayerCount, timer: state.setupTimer },
        };
        state.isHost = true;
        el('lobby-code').textContent = code;
        renderPlayers(players, state.myRoom.settings.playerCount);
        el('lobby-status').textContent =
          `${players.length} / ${state.myRoom.settings.playerCount} players`;
        showScreen('screen-lobby');
      },
    );
  });

  el('btn-join').addEventListener('click', () => {
    const playerName = getPlayerName();
    if (!playerName) {return;}
    const code = el('join-code')
      .value.trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) {
      return showError('Room code must be 5 characters.');
    }
    sock.emit('room:join', { code, playerName }, ({ error, players, settings, token }) => {
      if (error) {return showError(error);}
      const me = players.find((p) => p.id === state.myId);
      if (me) {
        el('player-name').value = me.name;
      }
      state.myToken = token;
      state.myPlayerIndex = me?.index ?? players.length - 1;
      state.myRoom = { code, settings };
      state.isHost = false;
      el('lobby-code').textContent = code;
      renderPlayers(players, settings.playerCount);
      el('lobby-status').textContent = `${players.length} / ${settings.playerCount} players`;
      showScreen('screen-lobby');
    });
  });

  el('btn-start').addEventListener('click', () => {
    sock.emit('room:start', { code: state.myRoom.code }, ({ error }) => {
      if (error) {showError(error);}
    });
  });

  el('btn-copy-code').addEventListener('click', () => {
    if (!state.myRoom?.code) {return;}
    navigator.clipboard
      .writeText(state.myRoom.code)
      .then(() => {
        const btn = el('btn-copy-code');
        const originalText = btn.textContent;
        btn.textContent = '✅';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      })
      .catch((err) => {
        console.error('Failed to copy code: ', err);
      });
  });

  el('join-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });
}
