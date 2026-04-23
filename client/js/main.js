// ============================================================
// MAIN ENTRY POINT
// ============================================================

import * as constants from './constants.js';
import * as state from './state.js';
import * as dom from './dom.js';
import * as auth from './auth.js';
import * as socket from './socket.js';
import * as render from './render.js';
import * as game from './game.js';
import * as question from './question.js';
import * as quiz from './quiz.js';
import * as leaderboard from './leaderboard.js';
import * as stats from './stats.js';
import * as keyboard from './keyboard.js';
import * as lobby from './lobby.js';
import * as qlashique from './qlashique.js';

// Server URL configuration
const serverUrl =
  window.WEEFLASH_SERVER_URL ||
  (window.location.protocol === 'file:' ? 'http://localhost:3000' : window.location.origin);

// Initialize Socket.IO
async function init() {
  const { io } = await import(`${serverUrl}/socket.io/socket.io.esm.min.js`);
  
  const sock = io(serverUrl, {
    transports: ['websocket'],
    withCredentials: true,
  });

  // Initialize all modules
  socket.initSocket(serverUrl, sock);
  socket.initSocketEvents();
  
  auth.initAuth(serverUrl, sock);
  auth.initAuthHandlers();

  // Set up socket event handlers
  setupSocketHandlers(sock);

  // Initialize UI
  initUI();

  // Set up game event handlers
  setupGameHandlers(sock);

  // Quiz mode handlers
  setupQuizHandlers(sock);

  // Keyboard handlers
  keyboard.initKeyboard();

  // Load leaderboard on connect
  sock.on('connect', () => {
    leaderboard.loadMainLeaderboard();
    state.setMyId(sock.id);
    
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      dom.el('dev-quickstart-section').style.display = '';
    }
  });
}

function setupSocketHandlers(sock) {
  // Lobby handlers
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
    state.timerDuration = settings.timer ?? 30;
    state.setGameState(gameState);
    render.initBoard(gameState);
    if (gameState.currentPlayerIdx === state.myPlayerIndex) {
      game.initNavCursor(gameState);
    }
    render.renderAll(gameState);
    dom.showScreen('screen-game');
  });

  // State update handler
  sock.on('state:update', ({ state: newState, events, gameOver, winner, validMoves, results, moreQuestionsInProgress }) => {
    handleStateUpdate(sock, newState, events, gameOver, winner, validMoves, results, moreQuestionsInProgress);
  });

  // Question handlers
  sock.on('game:question_start', ({ playerIdx, moveType, question, questionsTotal, defenderPlayerIdx }) => {
    if (state.myPlayerIndex === playerIdx) {
      return;
    }
    state.setSpectatingQuestion(true);
    state.setSpectatingMoveType(moveType);
    state.setSpectatingPlayerIdx(playerIdx);
    state.setSpectatingDefenderIdx(defenderPlayerIdx ?? null);
    state.setPendingQuestions(question ? [question] : []);
    state.setPendingQuestionsTotal(questionsTotal ?? 1);
    state.setCurrentQIdx(0);
    state.setSpectateGen(state.spectateGen + 1);
    question.showQuestion(0);
  });

  sock.on('game:next_question', ({ question, questionIdx }) => {
    state.setCurrentQIdx(questionIdx);
    state.pendingQuestions[questionIdx] = question;
    question.showQuestion(questionIdx);
  });

  sock.on('game:answer_preview', ({ questionIdx, answerIdx, correct }) => {
    if (!state.spectatingQuestion || state.currentQIdx !== questionIdx) {
      return;
    }
    question.gameModalOptionBtns[answerIdx]?.classList.add(correct ? 'answer-correct' : 'answer-wrong');
  });

  // Qlashique handlers
  setupQlashiqueHandlers(sock);
}

function handleStateUpdate(sock, newState, events, gameOver, winner, validMoves, results, moreQuestionsInProgress) {
  const shouldShowResults = results?.length && state.pendingQuestions.length > 0;
  const isNormalAttackerFlow = !state.spectatingQuestion && state.lastSubmittedMoveType === 'normal';
  const isNormalSpectatorFlow = state.spectatingQuestion && state.spectatingMoveType === 'normal';

  if (shouldShowResults && state.pendingQuestions.length && (isNormalAttackerFlow || isNormalSpectatorFlow)) {
    question.stopTimer();
    state.setSpectateGen(state.spectateGen + 1);
    state.setSpectatingQuestion(false);
    state.setPendingQuestions([]);
    state.setPendingAnswers([]);
    state.setLastSubmittedMoveType(null);
    dom.el('modal-overlay').classList.remove('visible');
  } else if (shouldShowResults && state.pendingQuestions.length) {
    question.stopTimer();
    if (state.spectatingQuestion) {
      const startIdx = results.length - 1;
      state.setCurrentQIdx(startIdx);
      const r = results[startIdx];
      if (r?.chosenIdx >= 0) {
        question.gameModalOptionBtns[r.chosenIdx]?.classList.add(
          r.correct ? 'answer-correct' : 'answer-wrong',
        );
      }
    } else {
      const startIdx = results.length - 1;
      state.setCurrentQIdx(startIdx);
      const r = results[startIdx];
      if (r?.chosenIdx >= 0) {
        question.gameModalOptionBtns[r.chosenIdx]?.classList.add(
          r.correct ? 'answer-correct' : 'answer-wrong',
        );
      }
    }
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

  // Restore local state for sequential moves
  if (!moreQuestionsInProgress && newState.phase === 'selectTile' && newState.selectedPegId && newState.currentPlayerIdx === state.myPlayerIndex && validMoves) {
    if (state.lastSubmittedPegId && newState.selectedPegId === state.lastSubmittedPegId) {
      state.setLocalPhase('selectPeg');
      state.setLocalSelectedPegId(null);
      state.validMovesSet.clear();
      game.setNavCursorToPeg(newState, newState.selectedPegId);
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
    const preferredPegId = state.lastSubmittedPegId && newState.pegs[state.lastSubmittedPegId] && newState.pegs[state.lastSubmittedPegId].playerId === state.myPlayerIndex ? state.lastSubmittedPegId : null;
    if (preferredPegId) {
      game.setNavCursorToPeg(newState, preferredPegId);
    } else {
      game.initNavCursor(newState);
    }
  }

  if (prevPlayerIdx !== newState.currentPlayerIdx || newState.currentPlayerIdx !== state.myPlayerIndex) {
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
      game.showTurnAnnounce(newPlayer, newState.currentPlayerIdx === state.myPlayerIndex);
    }
  }

  if (gameOver) {
    setTimeout(() => showGameOver(winner, newState), 400);
  }
}

function showGameOver(winnerIdx, state) {
  const winner = state.players[winnerIdx];
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

function initUI() {
  // Populate category toggle buttons
  dom.el('cat-toggle-btns').innerHTML = constants.CATS.map(
    (cat) => `<button class="cat-toggle-btn active" data-cat="${cat}">${constants.CAT_NAMES[cat]}</button>`,
  ).join('');

  state.setupEnabledCats = constants.CATS.filter((c) => c !== 'death_metal' && c !== 'epl_2025');

  // Setup button groups
  initOptBtnGroup('board-size-btns', (v) => {
    state.setupBoardSize = v;
  });
  initOptBtnGroup('timer-btns', (v) => {
    state.setupTimer = v;
  });

  // Category toggles
  dom.el('cat-toggle-btns').addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-toggle-btn');
    if (!btn) return;
    const cat = btn.dataset.cat;
    if (state.setupEnabledCats.includes(cat)) {
      if (state.setupEnabledCats.length <= 1) return;
      state.setupEnabledCats = state.setupEnabledCats.filter((c) => c !== cat);
      btn.classList.remove('active');
    } else {
      state.setupEnabledCats.push(cat);
      btn.classList.add('active');
    }
  });

  dom.el('btn-cats-all').addEventListener('click', () => {
    state.setupEnabledCats = [...constants.CATS];
    document.querySelectorAll('#cat-toggle-btns .cat-toggle-btn').forEach((btn) => {
      btn.classList.add('active');
    });
  });

  dom.el('btn-cats-none').addEventListener('click', () => {
    state.setupEnabledCats = [];
    document.querySelectorAll('#cat-toggle-btns .cat-toggle-btn').forEach((btn) => {
      btn.classList.remove('active');
    });
  });

  // Help and settings
  dom.el('btn-help').addEventListener('click', () => {
    dom.el('help-modal').classList.add('show');
  });
  dom.el('btn-hc').addEventListener('click', () => {
    document.body.classList.toggle('high-contrast');
    dom.el('btn-hc').classList.toggle('active', document.body.classList.contains('high-contrast'));
  });
  dom.el('btn-advanced').addEventListener('click', () => {
    const sec = dom.el('advanced-section');
    const visible = sec.style.display !== 'none';
    sec.style.display = visible ? 'none' : 'block';
    dom.el('btn-advanced').classList.toggle('active', !visible);
  });

  // Window globals for HTML onclick handlers
  window.closeHelp = function() {
    dom.el('help-modal').classList.remove('show');
  };
  dom.el('help-modal').addEventListener('click', (e) => {
    if (e.target === dom.el('help-modal')) {
      window.closeHelp();
    }
  });

  window.openLegal = function(page) {
    document.getElementById('modal-' + page).classList.add('open');
  };
  window.closeLegal = function(page) {
    document.getElementById('modal-' + page).classList.remove('open');
  };
  ['privacy', 'cookies', 'terms'].forEach((page) => {
    document.getElementById('modal-' + page).addEventListener('click', (e) => {
      if (e.target === document.getElementById('modal-' + page)) {
        window.closeLegal(page);
      }
    });
  });

  // Dev quickstart
  dom.el('btn-dev-quickstart').addEventListener('click', () => {
    state.myPlayerIndex = 0;
    const sock = socket.getSocket();
    sock.emit('dev:quickstart', { boardSize: 4 }, ({ ok, error }) => {
      if (!ok) {
        dom.showError(error ?? 'Dev quickstart failed');
      }
    });
  });
}

function initOptBtnGroup(groupId, setter) {
  const group = dom.el(groupId);
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.opt-btn');
    if (!btn) return;
    group.querySelectorAll('.opt-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    setter(parseInt(btn.dataset.val));
  });
}

function setupGameHandlers(sock) {
  // Create game
  dom.el('btn-create').addEventListener('click', () => {
    const playerName = dom.getPlayerName();
    if (!playerName) return;
    if (state.setupEnabledCats.length === 0) {
      return dom.showError('Select at least one category.');
    }
    sock.emit('room:create', {
      playerName,
      playerCount: state.setupPlayerCount,
      boardSize: state.setupBoardSize,
      timer: state.setupTimer,
      enabledCats: state.setupEnabledCats,
    }, ({ error, code, players, token }) => {
      if (error) return dom.showError(error);
      const me = players.find((p) => p.id === state.myId);
      if (me) {
        dom.el('player-name').value = me.name;
      }
      state.myToken = token;
      state.myPlayerIndex = 0;
      state.myRoom = { code, settings: { playerCount: state.setupPlayerCount, timer: state.setupTimer } };
      state.isHost = true;
      dom.el('lobby-code').textContent = code;
      lobby.renderPlayers(players, state.myRoom.settings.playerCount);
      dom.el('lobby-status').textContent = `${players.length} / ${state.myRoom.settings.playerCount} players`;
      dom.showScreen('screen-lobby');
    });
  });

  // Join game
  dom.el('btn-join').addEventListener('click', () => {
    const playerName = dom.getPlayerName();
    if (!playerName) return;
    const code = dom.el('join-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) {
      return dom.showError('Room code must be 5 characters.');
    }
    sock.emit('room:join', { code, playerName }, ({ error, players, settings, token }) => {
      if (error) return dom.showError(error);
      const me = players.find((p) => p.id === state.myId);
      if (me) {
        dom.el('player-name').value = me.name;
      }
      state.myToken = token;
      state.myPlayerIndex = me?.index ?? players.length - 1;
      state.myRoom = { code, settings };
      state.isHost = false;
      dom.el('lobby-code').textContent = code;
      lobby.renderPlayers(players, settings.playerCount);
      dom.el('lobby-status').textContent = `${players.length} / ${settings.playerCount} players`;
      dom.showScreen('screen-lobby');
    });
  });

  // Start game
  dom.el('btn-start').addEventListener('click', () => {
    sock.emit('room:start', { code: state.myRoom.code }, ({ error }) => {
      if (error) dom.showError(error);
    });
  });

  // Copy code
  dom.el('btn-copy-code').addEventListener('click', () => {
    if (!state.myRoom?.code) return;
    navigator.clipboard.writeText(state.myRoom.code).then(() => {
      const btn = dom.el('btn-copy-code');
      const originalText = btn.textContent;
      btn.textContent = '✅';
      setTimeout(() => { btn.textContent = originalText; }, 2000);
    }).catch((err) => {
      console.error('Failed to copy code: ', err);
    });
  });

  // Input handling
  dom.el('join-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });
}

function setupQuizHandlers(sock) {
  document.getElementById('btn-quiz-start').addEventListener('click', () => quiz.startQuizMode('triviandom'));
  document.getElementById('btn-epl-start').addEventListener('click', () => quiz.startQuizMode('epl_2025'));

  dom.el('btn-show-triv-lb').addEventListener('click', () => {
    const panel = dom.el('triv-lb-panel');
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : '';
    dom.el('btn-show-triv-lb').textContent = visible ? 'Show Triviandom Leaderboard' : 'Hide Leaderboard';
    if (!visible) leaderboard.loadPanelLeaderboard('triviandom', 'triv-lb-rows');
  });

  dom.el('btn-show-epl-lb').addEventListener('click', () => {
    const panel = dom.el('epl-lb-panel');
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : '';
    dom.el('btn-show-epl-lb').textContent = visible ? 'Show EPL 2025 Leaderboard' : 'Hide EPL Leaderboard';
    if (!visible) leaderboard.loadPanelLeaderboard('epl_2025', 'epl-lb-rows');
  });
}

function setupQlashiqueHandlers(sock) {
  qlashique.initQlashique(sock);
}

// Export for external use
export { serverUrl };

// Start the app
init();