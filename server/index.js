import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
console.log('[index] Loading .env from:', envPath);
console.log('[index] .env exists:', existsSync(envPath));
const envResult = dotenv.config({ path: envPath });
console.log('[index] dotenv result:', envResult?.error || 'loaded');
console.log('[index] SMTP_HOST after dotenv:', process.env.SMTP_HOST);

import session from 'express-session';

import {
  createRoom,
  createQlasRoom,
  joinRoom,
  getRoom,
  removePlayerFromRoom,
  reattachSocket,
  cleanupStaleRooms,
  isInActiveGame,
} from './game/rooms.js';
import {
  createGame,
  selectPeg,
  planTurnQuestions,
  advancePendingQuestion,
  applyTurn,
  getValidMoves,
  PHASE,
  COORD_BASE,
} from './game/engine.js';
import { loadQuestions, getAllQuestions } from './game/questions.js';
import {
  createQlasGame,
  calcTimer,
  processAnswer,
  processReroll,
  endTurn,
  applyOutcome,
  checkInstantWin,
  checkGameOver,
  PHASE as QLAS_PHASE,
} from './game/qlashique.js';
import {
  initDb,
  getDb,
  getTop10,
  insertScore,
  checkQualifiesTop10,
  pruneLeaderboard,
} from './game/leaderboard.js';
import { initAuthDb, insertGameResult, trackAnswer } from './game/auth.js';
import { registerAuthRoutes } from './game/auth-routes.js';
import adminRoutes from './routes/admin.js';
import { rooms, socketToRoom } from './game/rooms.js';

const app = express();
app.set('trust proxy', 1);
const httpServer = createServer(app);

// Session store function - use MemoryStore (sessions persist while server runs)
function createSessionMiddleware() {
  const isSecure = process.env.NODE_ENV === 'production';
  return session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isSecure,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  });
}

// Serve client files for browser access
app.use(express.static(path.join(__dirname, '../client')));
const CORS_ORIGIN = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',')
  : ['https://brawl.weeqlash.icu', 'http://localhost:3000', 'http://127.0.0.1:3000'];
const io = new Server(httpServer, {
  cors: { origin: CORS_ORIGIN },
  // Enable default cookie parsing
  cookie: true,
});
const PORT = process.env.PORT || 3000;

// Minimum delay before accepting answers to ensure other players see the question
const MIN_ANSWER_DELAY_MS = 300;
// Maximum time allowed to answer a question (server-side timer)
const MAX_ANSWER_TIME_MS = 60_000;

// Rate limiting: throttle answer submissions per socket
const answerTimestamps = new Map(); // socketId -> lastAnswerTime
const RATE_LIMIT_MS = 500;

// Rate limiting: throttle lobby actions per socket
const lobbyTimestamps = new Map(); // socketId -> lastLobbyActionTime
const LOBBY_RATE_LIMIT_MS = 1000;

// Rate limiting: throttle answer preview broadcasts per socket
const previewTimestamps = new Map(); // socketId -> lastPreviewTime
const PREVIEW_RATE_LIMIT_MS = 200;

// Rate limiting: throttle quiz starts per socket
const quizTimestamps = new Map(); // socketId -> lastQuizStartTime
const QUIZ_RATE_LIMIT_MS = 2000;

// Quiz session tracking
const quizRuns = new Map(); // socketId -> { startedAt, questionIds[], answers: 0 }

// Periodic cleanup of stale rate limit entries (every 30s)
const rateLimitMaps = [answerTimestamps, lobbyTimestamps, previewTimestamps, quizTimestamps];
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const map of rateLimitMaps) {
    for (const [socketId, time] of map) {
      if (now - time > 60_000) {
        map.delete(socketId);
      }
    }
  }
}, 30_000);
cleanupInterval.unref();

// Periodic cleanup of orphaned rooms (every 60s)
const roomCleanupInterval = setInterval(() => {
  const removed = cleanupStaleRooms();
  if (removed > 0) {
    console.log(`[rooms] cleaned up ${removed} stale room(s)`);
  }
}, 60_000);
roomCleanupInterval.unref();

// Periodic leaderboard pruning (every 5 minutes)
const leaderboardPruneInterval = setInterval(() => {
  pruneLeaderboard();
}, 5 * 60_000);
leaderboardPruneInterval.unref();

// Graceful shutdown - clear intervals and close server
function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Shutting down...`);
  clearInterval(cleanupInterval);
  clearInterval(roomCleanupInterval);
  clearInterval(leaderboardPruneInterval);
  httpServer.close(() => {
    console.log('[shutdown] HTTP server closed');
    process.exit(0);
  });
}

// Enforce lobby action rate limit. Returns true if throttled.
function checkLobbyRateLimit(socketId, cb) {
  const now = Date.now();
  const last = lobbyTimestamps.get(socketId) || 0;
  if (now - last < LOBBY_RATE_LIMIT_MS) {
    cb?.({ error: 'Please wait before trying again.' });
    return true;
  }
  lobbyTimestamps.set(socketId, now);
  return false;
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Load questions once at startup
const questionsDb = loadQuestions();
initDb();
initAuthDb();

// Initialize session middleware
const sessionMiddleware = createSessionMiddleware();

// Session middleware must come BEFORE routes that use sessions
app.use(sessionMiddleware);

// Parse JSON bodies
app.use(express.json());

registerAuthRoutes(app);
app.use('/admin', adminRoutes);

// Share session with Socket.IO
io.engine.use(sessionMiddleware);

// Test-only: teleport a peg to an adjacent position for E2E testing
if (process.env.NODE_ENV !== 'production') {
  app.get('/test/peg-info/:code/:pegId', (req, res) => {
    const room = getRoom(req.params.code);
    if (!room?.state) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const peg = room.state.pegs[req.params.pegId];
    if (!peg) {
      return res.status(404).json({ error: 'Peg not found' });
    }
    const validMoves = getValidMoves(room.state, req.params.pegId);
    res.json({ peg, validMoves });
  });
  app.post('/test/teleport-peg', (req, res) => {
    const { code, pegId, row, col } = req.body;
    const room = getRoom(code);
    if (!room?.state) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const peg = room.state.pegs[pegId];
    if (!peg) {
      return res.status(404).json({ error: 'Peg not found' });
    }
    room.state.board[peg.row][peg.col].pegId = null;
    peg.row = row;
    peg.col = col;
    room.state.board[row][col].pegId = pegId;
    const sockets = io.sockets.adapter.rooms.get(code);
    io.to(code).emit('state:update', {
      state: JSON.parse(JSON.stringify(room.state)),
      events: [],
      gameOver: false,
    });
    res.json({
      ok: true,
      pegRow: peg.row,
      pegCol: peg.col,
      socketsInRoom: sockets ? sockets.size : 0,
    });
  });
}

// Serve client HTML for dev testing
app.get('/', (_req, res) => {
  res.type('text/html').send(readFileSync(path.join(__dirname, '../client/index.html'), 'utf8'));
});

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  // Associate socket with authenticated user if available
  const socketSession = socket.request.session;
  console.log('[auth] socket session full:', JSON.stringify(socketSession));
  if (socketSession?.userId) {
    socket.userId = socketSession.userId;
    socket.userName = socketSession.username;
    console.log(
      `[auth] ${socket.id} linked to user ${socketSession.userId} (${socketSession.username})`,
    );
  }

  // Client sends userId directly after login (workaround for session issues)
  socket.on('auth:setUserId', (userId) => {
    console.log('[auth] auth:setUserId received:', userId);
    if (userId) {
      socket.userId = userId;
      console.log(`[auth] ${socket.id} set userId to ${userId}`);
      // Update the player's userId in ALL rooms this socket might be in
      const code = socketToRoom.get(socket.id);
      console.log('[auth] socketToRoom lookup, code:', code);
      if (code) {
        const room = rooms.get(code);
        console.log('[auth] room found:', room ? 'yes' : 'no');
        if (room) {
          const player = room.players.find((p) => p.id === socket.id);
          console.log(
            '[auth] player found:',
            player ? player.name : 'no',
            'current userId:',
            player?.userId,
          );
          if (player) {
            player.userId = userId;
            console.log('[auth] Updated player userId in room to:', player.userId);
          }
        }
      } else {
        // Socket not in any room yet - store for when they join
        socket.pendingUserId = userId;
        console.log('[auth] No room yet, stored pendingUserId:', userId);
      }
    }
  });

  // Client can emit this after login to refresh session
  socket.on('auth:refresh', (cb) => {
    const sess = socket.request.session;
    console.log('[auth] refresh session received, full session:', JSON.stringify(sess));
    if (sess?.userId) {
      socket.userId = sess.userId;
      socket.userName = sess.username;
      console.log(`[auth] ${socket.id} refreshed to user ${sess.userId}`);
      // Update the player's userId in the room if they're in one
      const code = socketToRoom.get(socket.id);
      if (code) {
        const room = rooms.get(code);
        if (room) {
          const player = room.players.find((p) => p.id === socket.id);
          if (player) {
            player.userId = sess.userId;
            console.log('[auth] Updated player userId in room:', player.userId);
          }
        }
      }
    }
    cb?.({ ok: true, userId: socket.userId });
  });

  // --- Lobby ---

  socket.on('room:create', ({ playerName, playerCount, boardSize, timer, enabledCats }, cb) => {
    if (checkLobbyRateLimit(socket.id, cb)) {
      return;
    }
    // Clean up any lingering quiz session when joining a room game
    quizRuns.delete(socket.id);
    const room = createRoom({
      playerCount,
      boardSize,
      timer,
      enabledCats,
    });
    // Apply pending userId from earlier login if any
    const userId = socket.userId || socket.pendingUserId;
    const player = joinRoom(room.code, socket.id, playerName, userId || null);
    if (!player) {
      return cb({ error: 'Failed to create room' });
    }
    socket.join(room.code);
    console.log(`[room] ${room.code} created by ${playerName}`);
    const token = room.players.find((p) => p.id === socket.id)?.token;
    cb({
      ok: true,
      code: room.code,
      playerId: socket.id,
      players: room.players.map(publicPlayer),
      token,
    });
  });

  socket.on('room:join', ({ code, playerName }, cb) => {
    if (checkLobbyRateLimit(socket.id, cb)) {
      return;
    }
    // Clean up any lingering quiz session when joining a room game
    quizRuns.delete(socket.id);
    // Use socket.userId or pendingUserId if not yet in socket
    const userId = socket.userId || socket.pendingUserId;
    const joinResult = joinRoom(code, socket.id, playerName, userId || null);
    if (joinResult.error) {
      return cb(joinResult);
    }
    const room = getRoom(code);
    socket.join(code);
    socket.to(code).emit('room:player_joined', { players: room.players.map(publicPlayer) });
    const joiningPlayer = room.players.find((p) => p.id === socket.id);
    cb({
      ok: true,
      playerId: socket.id,
      myIdx: joiningPlayer?.index,
      players: room.players.map(publicPlayer),
      settings: room.settings,
      token: joiningPlayer?.token,
    });
    if (room.players.length === room.settings.playerCount) {
      io.to(code).emit('room:full', {
        players: room.players.map(publicPlayer),
      });
    }
  });

  socket.on('room:start', ({ code }, cb) => {
    if (checkLobbyRateLimit(socket.id, cb)) {
      return;
    }
    const room = getRoom(code);
    if (!room) {
      return cb({ error: 'Room not found' });
    }
    const host = room.players.find((p) => p.isHost);
    if (!host || host.id !== socket.id) {
      return cb({ error: 'Only host can start' });
    }
    if (room.players.length < 2) {
      return cb({ error: 'Need at least 2 players' });
    }
    if (room.started) {
      return cb({ error: 'Already started' });
    }
    if (room.mode === 'qlashique') {
      return cb({ error: 'Qlashique rooms start via class selection' });
    }

    // Create game state first — only mark room as started if it succeeds
    let gameState;
    try {
      gameState = createGame(room.players, room.settings);
    } catch (err) {
      console.error(`[game] ${code} failed to create game:`, err.message);
      return cb({ error: 'Failed to start game' });
    }

    room.started = true;
    room.startedAt = Date.now();
    room.state = gameState;

    // Clean up any lingering quiz sessions for players starting a Weeqlash game
    for (const player of room.players) {
      quizRuns.delete(player.id);
    }

    console.log(
      `[game] ${code} started (${room.players.length}p, board ${room.settings.boardSize})`,
    );

    io.to(code).emit('game:start', {
      players: room.state.players,
      settings: room.settings,
      state: publicState(room.state),
    });
    cb({ ok: true });
  });

  // --- Reconnect ---

  socket.on('session:resume', ({ token, code }, cb) => {
    if (checkLobbyRateLimit(socket.id, cb)) {
      return;
    }
    const room = getRoom(code);
    if (!room || !room.started) {
      return cb({ error: 'Room not found or not started' });
    }
    const player = room.players.find((p) => p.token === token);
    if (!player) {
      return cb({ error: 'Invalid session token' });
    }

    // Clean up any lingering quiz session on reconnect
    quizRuns.delete(socket.id);

    const oldSocketId = player.id;
    player.id = socket.id; // re-attach new socket id
    reattachSocket(oldSocketId, socket.id, code);
    socket.join(code);
    console.log(`[reconnect] ${player.name} re-joined ${code}`);
    // Notify other players that someone reconnected
    socket.to(code).emit('room:player_reconnected', {
      players: room.players.map(publicPlayer),
    });
    if (room.mode === 'qlashique') {
      const qstate = room.state;
      const timerElapsed = room.qlasGuessingStartedAt
        ? Math.max(0, Math.floor((Date.now() - room.qlasGuessingStartedAt) / 1000))
        : 0;
      const reconnectData = {
        ok: true,
        mode: 'qlashique',
        playerId: socket.id,
        token: player.token,
        myIdx: player.index,
        code: room.code,
        classSelections: room.classSelections,
        players: room.players.map(publicPlayer),
        phase: qstate.phase,
        hp: [qstate.players[0].hp, qstate.players[1].hp],
        currentPlayerIdx: qstate.currentPlayerIdx,
        turnNumber: qstate.turnNumber,
        currentScore: qstate.currentScore,
        timerSeconds: room.qlasTimerSeconds || 5,
        timerElapsed,
      };
      if (
        qstate.phase === QLAS_PHASE.GUESSING &&
        player.index === qstate.currentPlayerIdx &&
        room.currentQuestion
      ) {
        const q = room.currentQuestion;
        reconnectData.currentQuestion = {
          id: q.id,
          q: q.q,
          opts: q.opts,
          category: q.category,
        };
      }
      return cb(reconnectData);
    }

    cb({
      ok: true,
      playerId: socket.id,
      state: publicState(room.state),
      players: room.players.map(publicPlayer),
    });
  });

  // --- Game actions ---

  socket.on('action:select_peg', ({ code, pegId }, cb) => {
    const room = getRoom(code);
    if (!room?.state) {
      return cb({ error: 'No active game' });
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      return cb({ error: 'Not in this room' });
    }

    const pegResult = selectPeg(room.state, player.index, pegId);
    if (pegResult.error) {
      return cb(pegResult);
    }

    cb({ ok: true, validMoves: pegResult.validMoves });
  });

  socket.on('action:select_tile', ({ code, pegId, r, c }, cb) => {
    const room = getRoom(code);
    if (!room?.state) {
      return cb({ error: 'No active game' });
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      return cb({ error: 'Not in this room' });
    }
    if (room.state.currentPlayerIdx !== player.index) {
      return cb({ error: 'Not your turn' });
    }
    if (pegId !== room.state.selectedPegId) {
      return cb({ error: 'Peg not selected' });
    }

    const validMoves = getValidMoves(room.state, pegId).map((m) => m.r * COORD_BASE + m.c);
    if (!validMoves.includes(r * COORD_BASE + c)) {
      return cb({ error: 'Invalid move target' });
    }

    const { moveType, questionId } = planTurnQuestions(room.state, pegId, r, c, questionsDb);

    const q = questionsDb._byId?.[questionId];
    const question = q
      ? {
          id: q.id,
          q: q.q,
          opts: q.opts,
          category: q.category,
          correctIdx: q.a,
        }
      : null;

    const gamePlayer = room.state.players[player.index];
    const defPegId = room.state.board[r]?.[c]?.pegId;
    const defenderPlayerIdx =
      moveType === 'combat' && defPegId !== null
        ? (room.state.pegs[defPegId]?.playerId ?? null)
        : null;
    const { questionsTotal } = room.state.pendingTurn;

    const { correctIdx, ...questionPublic } = question ?? {};
    socket.to(code).emit('game:question_start', {
      playerIdx: player.index,
      playerColor: gamePlayer?.color,
      moveType,
      question: questionPublic,
      questionsTotal,
      defenderPlayerIdx,
    });

    room.lastQuestionStart = Date.now();
    cb({ ok: true, moveType, question, questionsTotal, defenderPlayerIdx });
  });

  socket.on('turn:answer_preview', ({ code, answerIdx }, cb) => {
    const room = getRoom(code);
    if (!room?.state) {
      return cb?.({ error: 'No active game' });
    }
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || room.state.currentPlayerIdx !== player.index) {
      return cb?.({ error: 'Not your turn' });
    }
    if (typeof answerIdx !== 'number' || answerIdx < 0 || answerIdx > 3) {
      return cb?.({ error: 'Invalid answer index' });
    }

    const now = Date.now();
    const lastPreview = previewTimestamps.get(socket.id) || 0;
    if (now - lastPreview < PREVIEW_RATE_LIMIT_MS) {
      return cb?.({ error: 'Too fast' });
    }
    previewTimestamps.set(socket.id, now);

    const pending = room.state.pendingTurn;
    const qId = pending?.questionId;
    const isCorrect = qId ? questionsDb._byId?.[qId]?.a === answerIdx : null;
    if (isCorrect) {
      socket.to(code).emit('game:answer_preview', { answerIdx, correct: true });
    } else {
      socket.to(code).emit('game:answer_preview', { answerIdx });
    }
    cb?.({ ok: true });
  });

  socket.on('turn:submit', ({ code, submission }, cb) => {
    const room = getRoom(code);
    if (!room?.state) {
      return cb({ error: 'No active game' });
    }
    if (room.state.phase === PHASE.GAME_OVER) {
      return cb({ error: 'Game over' });
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      return cb({ error: 'Not in this room' });
    }

    const timeSinceQuestionStart = Date.now() - (room.lastQuestionStart || 0);
    if (timeSinceQuestionStart < MIN_ANSWER_DELAY_MS) {
      return cb({
        error: 'Answering too quickly. Wait for other players to see the question.',
      });
    }
    if (timeSinceQuestionStart > MAX_ANSWER_TIME_MS) {
      return cb({ error: 'Answer expired. Time ran out.' });
    }

    const now = Date.now();
    const lastAnswer = answerTimestamps.get(socket.id) || 0;
    if (now - lastAnswer < RATE_LIMIT_MS) {
      return cb({ error: 'Too many requests. Please slow down.' });
    }
    answerTimestamps.set(socket.id, now);

    const pending = room.state.pendingTurn;
    if (!pending) {
      return cb({ error: 'No pending turn' });
    }
    if (room.state.currentPlayerIdx !== player.index) {
      return cb({ error: 'Not your turn' });
    }

    if (
      typeof submission.answerIdx !== 'number' ||
      submission.answerIdx < -1 ||
      submission.answerIdx > 3
    ) {
      return cb({ error: 'Invalid answer index' });
    }

    const result = applyTurn(room.state, player.index, submission, questionsDb);
    if (result.error) {
      return cb(result);
    }

    // If combat/flag continues: advance to next question, notify attacker and spectators
    if (result.combatContinues) {
      const nextId = advancePendingQuestion(room.state, questionsDb);
      const nq = questionsDb._byId?.[nextId];
      const nextQuestion = nq
        ? {
            id: nq.id,
            q: nq.q,
            opts: nq.opts,
            category: nq.category,
            correctIdx: nq.a,
          }
        : null;
      const { correctIdx, ...nextPublic } = nextQuestion ?? {};
      const qIdx = pending.questionsTotal - room.state.pendingTurn.questionsRemaining + 1;

      room.lastQuestionStart = Date.now();

      socket.emit('game:next_question', {
        question: nextQuestion,
        questionIdx: qIdx,
        correct: result.correct,
      });
      socket.to(code).emit('game:next_question', {
        question: nextPublic,
        questionIdx: qIdx,
        correct: result.correct,
      });

      cb({ ok: true });
      return;
    }

    // Turn ended — broadcast final state
    const nextValidMoves =
      room.state.phase === PHASE.SELECT_TILE && room.state.selectedPegId
        ? getValidMoves(room.state, room.state.selectedPegId).map((m) => m.r * COORD_BASE + m.c)
        : null;

    const payload = {
      events: result.events,
      state: publicState(room.state),
      gameOver: result.gameOver,
      winner: result.winner ?? null,
      correct: result.correct,
      validMoves: nextValidMoves,
    };

    io.to(code).emit('state:update', payload);
    cb({ ok: true });

    if (result.gameOver) {
      console.log(`[game] ${code} over — winner player ${result.winner}`);
      recordGameStats(getRoom(code));
    }
  });

  // --- Quiz ---

  socket.on('quiz:start', (cb) => {
    // Rate limit: one quiz start per 2 seconds
    const now = Date.now();
    const lastQuiz = quizTimestamps.get(socket.id) || 0;
    if (now - lastQuiz < QUIZ_RATE_LIMIT_MS) {
      return cb({ error: 'Please wait before starting another quiz.' });
    }
    quizTimestamps.set(socket.id, now);

    // Prevent starting quiz while in an active Weeqlash game
    if (isInActiveGame(socket.id)) {
      return cb({ error: 'Cannot play quiz during an active game.' });
    }

    const allQuestions = getAllQuestions(questionsDb);

    if (allQuestions.length === 0) {
      return cb({ error: 'No questions available' });
    }

    const randomQ = allQuestions[Math.floor(Math.random() * allQuestions.length)];
    const run = {
      startedAt: Date.now(),
      questionIds: [randomQ.id],
      answers: 0,
    };
    quizRuns.set(socket.id, run);

    cb({
      ok: true,
      questionIds: [randomQ.id],
      id: randomQ.id,
      q: randomQ.q,
      opts: randomQ.opts,
      category: randomQ.category,
    });
  });

  socket.on('quiz:answer', ({ answerIdx }, cb) => {
    const run = quizRuns.get(socket.id);
    if (!run) {
      return cb({ error: 'Quiz not started' });
    }

    // Validate answer index: 0-3 valid choices, -1 means timeout (treated as wrong)
    if (typeof answerIdx !== 'number' || answerIdx < -1 || answerIdx > 3) {
      return cb({ error: 'Invalid answer index' });
    }

    const qId = run.questionIds[run.answers];
    const q = questionsDb._byId[qId];
    if (!q) {
      return cb({ error: 'Question not found' });
    }

    const correct = q.a === answerIdx;

    if (!correct) {
      const timeSec = (Date.now() - run.startedAt) / 1000;
      const qualifies = checkQualifiesTop10(run.answers, Date.now() - run.startedAt);
      return cb({
        ok: true,
        correct: false,
        correctIdx: q.a,
        gameOver: true,
        answers: run.answers,
        timeSec: Math.round(timeSec * 10) / 10,
        qualifies,
      });
    }

    run.answers++;
    cb({
      ok: true,
      correct: true,
      correctIdx: q.a,
    });
  });

  socket.on('quiz:next', (cb) => {
    const run = quizRuns.get(socket.id);
    if (!run) {
      return cb({ error: 'Quiz not started' });
    }

    const allQuestions = getAllQuestions(questionsDb);
    if (allQuestions.length === 0) {
      return cb({ error: 'No questions available' });
    }
    const usedIds = new Set(run.questionIds);
    const availableQuestions = allQuestions.filter((q) => !usedIds.has(q.id));
    const pool = availableQuestions.length > 0 ? availableQuestions : allQuestions;
    const randomQ = pool[Math.floor(Math.random() * pool.length)];

    run.questionIds.push(randomQ.id);

    cb({
      ok: true,
      id: randomQ.id,
      q: randomQ.q,
      opts: randomQ.opts,
      category: randomQ.category,
    });
  });

  socket.on('quiz:submit_score', ({ name }, cb) => {
    const run = quizRuns.get(socket.id);
    if (!run) {
      return cb({ error: 'No completed run' });
    }

    // Validate name: 1-16 characters, trimmed
    const sanitizedName = name?.trim();
    if (!sanitizedName || sanitizedName.length > 16) {
      return cb({ error: 'Name must be 1-16 characters' });
    }

    const timeMs = Date.now() - run.startedAt;
    const top10 = insertScore(sanitizedName, run.answers, timeMs);
    quizRuns.delete(socket.id);

    cb({ ok: true, top10 });
  });

  socket.on('quiz:leaderboard', (cb) => {
    cb({ ok: true, top10: getTop10() });
  });

  // --- Dev quickstart (non-production only) ---

  if (process.env.NODE_ENV !== 'production') {
    socket.on('dev:quickstart', ({ boardSize = 4 } = {}, cb) => {
      const colors = ['#e53935', '#1565c0'];
      const room = createRoom({ playerCount: 2, boardSize, timer: 30 });
      const fakePlayers = [
        {
          id: socket.id,
          name: 'Dev Player',
          color: colors[0],
          isHost: true,
          index: 0,
          token: null,
          userId: null,
        },
        {
          id: 'bot-dev',
          name: 'Bot',
          color: colors[1],
          isHost: false,
          index: 1,
          token: null,
          userId: null,
        },
      ];
      room.players = fakePlayers;
      socketToRoom.set(socket.id, room.code);
      socket.join(room.code);

      let gameState;
      try {
        gameState = createGame(fakePlayers, room.settings);
      } catch (err) {
        return cb({ error: err.message });
      }
      room.started = true;
      room.startedAt = Date.now();
      room.state = gameState;

      socket.emit('game:start', {
        players: gameState.players,
        settings: room.settings,
        state: publicState(gameState),
      });
      cb({ ok: true, code: room.code, playerIndex: 0 });
    });
  }

  // --- Qlashique ---

  socket.on('qlashique:create_room', ({ playerName } = {}, cb) => {
    if (checkLobbyRateLimit(socket.id, cb)) {
      return;
    }
    quizRuns.delete(socket.id);
    const userId = socket.userId || socket.pendingUserId;
    const room = createQlasRoom();
    const player = joinRoom(room.code, socket.id, playerName, userId || null);
    if (player.error) {
      return cb(player);
    }
    socket.join(room.code);
    const token = room.players.find((p) => p.id === socket.id)?.token;
    cb({
      ok: true,
      code: room.code,
      playerId: socket.id,
      players: room.players.map(publicPlayer),
      token,
    });
  });

  socket.on('qlashique:select_class', ({ code, classId } = {}, cb) => {
    const room = getRoom(code);
    if (!room || room.mode !== 'qlashique') {
      return cb({ error: 'Room not found' });
    }
    if (room.started) {
      return cb({ error: 'Game already started' });
    }
    if (!['slowpoke', 'reroll'].includes(classId)) {
      return cb({ error: 'Invalid class' });
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      return cb({ error: 'Not in this room' });
    }

    room.classSelections[player.index] = classId;
    io.to(code).emit('qlashique:class_selected', {
      playerIdx: player.index,
      classId,
    });
    cb({ ok: true });

    if (room.classSelections[0] && room.classSelections[1]) {
      room.started = true;
      room.startedAt = Date.now();
      room.state = createQlasGame(room.classSelections[0], room.classSelections[1]);
      room.qlasStats = [
        { answered: 0, correct: 0 },
        { answered: 0, correct: 0 },
      ];
      _emitQlasTurnStart(io, code, room);
    }
  });

  socket.on('qlashique:start_guessing', ({ code } = {}, cb) => {
    const room = getRoom(code);
    if (!room?.state || room.mode !== 'qlashique') {
      return cb({ error: 'No active game' });
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      return cb({ error: 'Not in this room' });
    }
    if (room.state.currentPlayerIdx !== player.index) {
      return cb({ error: 'Not your turn' });
    }
    if (room.state.phase !== QLAS_PHASE.DECISION) {
      return cb({ error: 'Not in decision phase' });
    }

    room.state.phase = QLAS_PHASE.GUESSING;
    room.questionIdx = 0;

    const q = _pickQlasQuestion(room, questionsDb);
    if (!q) {
      return cb({ error: 'No questions available' });
    }
    room.currentQuestion = q;

    socket.emit('qlashique:question', {
      question: { id: q.id, q: q.q, opts: q.opts, category: q.category },
      questionIdx: 0,
    });
    cb({ ok: true });

    // Server-side authoritative timer — fires if client never sends end_turn
    room.qlasGuessingStartedAt = Date.now();
    if (room.qlasTimer) {
      clearTimeout(room.qlasTimer);
    }
    const _gracedMs = ((room.qlasTimerSeconds || 5) + 3) * 1000;
    room.qlasTimerExpired = false;
    room.qlasTimer = setTimeout(() => {
      room.qlasTimer = null;
      if (!room.state || room.state.phase !== QLAS_PHASE.GUESSING) {
        return;
      }
      room.qlasTimerExpired = true;
      io.to(code).emit('qlashique:timer_expired');
    }, _gracedMs);
  });

  socket.on('qlashique:answer', ({ code, answerIdx } = {}, cb) => {
    const room = getRoom(code);
    if (!room?.state || room.mode !== 'qlashique') {
      return cb({ error: 'No active game' });
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      return cb({ error: 'Not in this room' });
    }
    if (room.state.currentPlayerIdx !== player.index) {
      return cb({ error: 'Not your turn' });
    }
    if (room.state.phase !== QLAS_PHASE.GUESSING) {
      return cb({ error: 'Not in guessing phase' });
    }
    if (typeof answerIdx !== 'number' || answerIdx < 0 || answerIdx > 3) {
      return cb({ error: 'Invalid answer' });
    }
    if (!room.currentQuestion) {
      return cb({ error: 'No active question' });
    }

    const result = processAnswer(room.state, answerIdx, room.currentQuestion.a);
    if (result.error) {
      return cb(result);
    }

    if (player.userId) {
      trackAnswer(player.userId, 'qlashique', result.correct);
    }
    if (room.qlasStats) {
      room.qlasStats[player.index].answered++;
      if (result.correct) room.qlasStats[player.index].correct++;
    }

    socket.emit('qlashique:answer_result', {
      correct: result.correct,
      newScore: room.state.currentScore,
      playerIdx: player.index,
    });

    if (checkInstantWin(room.state)) {
      room.state.phase = QLAS_PHASE.GAME_OVER;
      _saveQlasResult(room, player.index);
      io.to(code).emit('qlashique:game_over', {
        winnerIdx: player.index,
        reason: 'instant_win',
      });
      return cb({ ok: true });
    }

    room.questionIdx++;
    if (!room.qlasTimerExpired) {
      const nextQ = _pickQlasQuestion(room, questionsDb);
      if (nextQ) {
        room.currentQuestion = nextQ;
        socket.emit('qlashique:question', {
          question: {
            id: nextQ.id,
            q: nextQ.q,
            opts: nextQ.opts,
            category: nextQ.category,
          },
          questionIdx: room.questionIdx,
        });
      }
    }

    cb({ ok: true });
  });

  socket.on('qlashique:reroll', ({ code } = {}, cb) => {
    const room = getRoom(code);
    if (!room?.state || room.mode !== 'qlashique') {
      return cb({ error: 'No active game' });
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      return cb({ error: 'Not in this room' });
    }
    if (room.state.currentPlayerIdx !== player.index) {
      return cb({ error: 'Not your turn' });
    }

    const result = processReroll(room.state);
    if (result.error) {
      return cb(result);
    }

    const newQ = _pickQlasQuestion(room, questionsDb);
    if (!newQ) {
      return cb({ error: 'No questions available' });
    }
    room.currentQuestion = newQ;

    socket.emit('qlashique:rerolled', {
      newQuestion: {
        id: newQ.id,
        q: newQ.q,
        opts: newQ.opts,
        category: newQ.category,
      },
    });
    cb({ ok: true });
  });

  socket.on('qlashique:stop_attack', ({ code } = {}, cb) => {
    const room = getRoom(code);
    if (!room?.state || room.mode !== 'qlashique') {
      return cb({ error: 'No active game' });
    }
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      return cb({ error: 'Not in this room' });
    }
    if (room.state.currentPlayerIdx !== player.index) {
      return cb({ error: 'Not your turn' });
    }
    if (room.state.phase !== QLAS_PHASE.GUESSING) {
      return cb({ error: 'Not in guessing phase' });
    }
    if (room.qlasTimer) {
      clearTimeout(room.qlasTimer);
      room.qlasTimer = null;
    }
    room.qlasTimerExpired = true;
    socket.emit('qlashique:attack_stopped', { score: room.state.currentScore });
    cb({ ok: true });
  });

  socket.on('qlashique:end_turn', ({ code, choice = 'attack' } = {}, cb) => {
    console.log('[qlashique:end_turn] code:', code, 'socket.id:', socket.id);
    const room = getRoom(code);
    if (!room?.state || room.mode !== 'qlashique') {
      return cb({ error: 'No active game' });
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      return cb({ error: 'Not in this room' });
    }
    if (room.state.currentPlayerIdx !== player.index) {
      return cb({ error: 'Not your turn' });
    }

    if (room.qlasTimer) {
      clearTimeout(room.qlasTimer);
      room.qlasTimer = null;
    }

    const scoreBeforeEnd = room.state.currentScore;
    const { outcome, error } = endTurn(room.state);
    if (error) {
      return cb({ error });
    }

    let finalOutcome = outcome;
    if (outcome === 'choose') {
      const safeChoice = choice === 'heal' ? 'heal' : 'attack';
      const result = applyOutcome(room.state, safeChoice);
      if (result.error) {
        return cb(result);
      }
      finalOutcome = safeChoice;
    }

    io.to(code).emit('qlashique:turn_end', {
      score: scoreBeforeEnd,
      outcome: finalOutcome,
    });
    io.to(code).emit('qlashique:hp_update', {
      p0hp: room.state.players[0].hp,
      p1hp: room.state.players[1].hp,
    });

    const winnerIdx = checkGameOver(room.state);
    if (winnerIdx >= 0 && winnerIdx < 2) {
      room.state.phase = QLAS_PHASE.GAME_OVER;
      _saveQlasResult(room, winnerIdx);
      io.to(code).emit('qlashique:game_over', { winnerIdx, reason: 'hp' });
      return cb({ ok: true });
    }

    _emitQlasTurnStart(io, code, room);
    cb({ ok: true });
  });

  // --- Disconnect ---

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id}`);
    quizRuns.delete(socket.id);
    const { room, player } = removePlayerFromRoom(socket.id);
    if (room && player) {
      // If game was in progress, notify remaining players and end the game
      if (room.started && room.state) {
        const alreadyOver =
          room.mode === 'qlashique'
            ? room.state.phase === QLAS_PHASE.GAME_OVER
            : room.state.phase === PHASE.GAME_OVER;
        if (alreadyOver) {
          console.log(`[game] ${room.code} ended (already over)`);
          return;
        }
        io.to(room.code).emit('game:player_disconnected', {
          playerId: socket.id,
          playerName: player.name,
        });
        if (room.players.length === 1) {
          const winner = room.players[0];
          if (room.mode === 'qlashique') {
            room.state.phase = QLAS_PHASE.GAME_OVER;
            io.to(room.code).emit('qlashique:game_over', {
              winnerIdx: winner.index,
              reason: 'disconnect',
            });
          } else {
            room.state.phase = PHASE.GAME_OVER;
            room.state.winner = winner.index;
            io.to(room.code).emit('state:update', {
              events: [{ type: 'player_disconnected', playerId: socket.id }],
              state: publicState(room.state),
              gameOver: true,
              winner: winner.index,
            });
          }
          console.log(
            `[game] ${room.code} ended — ${player.name} disconnected, ${winner.name} wins`,
          );
        }
      } else {
        // Lobby: just broadcast player left
        io.to(room.code).emit('room:player_left', {
          playerId: socket.id,
          playerName: player.name,
          players: room.players.map(publicPlayer),
        });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Strip server-only fields (token, socket id) before broadcasting player list
function publicPlayer({ id: _id, token: _token, ...rest }) {
  return rest;
}

// Strip server-only fields before sending state to clients
function publicState(state) {
  return {
    boardSize: state.boardSize,
    board: state.board,
    pegs: state.pegs,
    players: state.players,
    numPlayers: state.numPlayers,
    currentPlayerIdx: state.currentPlayerIdx,
    phase: state.phase,
    selectedPegId: state.selectedPegId,
    winner: state.winner,
    movesRemaining: state.movesRemaining,
  };
}

// Record game result to database (only for regular game ends, not disconnects)
function recordGameStats(room) {
  console.log('[stats] recordGameStats called', {
    startedAt: room?.startedAt,
    playersCount: room?.state?.players?.length,
    roomPlayers: room?.players?.map((p) => ({
      name: p.name,
      userId: p.userId,
    })),
    statePlayers: room?.state?.players?.map((p) => ({
      name: p.name,
      userId: p.userId,
    })),
  });

  if (!room.startedAt || !room.state?.players || room.state.players.length < 2) {
    console.log('[stats] Skipping - invalid game state');
    return; // Not a valid started game
  }

  const players = room.state.players;

  // Get userIds from room players (linked at join time)
  const player1UserId = room.players[0]?.userId;
  const player2UserId = room.players[1]?.userId;
  console.log('[stats] userIds:', player1UserId, player2UserId);

  // Determine winner index for stats updating (accessible to all sections)
  const winnerIdx = room.state.winner;
  const durationMs = Date.now() - room.startedAt;

  // If both have accounts, record full game history and update games played/won
  if (player1UserId && player2UserId) {
    let winnerId = null;
    if (winnerIdx !== null && winnerIdx < players.length) {
      winnerId = winnerIdx === 0 ? player1UserId : player2UserId;
    }

    const player1Stats = players[0]?.stats ?? { byCategory: {} };
    const player2Stats = players[1]?.stats ?? { byCategory: {} };

    try {
      insertGameResult({
        player1Id: player1UserId,
        player2Id: player2UserId,
        winnerId,
        gameMode: 'duel',
        boardSize: room.settings.boardSize,
        durationMs,
        player1Stats,
        player2Stats,
      });

      // Update games played and won for both players
      const db = getDb();
      if (db) {
        // Player 1: increment games played, and games won if they won
        db.prepare(
          `
          UPDATE users SET
          games_played = COALESCE(games_played, 0) + 1,
          games_won = COALESCE(games_won, 0) + ${winnerIdx === 0 ? 1 : 0}
          WHERE id = ?
        `,
        ).run(player1UserId);

        // Player 2: increment games played, and games won if they won
        db.prepare(
          `
          UPDATE users SET
          games_played = COALESCE(games_played, 0) + 1,
          games_won = COALESCE(games_won, 0) + ${winnerIdx === 1 ? 1 : 0}
          WHERE id = ?
        `,
        ).run(player2UserId);
      }

      const gameRoomCode = players[0].name + ' vs ' + players[1].name;
      const winnerStr = winnerId ? 'player' + (winnerIdx + 1) : 'draw';
      console.log(`[stats] Game recorded: ${gameRoomCode}, winner: ${winnerStr}`);
    } catch (err) {
      console.error('[stats] Failed to record game:', err.message);
    }
    return;
  }

  // If only one player has account, track their stats individually and update games played/won
  const player1Stats = players[0]?.stats?.byCategory ?? {};
  const player2Stats = players[1]?.stats?.byCategory ?? {};

  // Track player1's stats if they have an account
  if (player1UserId) {
    for (const [cat, stat] of Object.entries(player1Stats)) {
      if (stat.attempts > 0) {
        trackAnswer(player1UserId, cat, stat.correct);
      }
    }
    // Update games played and won for player 1
    const db = getDb();
    if (db) {
      db.prepare(
        `
        UPDATE users SET
        games_played = COALESCE(games_played, 0) + 1,
        games_won = COALESCE(games_won, 0) + ${winnerIdx === 0 ? 1 : 0}
        WHERE id = ?
      `,
      ).run(player1UserId);
    }
    console.log('[stats] Recorded player1 stats:', players[0].name);
  }

  // Track player2's stats if they have an account
  if (player2UserId) {
    for (const [cat, stat] of Object.entries(player2Stats)) {
      if (stat.attempts > 0) {
        trackAnswer(player2UserId, cat, stat.correct);
      }
    }
    // Update games played and won for player 2
    const db = getDb();
    if (db) {
      db.prepare(
        `
        UPDATE users SET
        games_played = COALESCE(games_played, 0) + 1,
        games_won = COALESCE(games_won, 0) + ${winnerIdx === 1 ? 1 : 0}
        WHERE id = ?
      `,
      ).run(player2UserId);
    }
    console.log('[stats] Recorded player2 stats:', players[1].name);
  }
}

function _pickQlasQuestion(room, db) {
  const all = getAllQuestions(db);
  if (!all.length) {
    return null;
  }
  const available = all.filter((q) => !room.usedQIds.has(q.id));
  const pool = available.length > 0 ? available : all;
  const q = pool[Math.floor(Math.random() * pool.length)];
  room.usedQIds.add(q.id);
  return q;
}

function _saveQlasResult(room, winnerIdx) {
  const [p0, p1] = room.players;
  if (!p0?.userId && !p1?.userId) {
    return;
  }
  const durationMs = room.startedAt ? Date.now() - room.startedAt : null;
  const [s0, s1] = room.qlasStats ?? [{}, {}];
  try {
    insertGameResult({
      player1Id: p0?.userId ?? null,
      player2Id: p1?.userId ?? null,
      winnerId: winnerIdx === 0 ? (p0?.userId ?? null) : (p1?.userId ?? null),
      gameMode: 'qlashique',
      boardSize: null,
      durationMs,
      player1Stats: { ...s0, finalHp: room.state.players[0].hp, classId: room.classSelections[0] },
      player2Stats: { ...s1, finalHp: room.state.players[1].hp, classId: room.classSelections[1] },
    });
  } catch (e) {
    console.warn('[qlashique] Failed to save game result:', e.message);
  }
}

function _emitQlasTurnStart(ioServer, code, room) {
  const idx = room.state.currentPlayerIdx;
  const timerSeconds = calcTimer(room.state.turnNumber, room.classSelections[idx]);
  room.questionIdx = 0;
  room.qlasTimerSeconds = timerSeconds;
  room.qlasTimerExpired = false;
  ioServer.to(code).emit('qlashique:turn_start', {
    playerIdx: idx,
    timerSeconds,
    rerollAvailable: room.classSelections[idx] === 'reroll',
  });
}

httpServer.listen(PORT, () => console.log(`Weeqlash server :${PORT}`));
