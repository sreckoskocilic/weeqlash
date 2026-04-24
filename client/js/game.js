// ============================================================
// GAME INTERACTION
// ============================================================

import { el } from './dom.js';
import { showError } from './dom.js';
import { showScreen } from './dom.js';
import { renderAll } from './render.js';
import { PHASE, COORD_BASE } from './constants.js';
import {
  getGameState,
  setGameState,
  myRoom,
  localPhase,
  setLocalPhase,
  localSelectedPegId,
  setLocalSelectedPegId,
  validMovesSet,
  setValidMovesSet,
  myPlayerIndex,
  pendingMove,
  setPendingMove,
  pendingQuestions,
  setPendingQuestions,
  pendingQuestionsTotal,
  setPendingQuestionsTotal,
  pendingAnswers,
  setPendingAnswers,
  currentQIdx,
  setCurrentQIdx,
  spectateGen,
  setSpectateGen,
  pendingCombatDefenderIdx,
  setPendingCombatDefenderIdx,
  lastSubmittedPegId,
  setLastSubmittedPegId,
  lastSubmittedMoveType,
  setLastSubmittedMoveType,
  navCursor,
  setNavCursor,
} from './state.js';

import { getSocket } from './socket.js';
import { showQuestion } from './question.js';

// Namespace imports for the board-mode handlers below (moved from main.js)
import * as state from './state.js';
import * as dom from './dom.js';
import * as render from './render.js';
import * as question from './question.js';
import * as lobby from './lobby.js';
import * as constants from './constants.js';

// Peg click handler
export function onPegClick(pegId) {
  const gameState = getGameState();
  if (!gameState || myPlayerIndex === null) {
    return;
  }
  if (gameState.currentPlayerIdx !== myPlayerIndex) {
    return;
  }
  const phase = localPhase ?? gameState.phase;
  if (phase !== PHASE.SELECT_PEG && phase !== PHASE.SELECT_TILE) {
    return;
  }
  const myPlayer = gameState.players[myPlayerIndex];
  if (!myPlayer?.pegIds.includes(pegId)) {
    return;
  }
  // Deselect current peg
  if (phase === PHASE.SELECT_TILE && pegId === localSelectedPegId) {
    setLocalSelectedPegId(null);
    setLocalPhase(PHASE.SELECT_PEG);
    setValidMovesSet(new Set());
    renderAll(gameState);
    return;
  }

  const socket = getSocket();
  socket.emit('action:select_peg', { code: myRoom?.code, pegId }, ({ ok, error, validMoves }) => {
    if (error || !ok) {
      return;
    }
    setLocalSelectedPegId(pegId);
    setLocalPhase(PHASE.SELECT_TILE);
    setValidMovesSet(new Set(validMoves));
    renderAll(gameState);
  });
}

// Tile click handler
export function onTileClick(r, c) {
  const gameState = getGameState();
  if (!gameState || myPlayerIndex === null) {
    return;
  }
  if (gameState.currentPlayerIdx !== myPlayerIndex) {
    return;
  }
  const phase = localPhase ?? gameState.phase;
  if (phase !== PHASE.SELECT_TILE) {
    return;
  }
  if (!localSelectedPegId) {
    return;
  }
  const coord = r * COORD_BASE + c;
  if (!validMovesSet.has(coord)) {
    return;
  }

  const defPegId = gameState.board[r]?.[c]?.pegId;
  if (defPegId && gameState.pegs[defPegId]?.playerId !== myPlayerIndex) {
    setPendingCombatDefenderIdx(gameState.pegs[defPegId].playerId);
  } else {
    setPendingCombatDefenderIdx(null);
  }

  const socket = getSocket();
  socket.emit(
    'action:select_tile',
    { code: myRoom?.code, pegId: localSelectedPegId, r, c },
    ({ ok, error, moveType, question, questionsTotal, defenderPlayerIdx }) => {
      if (error || !ok) {
        return;
      }
      if (defenderPlayerIdx !== undefined) {
        setPendingCombatDefenderIdx(defenderPlayerIdx);
      }
      setLocalPhase('answering');
      setPendingMove({
        pegId: localSelectedPegId,
        targetR: r,
        targetC: c,
        moveType,
      });
      setPendingQuestions(question ? [question] : []);
      setPendingQuestionsTotal(questionsTotal ?? 1);
      setPendingAnswers([]);
      setCurrentQIdx(0);
      setSpectateGen(spectateGen + 1);
      showQuestion(0);
    },
  );
}

// Submit turn
export function submitTurn() {
  const lastAnswer = pendingAnswers[pendingAnswers.length - 1];
  setLastSubmittedPegId(pendingMove?.pegId ?? lastSubmittedPegId);
  setLastSubmittedMoveType(pendingMove?.moveType ?? lastSubmittedMoveType);

  const socket = getSocket();
  socket.emit(
    'turn:submit',
    {
      code: myRoom?.code,
      submission: {
        pegId: pendingMove.pegId,
        targetR: pendingMove.targetR,
        targetC: pendingMove.targetC,
        answerIdx: lastAnswer?.answerIdx ?? -1,
      },
    },
    ({ error }) => {
      if (error) {
        console.error('submit:', error);
        showError(error);
        // Recover UI state
        setLocalPhase(null);
        setLocalSelectedPegId(null);
        setValidMovesSet(new Set());
        setPendingMove(null);
        setPendingQuestions([]);
        setPendingAnswers([]);
        import('./question.js').then(({ stopTimer }) => stopTimer());
        el('modal-overlay').classList.remove('visible');
      }
    },
  );

  setLocalSelectedPegId(null);
  setValidMovesSet(new Set());
  setLocalPhase('answering');
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
export function initNavCursor(state) {
  const cp = state.players[state.currentPlayerIdx];
  const firstPegId = cp?.pegIds?.[0];
  if (firstPegId) {
    const peg = state.pegs[firstPegId];
    if (peg) {
      setNavCursor({ row: peg.row, col: peg.col });
    }
  }
}

export function setNavCursorToPeg(state, pegId) {
  const peg = pegId ? state.pegs?.[pegId] : null;
  if (!peg) {
    return false;
  }
  const changed = navCursor.row !== peg.row || navCursor.col !== peg.col;
  setNavCursor({ row: peg.row, col: peg.col });
  return changed;
}

// Initialize board for external use
export { initBoard } from './render.js';

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
      state.setCurrentQIdx(next);
      question.showQuestion(next);
      return;
    }
    if (next < results.length && next < state.pendingQuestions.length) {
      state.setCurrentQIdx(next);
      question.showQuestion(next);
      const r = results[next];
      if (r?.chosenIdx >= 0) {
        question.gameModalOptionBtns[r.chosenIdx]?.classList.add(
          r.correct ? 'answer-correct' : 'answer-wrong',
        );
      }
      advanceSpectateResult(results, next, moreQuestionsInProgress);
      return;
    }
    state.setSpectatingQuestion(false);
    state.setPendingQuestions([]);
    state.setPendingAnswers([]);
    dom.el('modal-overlay').classList.remove('visible');
  }, constants.TIMING.RESULT_DISPLAY_MS);
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
    question.stopTimer();
    state.setSpectateGen(state.spectateGen + 1);
    state.setSpectatingQuestion(false);
    state.setPendingQuestions([]);
    state.setPendingAnswers([]);
    state.setLastSubmittedMoveType(null);
    dom.el('modal-overlay').classList.remove('visible');
  } else if (shouldShowResults && state.pendingQuestions.length) {
    question.stopTimer();
    const startIdx = results.length - 1;
    state.setCurrentQIdx(startIdx);
    const r = results[startIdx];
    if (r?.chosenIdx >= 0) {
      question.gameModalOptionBtns[r.chosenIdx]?.classList.add(
        r.correct ? 'answer-correct' : 'answer-wrong',
      );
    }
    advanceSpectateResult(results, startIdx, moreQuestionsInProgress);
  } else if (state.spectatingQuestion) {
    question.stopTimer();
    state.setSpectateGen(state.spectateGen + 1);
    state.setSpectatingQuestion(false);
    state.setPendingQuestions([]);
    dom.el('modal-overlay').classList.remove('visible');
  }

  const oldState = state.getGameState();
  const prevPlayerIdx = oldState?.currentPlayerIdx;

  if (prevPlayerIdx !== newState.currentPlayerIdx) {
    if (!shouldShowResults) {
      state.setSpectateGen(state.spectateGen + 1);
      state.setPendingQuestions([]);
      state.setPendingAnswers([]);
      state.setSpectatingQuestion(false);
      question.stopTimer();
      dom.el('modal-overlay').classList.remove('visible');
    }
  }

  const prevNavRow = state.navCursor.row;
  const prevNavCol = state.navCursor.col;
  state.setGameState(newState);

  if (
    !moreQuestionsInProgress &&
    newState.phase === 'selectTile' &&
    newState.selectedPegId &&
    newState.currentPlayerIdx === state.myPlayerIndex &&
    validMoves
  ) {
    if (state.lastSubmittedPegId && newState.selectedPegId === state.lastSubmittedPegId) {
      state.setLocalPhase('selectPeg');
      state.setLocalSelectedPegId(null);
      state.validMovesSet.clear();
      setNavCursorToPeg(newState, newState.selectedPegId);
    } else {
      state.setLocalPhase('selectTile');
      state.setLocalSelectedPegId(newState.selectedPegId);
      state.setValidMovesSet(new Set(validMoves));
    }
  } else if (!moreQuestionsInProgress && state.localPhase !== 'selectTile') {
    state.setLocalPhase(null);
    state.setLocalSelectedPegId(null);
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
    state.setLastSubmittedPegId(null);
    state.setLastSubmittedMoveType(null);
  }

  const navCursorChanged = prevNavRow !== state.navCursor.row || prevNavCol !== state.navCursor.col;
  if (navCursorChanged) {
    render.renderAll(newState);
  } else if (oldState && oldState.board) {
    render.renderChangedTiles(oldState, newState, events);
  } else {
    render.renderAll(newState);
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
  dom.el('winner-text').textContent = `${winner?.name ?? 'Unknown'} wins!`;
  dom.el('winner-text').style.color = winner?.color ?? '#ffd700';
  dom.el('screen-gameover').style.display = 'flex';
  state.setLocalPhase(null);
  state.setLocalSelectedPegId(null);
  state.validMovesSet.clear();
  state.setPendingMove(null);
  state.setPendingQuestions([]);
  state.setPendingAnswers([]);
  state.setSpectatingQuestion(false);
  question.stopTimer();
  dom.el('modal-overlay').classList.remove('visible');
}

export function setupBoardSocketHandlers(sock) {
  sock.on('room:player_joined', ({ players }) => {
    lobby.renderPlayers(players, state.setupPlayerCount);
    dom.el('lobby-status').textContent = `${players.length} / ${state.setupPlayerCount} players`;
    if (players.length === state.setupPlayerCount && state.isHost) {
      dom.el('btn-start').disabled = false;
      dom.el('btn-start').textContent = 'Start game';
    }
  });

  sock.on('game:player_disconnected', ({ playerName }) => {
    dom.showError(`${playerName} disconnected.`);
    state.setLocalPhase(null);
    state.setLocalSelectedPegId(null);
    state.validMovesSet.clear();
    state.setPendingMove(null);
    state.setPendingQuestions([]);
    state.setPendingAnswers([]);
    state.setSpectatingQuestion(false);
    question.stopTimer();
    dom.el('modal-overlay').classList.remove('visible');
  });

  sock.on('room:player_left', ({ playerName, players }) => {
    lobby.renderPlayers(players, state.setupPlayerCount);
    dom.el('lobby-status').textContent =
      `${players.length} / ${state.setupPlayerCount} players — ${playerName} left`;
    dom.el('btn-start').disabled = true;
    dom.el('btn-start').textContent = 'Waiting for players…';
  });

  sock.on('room:full', ({ players }) => {
    lobby.renderPlayers(players, state.setupPlayerCount);
    dom.el('lobby-status').textContent = 'Room full — host can start the game';
    if (state.isHost) {
      dom.el('btn-start').disabled = false;
      dom.el('btn-start').textContent = 'Start game';
    }
  });

  sock.on('game:start', ({ settings, state: gameState }) => {
    state.setTimerDuration(settings.timer ?? 30);
    state.setGameState(gameState);
    render.initBoard(gameState);
    if (gameState.currentPlayerIdx === state.myPlayerIndex) {
      initNavCursor(gameState);
    }
    render.renderAll(gameState);
    dom.showScreen('screen-game');
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
      state.setSpectatingQuestion(true);
      state.setSpectatingMoveType(moveType);
      state.setSpectatingPlayerIdx(playerIdx);
      state.setSpectatingDefenderIdx(defenderPlayerIdx ?? null);
      state.setPendingQuestions(q ? [q] : []);
      state.setPendingQuestionsTotal(questionsTotal ?? 1);
      state.setCurrentQIdx(0);
      state.setSpectateGen(state.spectateGen + 1);
      question.showQuestion(0);
    },
  );

  sock.on('game:next_question', ({ question: q, questionIdx }) => {
    state.setCurrentQIdx(questionIdx);
    state.pendingQuestions[questionIdx] = q;
    question.showQuestion(questionIdx);
  });

  sock.on('game:answer_preview', ({ questionIdx, answerIdx, correct }) => {
    if (!state.spectatingQuestion || state.currentQIdx !== questionIdx) {
      return;
    }
    question.gameModalOptionBtns[answerIdx]?.classList.add(
      correct ? 'answer-correct' : 'answer-wrong',
    );
  });
}

export function setupBoardGameHandlers(sock) {
  dom.el('btn-create').addEventListener('click', () => {
    const playerName = dom.getPlayerName();
    if (!playerName) return;
    if (state.setupEnabledCats.length === 0) {
      return dom.showError('Select at least one category.');
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
        if (error) return dom.showError(error);
        const me = players.find((p) => p.id === state.myId);
        if (me) {
          dom.el('player-name').value = me.name;
        }
        state.setMyToken(token);
        state.setMyPlayerIndex(0);
        state.setMyRoom({
          code,
          settings: { playerCount: state.setupPlayerCount, timer: state.setupTimer },
        });
        state.setIsHost(true);
        dom.el('lobby-code').textContent = code;
        lobby.renderPlayers(players, state.myRoom.settings.playerCount);
        dom.el('lobby-status').textContent =
          `${players.length} / ${state.myRoom.settings.playerCount} players`;
        dom.showScreen('screen-lobby');
      },
    );
  });

  dom.el('btn-join').addEventListener('click', () => {
    const playerName = dom.getPlayerName();
    if (!playerName) return;
    const code = dom
      .el('join-code')
      .value.trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) {
      return dom.showError('Room code must be 5 characters.');
    }
    sock.emit('room:join', { code, playerName }, ({ error, players, settings, token }) => {
      if (error) return dom.showError(error);
      const me = players.find((p) => p.id === state.myId);
      if (me) {
        dom.el('player-name').value = me.name;
      }
      state.setMyToken(token);
      state.setMyPlayerIndex(me?.index ?? players.length - 1);
      state.setMyRoom({ code, settings });
      state.setIsHost(false);
      dom.el('lobby-code').textContent = code;
      lobby.renderPlayers(players, settings.playerCount);
      dom.el('lobby-status').textContent = `${players.length} / ${settings.playerCount} players`;
      dom.showScreen('screen-lobby');
    });
  });

  dom.el('btn-start').addEventListener('click', () => {
    sock.emit('room:start', { code: state.myRoom.code }, ({ error }) => {
      if (error) dom.showError(error);
    });
  });

  dom.el('btn-copy-code').addEventListener('click', () => {
    if (!state.myRoom?.code) return;
    navigator.clipboard
      .writeText(state.myRoom.code)
      .then(() => {
        const btn = dom.el('btn-copy-code');
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

  dom.el('join-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });
}
