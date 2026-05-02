import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Try __dirname first (Docker: files copied flat into /app), then parent (local dev: server/index.js)
const envPath = existsSync(path.join(__dirname, '.env'))
  ? path.join(__dirname, '.env')
  : existsSync(path.join(__dirname, '..', '.env'))
    ? path.join(__dirname, '..', '.env')
    : null;
if (envPath) {
  dotenv.config({ path: envPath, override: true });
}

import session from 'express-session';
import { RedisStore } from 'connect-redis';
import compression from 'compression';
import { initRedis, waitForRedisReady, isRedisReady, SESSION_PREFIX } from './game/redis.ts';

// Initialize Redis client after dotenv has loaded REDIS_URL. This must happen
// before createSessionMiddleware() runs (RedisStore captures the client instance).
const redisClient = initRedis();

import {
  createRoom,
  createQlasRoom,
  joinRoom,
  getRoom,
  removePlayerFromRoom,
  reattachSocket,
  cleanupStaleRooms,
  isInActiveGame,
  registerActiveSocket,
  unregisterActiveSocket,
  getPlayerBySocket,
} from './game/rooms.ts';
import {
  createGame,
  selectPeg,
  planTurnQuestions,
  advancePendingQuestion,
  applyTurn,
  getValidMoves,
  PHASE,
  COORD_BASE,
  CATS_SET,
  DEFAULT_CATS_SET,
} from './game/engine.ts';
import { loadQuestions, pickRandomQuestion } from './game/questions.ts';
import { QUIZ_MODES_BY_ID } from './game/quiz-modes.ts';
import * as skipnot from './game/skipnot.ts';
import {
  createQlasGame,
  calcTimer,
  processAnswer,
  endTurn,
  applyOutcome,
  checkInstantWin,
  checkGameOver,
  QLAS_DEFAULT_HP,
  PHASE as QLAS_PHASE,
} from './game/qlashique.ts';
import {
  initDb,
  getDb,
  getTop10ForMode,
  insertScoreForMode,
  checkQualifiesTop10ForMode,
  pruneAllModes,
  clearTestEntries,
} from './game/leaderboard.ts';
import {
  initAuthDb,
  insertGameResult,
  trackAnswer,
  trackAnswersBatch,
  createUser,
  clearTestUsers,
  clearTestHistory,
} from './game/auth.ts';
import { registerAuthRoutes } from './game/auth-routes.ts';
import adminRoutes from './routes/admin.js';
import { rooms, socketToRoom } from './game/rooms.ts';

const app = express();
app.set('trust proxy', 1);
const httpServer = createServer(app);

// =============================================================================
// SECURITY MIDDLEWARE
// =============================================================================

// CSP Headers - strict for game client, relaxed for AdminJS
const CSP_BASE =
  "default-src 'self'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' data:; " +
  "connect-src 'self' ws: wss: http://localhost:3000 https://brawl.weeqlash.icu; " +
  "frame-ancestors 'none'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self';";

const CSP_APP = CSP_BASE.replace(
  "default-src 'self'",
  "default-src 'self'; script-src 'self' http://localhost:3000",
);
const CSP_ADMIN = CSP_BASE.replace(
  "default-src 'self'",
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:3000",
);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

app.use((req, res, next) => {
  const csp = req.path.startsWith('/admin') ? CSP_ADMIN : CSP_APP;
  res.setHeader('Content-Security-Policy', csp);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(k, v);
  }
  next();
});

// Session store - Redis-backed. Fail-closed: if Redis is unreachable at
// startup, the server exits; if it dies at runtime, /auth and socket connects
// return 503 (see isRedisReady() gates below).
// DO NOT flip saveUninitialized to false without also reworking socket auth.
// The socket handshake captures socket.request.session at connection time —
// which for this client happens on page load, BEFORE login. If the initial GET
// creates no session/cookie, the socket binds to an ephemeral session whose ID
// never matches the one POST /auth/login later creates, and auth:setUserId's
// sess.reload() finds nothing. Net result: player.userId stays null, game
// stats (recordGameStats / _saveQlasResult) skip the DB writes, and e2e tests
// that assert games_played/games_won/trackAnswer coverage fail silently.
function createSessionMiddleware() {
  return session({
    store: new RedisStore({ client: redisClient, prefix: SESSION_PREFIX + 'session:' }),
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: 'auto',
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  });
}

// Initialize session middleware BEFORE static files
const sessionMiddleware = createSessionMiddleware();
app.use(sessionMiddleware);

// Force a session write on first request so the Set-Cookie lands before the
// Socket.IO handshake. Paired with saveUninitialized:true above — together
// they guarantee the socket and subsequent HTTP requests share one session ID.
// Do not remove this middleware; see note on createSessionMiddleware.
app.use((req, res, next) => {
  if (req.session && !req.session.visited) {
    req.session.visited = Date.now();
  }
  next();
});

// Gzip/br responses (index.html, styles.css, and any /api JSON)
app.use(compression());

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

// Debug mode - enables verbose socket/auth logging (default: false in production)
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV !== 'production';

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

// SkipNoT session tracking (singleplayer 20-Q quiz). One run per socket.
// run = {
//   startedAt: number,                          // ms; for leaderboard time_ms
//   questions: Question[],                      // pre-picked pool with correct-index `a`
//   picks: Record<questionId, optionIdx|null>,  // server-side answer log
//   finished: boolean,
//   finalScore, finalTimeMs                     // populated on skipnot:finish
// }
const skipnotRuns = new Map();

// Periodic cleanup of stale rate limit entries (every 30s)
const rateLimitMaps = [answerTimestamps, lobbyTimestamps, previewTimestamps, quizTimestamps];
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const map of rateLimitMaps) {
    for (const [socketId, time] of map) {
      if (now - time > 30_000) {
        map.delete(socketId);
      }
    }
  }
  for (const [socketId, run] of skipnotRuns) {
    if (now - run.startedAt > 10 * 60_000) {
      skipnotRuns.delete(socketId);
    }
  }
  for (const [socketId, run] of quizRuns) {
    if (now - run.startedAt > 10 * 60_000) {
      quizRuns.delete(socketId);
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
  pruneAllModes();
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
    redisClient.quit().finally(() => process.exit(0));
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

// Parse JSON bodies
app.use(express.json());

// Fail-closed gate: if Redis is not ready, auth/admin cannot read/write sessions.
// Applied before auth and admin routes so 503 lands on the HTTP boundary,
// not deep inside route handlers that would otherwise proceed with a broken session.
app.use(['/auth', '/admin'], (req, res, next) => {
  if (!isRedisReady()) {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }
  next();
});

registerAuthRoutes(app, io);
app.use('/admin', adminRoutes);

// Share session with Socket.IO
io.engine.use(sessionMiddleware);

// Fail-closed gate for socket connects. Same reasoning as the HTTP gate above:
// session middleware would otherwise silently hand out empty sessions.
io.use((socket, next) => {
  if (!isRedisReady()) {
    return next(new Error('Service temporarily unavailable'));
  }
  next();
});

// Test-only: teleport a peg to an adjacent position for E2E testing
// NEVER expose test endpoints in production - requires ENABLE_TEST_ROUTES=1
if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_TEST_ROUTES === '1') {
  // Inject a synthetic question with a known correct answer so tests can
  // assert answer-correct / answer-wrong UI behavior deterministically.
  const TEST_QUESTION = {
    id: 'TEST_Q_CORRECT_A',
    a: 0,
    q: 'I am test question',
    opts: ['Correct', 'Wrong', 'Wrong', 'Wrong'],
    category: 'history',
  };
  // Keep it out of the category pool so planTurnQuestions never picks it
  // randomly; it's only reachable via /test/set-question.
  questionsDb._byId[TEST_QUESTION.id] = TEST_QUESTION;

  // Clean up test entries from leaderboard (all modes; e2e_% name prefix)
  app.post('/test/clear-leaderboard', (_req, res) => {
    clearTestEntries();
    res.json({ ok: true });
  });

  // Test-only: clear ALL test data (leaderboard + users + history) in one call
  app.post('/test/clear-all', (_req, res) => {
    clearTestEntries();
    clearTestUsers();
    clearTestHistory();
    res.json({ ok: true });
  });

  // Test-only: auto-confirm registration for e2e tests
  app.post('/test/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    const result = await createUser({ username, email, password, autoConfirm: true });
    if (result.error) {
      return res.status(409).json({ error: result.error });
    }
    res.json({ ok: true });
  });

  // Test-only: create test users for e2e
  app.post('/test/setup-users', async (_req, res) => {
    const users = [
      { username: 'e2e_attacker', email: 'e2e_attacker@test.invalid' },
      { username: 'e2e_defender', email: 'e2e_defender@test.invalid' },
      { username: 'e2e_normal_p1', email: 'e2e_normal_p1@test.invalid' },
      { username: 'e2e_normal_p2', email: 'e2e_normal_p2@test.invalid' },
      { username: 'e2e_quiz_player', email: 'e2e_quiz_player@test.invalid' },
      { username: 'e2e_qlas_p1', email: 'e2e_qlas_p1@test.invalid' },
      { username: 'e2e_qlas_p2', email: 'e2e_qlas_p2@test.invalid' },
    ];
    for (const u of users) {
      await createUser({
        username: u.username,
        email: u.email,
        password: 'testpass123',
        autoConfirm: true,
      });
    }
    res.json({ ok: true, users: users.length });
  });

  // Test-only: lock next question to a specific qId so tests always know the correct answer.
  // Pass { sticky: true } to persist across picks; must be cleared via /test/clear-sticky-question.
  app.post('/test/set-question', (req, res) => {
    const { qId, sticky } = req.body;
    if (!qId) {
      return res.status(400).json({ error: 'Missing qId' });
    }
    if (sticky) {
      _testStickyQuestion = qId;
    } else {
      _testOverride = qId;
    }
    res.json({ ok: true, qId, sticky: !!sticky });
  });

  // Test-only: clear the sticky question override.
  app.post('/test/clear-sticky-question', (_req, res) => {
    _testStickyQuestion = null;
    res.json({ ok: true });
  });

  // Test-only: override HP for qlashique games (affects next createQlasGame call only)
  app.post('/test/set-hp', (req, res) => {
    const { hp } = req.body;
    if (!Number.isInteger(hp) || hp < 1) {
      return res.status(400).json({ error: 'hp must be a positive integer' });
    }
    _testHPOverride = hp;
    res.json({ ok: true, hp });
  });

  // Test-only: list first question from each category with correct answer index
  app.get('/test/questions-sample', (_req, res) => {
    const sample = Object.entries(questionsDb)
      .filter(([, qs]) => Array.isArray(qs) && qs.length > 0)
      .map(([category, qs]) => ({
        category,
        qId: qs[0].id,
        question: qs[0].q,
        correctIdx: qs[0].a,
        opts: qs[0].opts,
      }));
    res.json(sample);
  });

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
      state: publicState(room.state),
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

  // Test-only: get user stats by email
  app.get('/test/user-stats/:email', (req, res) => {
    const { email } = req.params;
    const db = getDb();
    if (!db) {
      return res.status(500).json({ error: 'DB not initialized' });
    }
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const stats = db.prepare('SELECT games_played, games_won FROM users WHERE id = ?').get(user.id);
    res.json({ email, ...stats });
  });

  // Test-only: get game history count
  app.get('/test/game-history/:email', (req, res) => {
    const { email } = req.params;
    const db = getDb();
    if (!db) {
      return res.status(500).json({ error: 'DB not initialized' });
    }
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const count = db
      .prepare('SELECT COUNT(*) as cnt FROM game_history WHERE player1_id = ? OR player2_id = ?')
      .get(user.id, user.id);
    res.json({ email, gamesPlayed: count.cnt });
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
  if (DEBUG) {
    console.log('[auth] socket session full:', JSON.stringify(socketSession));
  }
  if (socketSession?.userId) {
    socket.userId = socketSession.userId;
    socket.userName = socketSession.username;
    if (DEBUG) {
      console.log(
        `[auth] ${socket.id} linked to user ${socketSession.userId} (${socketSession.username})`,
      );
    }
  }

  // Client hint after login; authoritative userId always comes from the session.
  // The socket was usually established before login, so the snapshot on
  // socket.request.session is stale — reload from the store first.
  socket.on('auth:setUserId', (_clientUserId) => {
    const sess = socket.request.session;
    const applyUserId = (userId) => {
      socket.userId = userId;
      const code = socketToRoom.get(socket.id);
      if (code) {
        const room = rooms.get(code);
        const player = room ? getPlayerBySocket(room, socket.id) : null;
        if (player) {
          player.userId = userId;
        }
      } else {
        socket.pendingUserId = userId;
      }
    };

    const reload = typeof sess?.reload === 'function' ? sess.reload.bind(sess) : null;
    if (!reload) {
      if (sess?.userId) {
        applyUserId(sess.userId);
      } else if (DEBUG) {
        console.log('[auth] auth:setUserId rejected — no session available');
      }
      return;
    }

    reload((err) => {
      if (err) {
        if (DEBUG) {
          console.log('[auth] auth:setUserId reload error:', err.message);
        }
        return;
      }
      const sessionUserId = socket.request.session?.userId;
      if (!sessionUserId) {
        if (DEBUG) {
          console.log('[auth] auth:setUserId rejected — session has no userId after reload');
        }
        return;
      }
      applyUserId(sessionUserId);
    });
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
    if ('error' in player) {
      rooms.delete(room.code);
      return cb({ error: player.error || 'Failed to create room' });
    }
    socket.join(room.code);
    console.log(`[room] ${room.code} created by ${playerName}`);
    const token = getPlayerBySocket(room, socket.id)?.token;
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
    const joiningPlayer = getPlayerBySocket(room, socket.id);
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
      if (room.mode === 'qlashique' && !room.started) {
        _initQlasRoomState(room);
        _emitQlasTurnStart(io, code, room);
      }
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

    // Register all player sockets as in an active game
    for (const player of room.players) {
      registerActiveSocket(player.id);
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

    // Clean up any lingering quiz/skipnot session on reconnect
    quizRuns.delete(socket.id);
    _disposeSkipnotRun(socket.id);

    const oldSocketId = player.id;
    unregisterActiveSocket(oldSocketId);
    player.id = socket.id; // re-attach new socket id
    registerActiveSocket(socket.id);
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

    const player = getPlayerBySocket(room, socket.id);
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

    const player = getPlayerBySocket(room, socket.id);
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

    const planned = planTurnQuestions(room.state, pegId, r, c, questionsDb);
    const moveType = planned.moveType;
    let questionId = planned.questionId;

    // Test-only: swap planned question for the one locked via /test/set-question
    const overrideId = _consumeQuestionOverride(questionsDb);
    if (overrideId) {
      questionId = overrideId;
      if (room.state.pendingTurn) {
        room.state.pendingTurn.questionId = questionId;
      }
    }

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

  socket.on('turn:answer_preview', ({ code, questionIdx, answerIdx }, cb) => {
    const room = getRoom(code);
    if (!room?.state) {
      return cb?.({ error: 'No active game' });
    }
    const player = getPlayerBySocket(room, socket.id);
    if (!player || room.state.currentPlayerIdx !== player.index) {
      return cb?.({ error: 'Not your turn' });
    }
    if (typeof answerIdx !== 'number' || answerIdx < 0 || answerIdx > 3) {
      return cb?.({ error: 'Invalid answer index' });
    }
    if (typeof questionIdx !== 'number' || questionIdx < 0) {
      return cb?.({ error: 'Invalid question index' });
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
      socket.to(code).emit('game:answer_preview', { questionIdx, answerIdx, correct: true });
    } else {
      socket.to(code).emit('game:answer_preview', { questionIdx, answerIdx });
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

    const player = getPlayerBySocket(room, socket.id);
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

    if (!submission || typeof submission !== 'object') {
      return cb({ error: 'Invalid submission' });
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
      let nextId = advancePendingQuestion(room.state, questionsDb);
      const overrideNextId = _consumeQuestionOverride(questionsDb);
      if (overrideNextId) {
        nextId = overrideNextId;
        if (room.state.pendingTurn) {
          room.state.pendingTurn.questionId = nextId;
        }
      }
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
      console.log(`[game] ${code} over — winner player ${result.winner}, calling recordGameStats`);
      const roomForStats = getRoom(code);
      console.log('[game] roomForStats:', roomForStats ? 'found' : 'NOT FOUND');
      recordGameStats(roomForStats);
    }
  });

  // --- Quiz ---

  function getModeCats(mode) {
    const cfg = QUIZ_MODES_BY_ID[mode];
    return cfg?.categoriesSet ?? CATS_SET;
  }

  socket.on('quiz:start', ({ mode = 'triviandom' } = {}, cb) => {
    if (typeof cb !== 'function') {
      ((cb = mode), (mode = 'triviandom'));
    } // backward compat

    if (!QUIZ_MODES_BY_ID[mode]) {
      return cb({ error: `Unknown quiz mode: ${mode}` });
    }

    const now = Date.now();
    const lastQuiz = quizTimestamps.get(socket.id) || 0;
    if (now - lastQuiz < QUIZ_RATE_LIMIT_MS) {
      return cb({ error: 'Please wait before starting another quiz.' });
    }
    quizTimestamps.set(socket.id, now);

    if (isInActiveGame(socket.id)) {
      return cb({ error: 'Cannot play quiz during an active game.' });
    }

    let randomQ = pickRandomQuestion(questionsDb, getModeCats(mode));
    if (!randomQ) {
      return cb({ error: 'No questions available for this mode.' });
    }
    const quizOverrideId = _consumeQuestionOverride(questionsDb);
    if (quizOverrideId) {
      randomQ = questionsDb._byId[quizOverrideId];
    }
    quizRuns.set(socket.id, { startedAt: Date.now(), questionIds: [randomQ.id], answers: 0, mode });

    cb({ ok: true, id: randomQ.id, q: randomQ.q, opts: randomQ.opts, category: randomQ.category });
  });

  socket.on('quiz:answer', ({ answerIdx }, cb) => {
    const run = quizRuns.get(socket.id);
    if (!run) {
      return cb({ error: 'Quiz not started' });
    }

    if (typeof answerIdx !== 'number' || answerIdx < -1 || answerIdx > 3) {
      return cb({ error: 'Invalid answer index' });
    }

    const q = questionsDb._byId[run.questionIds[run.answers]];
    if (!q) {
      return cb({ error: 'Question not found' });
    }

    const correct = q.a === answerIdx;

    if (!correct) {
      run.gameOver = true;
      const timeSec = (Date.now() - run.startedAt) / 1000;
      const qualifies = checkQualifiesTop10ForMode(
        run.mode,
        run.answers,
        Date.now() - run.startedAt,
      );
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
    cb({ ok: true, correct: true });
  });

  socket.on('quiz:next', (cb) => {
    const run = quizRuns.get(socket.id);
    if (!run) {
      return cb({ error: 'Quiz not started' });
    }
    if (run.gameOver) {
      return cb({ error: 'Quiz already ended' });
    }

    const randomQ = pickRandomQuestion(
      questionsDb,
      getModeCats(run.mode),
      new Set(run.questionIds),
    );
    if (!randomQ) {
      return cb({ error: 'No questions available' });
    }

    run.questionIds.push(randomQ.id);
    cb({ ok: true, id: randomQ.id, q: randomQ.q, opts: randomQ.opts, category: randomQ.category });
  });

  socket.on('quiz:submit_score', ({ name }, cb) => {
    const run = quizRuns.get(socket.id);
    if (!run) {
      return cb({ error: 'No completed run' });
    }

    if (!run.gameOver) {
      return cb({ error: 'Quiz not finished' });
    }

    const sanitizedName = name?.trim();
    if (!sanitizedName || sanitizedName.length > 16) {
      return cb({ error: 'Name must be 1-16 characters' });
    }

    const timeMs = Date.now() - run.startedAt;
    const top10 = insertScoreForMode(run.mode, sanitizedName, run.answers, timeMs);
    quizRuns.delete(socket.id);

    cb({ ok: true, top10 });
  });

  socket.on('quiz:leaderboard', ({ mode = 'triviandom' } = {}, cb) => {
    if (typeof cb !== 'function') {
      ((cb = mode), (mode = 'triviandom'));
    } // backward compat
    cb({ ok: true, top10: getTop10ForMode(mode) });
  });

  // --- SkipNoT (solo 20-Q quiz) ---

  function _disposeSkipnotRun(socketId) {
    skipnotRuns.delete(socketId);
  }

  function _pickSkipnotPool() {
    // Test override (sticky/one-shot): fill the whole run with the locked
    // question so e2e specs can deterministically assert score totals.
    const overrideId = _consumeQuestionOverride(questionsDb);
    if (overrideId && questionsDb._byId?.[overrideId]) {
      const q = questionsDb._byId[overrideId];
      return Array.from({ length: skipnot.QUESTION_COUNT }, () => q);
    }
    const used = new Set();
    const out = [];
    for (let i = 0; i < skipnot.QUESTION_COUNT; i++) {
      const q = pickRandomQuestion(questionsDb, DEFAULT_CATS_SET, used);
      if (!q || used.has(q.id)) {
        return null;
      }
      used.add(q.id);
      out.push(q);
    }
    return out;
  }

  // Client-authoritative game flow (matches the board pattern). Server hands
  // out 20 questions WITH `correctIdx` at start, client runs the quiz locally
  // (own timer, own scoring per click), then submits all picks at finish.
  // Server stores its copy of the questions so it can re-score authoritatively
  // on submit and credit user_stats per category.
  socket.on('skipnot:start', (cb) => {
    if (typeof cb !== 'function') {
      return;
    }

    const now = Date.now();
    const lastQuiz = quizTimestamps.get(socket.id) || 0;
    if (now - lastQuiz < QUIZ_RATE_LIMIT_MS) {
      return cb({ error: 'Please wait before starting another quiz.' });
    }
    quizTimestamps.set(socket.id, now);

    if (isInActiveGame(socket.id)) {
      return cb({ error: 'Cannot play quiz during an active game.' });
    }

    const questions = _pickSkipnotPool();
    if (!questions) {
      return cb({ error: 'Not enough questions in active categories.' });
    }

    const run = {
      startedAt: now,
      questions, // server-side copy with correctIdx (`a`)
      // `picks` is an array aligned to `questions` (one slot per Q in order).
      // We can't key by questionId — sticky test overrides reuse the same id
      // across all 20 slots, which would collapse to a single pick.
      picks: new Array(skipnot.QUESTION_COUNT).fill(undefined),
      currentIdx: 0,
      finished: false,
      finalScore: 0,
      finalTimeMs: 0,
    };
    skipnotRuns.set(socket.id, run);

    // Server keeps correctIdx (`a`) hidden — client gets only public fields.
    // Per-question YES/NO feedback comes via `skipnot:answer` cb (boolean).
    cb({
      ok: true,
      total: skipnot.QUESTION_COUNT,
      timerMs: skipnot.TIMER_MS,
      questions: questions.map((q) => ({
        id: q.id,
        q: q.q,
        opts: q.opts,
        category: q.category,
      })),
    });
  });

  // Per-question answer check. Client emits with the question id and chosen
  // optionIdx; server matches it against the current run cursor, returns ONLY
  // a boolean correct. correctIdx never leaves the server.
  socket.on('skipnot:answer', ({ id, optionIdx } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const run = skipnotRuns.get(socket.id);
    if (!run || run.finished) {
      return cb({ error: 'SkipNoT not running' });
    }
    if (typeof optionIdx !== 'number' || optionIdx < 0 || optionIdx >= skipnot.OPTIONS_PER_Q) {
      return cb({ error: 'Invalid option index' });
    }
    if (run.currentIdx >= run.questions.length) {
      return cb({ error: 'Run exhausted' });
    }
    const currentQ = run.questions[run.currentIdx];
    if (currentQ.id !== id) {
      return cb({ error: 'Out of sequence' });
    }
    const correct = optionIdx === currentQ.a;
    run.picks[run.currentIdx] = optionIdx;
    run.currentIdx += 1;
    if (socket.userId) {
      try {
        trackAnswer(socket.userId, currentQ.category, correct);
      } catch (err) {
        console.error('[skipnot] trackAnswer failed:', err.message);
      }
    }
    cb({ ok: true, correct });
  });

  // Skip / timeout / abandon — same server effect: advance cursor, no score.
  // Client emits this on both the user's [SKIP] click and on the local timer
  // expiry, so the server cursor stays in lockstep with the client's.
  socket.on('skipnot:skip', ({ id } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const run = skipnotRuns.get(socket.id);
    if (!run || run.finished) {
      return cb({ error: 'SkipNoT not running' });
    }
    if (run.currentIdx >= run.questions.length) {
      return cb({ error: 'Run exhausted' });
    }
    const currentQ = run.questions[run.currentIdx];
    if (currentQ.id !== id) {
      return cb({ error: 'Out of sequence' });
    }
    run.picks[run.currentIdx] = null; // null = skipped/timed-out (no score change)
    run.currentIdx += 1;
    cb({ ok: true });
  });

  socket.on('skipnot:finish', ({ totalMs } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const run = skipnotRuns.get(socket.id);
    if (!run) {
      return cb({ error: 'SkipNoT not started' });
    }
    if (run.finished) {
      return cb({ error: 'Run already finished' });
    }
    // Build picks array from server-stored decisions (don't trust client to
    // resend them — server already recorded each one in run.picks at position
    // `currentIdx`). Missing slot = timeout/unanswered, scores like skip.
    const picks = run.picks.map((p) => (p === undefined ? null : p));
    // Sanity bound on totalMs: clamp into the plausible window so a tampered
    // client can't post a 1ms run or a 1-day run.
    const minMs = run.questions.length * 100;
    const maxMs = run.questions.length * (skipnot.TIMER_MS + 2000);
    const reportedMs =
      typeof totalMs === 'number' && totalMs >= 0 ? totalMs : Date.now() - run.startedAt;
    const elapsedMs = Math.min(Math.max(reportedMs, minMs), maxMs);

    const { score } = skipnot.scorePicks(run.questions, picks);
    run.finished = true;
    run.finalScore = score;
    run.finalTimeMs = elapsedMs;

    const qualifies = checkQualifiesTop10ForMode('skipnot', score, elapsedMs);
    cb({ ok: true, score, timeMs: elapsedMs, qualifies });
  });

  socket.on('skipnot:submit_score', ({ name } = {}, cb) => {
    const run = skipnotRuns.get(socket.id);
    if (!run) {
      return cb({ error: 'No completed run' });
    }
    if (!run.finished) {
      return cb({ error: 'Run not finished' });
    }
    const sanitizedName = name?.trim();
    if (!sanitizedName || sanitizedName.length > 16) {
      return cb({ error: 'Name must be 1-16 characters' });
    }
    const top10 = insertScoreForMode('skipnot', sanitizedName, run.finalScore, run.finalTimeMs);
    _disposeSkipnotRun(socket.id);
    cb({ ok: true, top10 });
  });

  socket.on('skipnot:leaderboard', (cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    cb({ ok: true, top10: getTop10ForMode('skipnot') });
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

      for (const p of room.players) {
        registerActiveSocket(p.id);
      }

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
    const token = getPlayerBySocket(room, socket.id)?.token;
    cb({
      ok: true,
      code: room.code,
      playerId: socket.id,
      players: room.players.map(publicPlayer),
      token,
    });
  });

  socket.on('qlashique:start_guessing', ({ code } = {}, cb) => {
    const room = getRoom(code);
    if (!room?.state || room.mode !== 'qlashique') {
      return cb({ error: 'No active game' });
    }

    const player = getPlayerBySocket(room, socket.id);
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

    io.to(code).emit('qlashique:question', {
      question: { id: q.id, q: q.q, opts: q.opts, category: q.category },
      questionIdx: 0,
      activePlayerIdx: room.state.currentPlayerIdx,
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

    const player = getPlayerBySocket(room, socket.id);
    if (!player) {
      return cb({ error: 'Not in this room' });
    }
    if (room.state.currentPlayerIdx !== player.index) {
      return cb({ error: 'Not your turn' });
    }
    if (room.state.phase !== QLAS_PHASE.GUESSING) {
      return cb({ error: 'Not in guessing phase' });
    }
    if (typeof answerIdx !== 'number' || answerIdx < -1 || answerIdx > 3) {
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
      try {
        trackAnswer(player.userId, 'qlashique', result.correct);
      } catch (err) {
        console.error('[qlas] trackAnswer failed:', err.message);
      }
    }
    if (room.qlasStats) {
      room.qlasStats[player.index].answered++;
      if (result.correct) {
        room.qlasStats[player.index].correct++;
      }
    }
    const cq = room.currentQuestion;
    if (room.qlasHistory) {
      room.qlasHistory.push({
        turn: room.state.turnNumber,
        playerIdx: player.index,
        questionId: cq.id,
        category: cq.category,
        q: cq.q,
        opts: cq.opts,
        answerIdx,
        correct: result.correct,
        scoreAfter: room.state.currentScore,
        p0hp: room.state.players[0].hp,
        p1hp: room.state.players[1].hp,
      });
    }

    const answerPayload = {
      correct: result.correct,
      newScore: room.state.currentScore,
      playerIdx: player.index,
      answerIdx,
      category: cq.category,
      q: cq.q,
      opts: cq.opts,
      turn: room.state.turnNumber,
    };
    io.to(code).emit('qlashique:answer_result', answerPayload);

    if (checkInstantWin(room.state)) {
      if (room.qlasTimer) {
        clearTimeout(room.qlasTimer);
        room.qlasTimer = null;
      }
      room.qlasTimerExpired = true;
      room.state.phase = QLAS_PHASE.GAME_OVER;
      _saveQlasResult(room, player.index);
      io.to(code).emit('qlashique:game_over', {
        winnerIdx: player.index,
        reason: 'instant_win',
        history: room.qlasHistory ?? [],
        stats: room.qlasStats ?? null,
      });
      return cb({ ok: true });
    }

    room.questionIdx++;
    if (!room.qlasTimerExpired) {
      const nextQ = _pickQlasQuestion(room, questionsDb);
      if (nextQ) {
        room.currentQuestion = nextQ;
        io.to(code).emit('qlashique:question', {
          question: {
            id: nextQ.id,
            q: nextQ.q,
            opts: nextQ.opts,
            category: nextQ.category,
          },
          questionIdx: room.questionIdx,
          activePlayerIdx: room.state.currentPlayerIdx,
        });
      }
    }

    cb({ ok: true });
  });

  socket.on('qlashique:stop_attack', ({ code } = {}, cb) => {
    const room = getRoom(code);
    if (!room?.state || room.mode !== 'qlashique') {
      return cb({ error: 'No active game' });
    }
    const player = getPlayerBySocket(room, socket.id);
    if (!player) {
      return cb({ error: 'Not in this room' });
    }
    if (room.state.currentPlayerIdx !== player.index) {
      return cb({ error: 'Not your turn' });
    }
    if (room.state.phase !== QLAS_PHASE.GUESSING) {
      return cb({ error: 'Not in guessing phase' });
    }
    if (room.qlasTimerExpired) {
      return cb({ ok: true });
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
    const room = getRoom(code);
    if (!room?.state || room.mode !== 'qlashique') {
      return cb({ error: 'No active game' });
    }

    const player = getPlayerBySocket(room, socket.id);
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
      io.to(code).emit('qlashique:game_over', {
        winnerIdx,
        reason: 'hp',
        history: room.qlasHistory ?? [],
        stats: room.qlasStats ?? null,
      });
      return cb({ ok: true });
    }

    _emitQlasTurnStart(io, code, room);
    cb({ ok: true });
  });

  // --- Disconnect ---

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id}`);
    quizRuns.delete(socket.id);
    _disposeSkipnotRun(socket.id);
    unregisterActiveSocket(socket.id);
    const { room, player } = removePlayerFromRoom(socket.id);
    if (room && player) {
      // If game was in progress, notify remaining players and end the game
      if (room.started && room.state) {
        const alreadyOver =
          room.mode === 'qlashique'
            ? room.state.phase === QLAS_PHASE.GAME_OVER
            : room.state.phase === PHASE.GAME_OVER;
        if (alreadyOver) {
          return;
        }
        io.to(room.code).emit('game:player_disconnected', {
          playerId: socket.id,
          playerName: player.name,
        });
        if (room.players.length === 1) {
          const winner = room.players[0];
          if (room.mode === 'qlashique') {
            if (room.qlasTimer) {
              clearTimeout(room.qlasTimer);
              room.qlasTimer = null;
            }
            room.qlasTimerExpired = true;
            room.state.phase = QLAS_PHASE.GAME_OVER;
            io.to(room.code).emit('qlashique:game_over', {
              winnerIdx: winner.index,
              reason: 'disconnect',
              history: room.qlasHistory ?? [],
              stats: room.qlasStats ?? null,
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
    turnNumber: state.turnNumber,
  };
}

let _updateGamesStmt = null;
function _getUpdateGamesStmt() {
  if (!_updateGamesStmt) {
    const db = getDb();
    if (!db) {
      return null;
    }
    _updateGamesStmt = db.prepare(
      `UPDATE users SET
        games_played = COALESCE(games_played, 0) + 1,
        games_won = COALESCE(games_won, 0) + ?
        WHERE id = ?`,
    );
  }
  return _updateGamesStmt;
}

function recordGameStats(room) {
  if (!room || !room.startedAt || !room.state?.players || room.state.players.length < 2) {
    return;
  }

  const players = room.state.players;
  const winnerIdx = room.state.winner;
  const durationMs = Date.now() - room.startedAt;
  const winnerUserId =
    winnerIdx !== null && winnerIdx < room.players.length
      ? (room.players[winnerIdx]?.userId ?? null)
      : null;

  const player1UserId = room.players[0]?.userId;
  const player2UserId = room.players[1]?.userId;

  try {
    if (player1UserId && player2UserId) {
      const player1Stats = players[0]?.stats ?? { byCategory: {} };
      const player2Stats = players[1]?.stats ?? { byCategory: {} };

      insertGameResult({
        player1Id: player1UserId,
        player2Id: player2UserId,
        winnerId: winnerUserId,
        gameMode: 'duel',
        boardSize: room.settings.boardSize,
        durationMs,
        player1Stats,
        player2Stats,
      });

      for (const [cat, stat] of Object.entries(player1Stats.byCategory ?? {})) {
        trackAnswersBatch(player1UserId, cat, stat.attempts ?? 0, stat.correct ?? 0);
      }
      for (const [cat, stat] of Object.entries(player2Stats.byCategory ?? {})) {
        trackAnswersBatch(player2UserId, cat, stat.attempts ?? 0, stat.correct ?? 0);
      }
    }

    const updateGames = _getUpdateGamesStmt();
    if (updateGames) {
      for (let i = 0; i < room.players.length; i++) {
        const uid = room.players[i]?.userId;
        if (uid) {
          updateGames.run(winnerIdx === i ? 1 : 0, uid);
        }
      }
    }
  } catch (err) {
    console.error('[stats] Failed to record game:', err.message);
  }
}

// Test override: set via POST /test/set-question
// _testOverride is one-shot (consumed on next question pick);
// _testStickyQuestion persists until /test/clear-sticky-question is called.
let _testOverride = null;
let _testStickyQuestion = null;
let _testHPOverride = null;

// Return a question id to use as the next override, or null.
// Prefers one-shot; consumes it on hit. Falls back to sticky (not consumed).
function _consumeQuestionOverride(db) {
  if (_testOverride && db._byId?.[_testOverride]) {
    const id = _testOverride;
    _testOverride = null;
    return id;
  }
  if (_testStickyQuestion && db._byId?.[_testStickyQuestion]) {
    return _testStickyQuestion;
  }
  return null;
}

// Categories to exclude from qlashique by default

function _pickQlasQuestion(room, db) {
  const overrideId = _consumeQuestionOverride(db);
  if (overrideId) {
    const q = db._byId[overrideId];
    if (q) {
      room.usedQIds.add(q.id);
      return q;
    }
  }
  const q = pickRandomQuestion(db, DEFAULT_CATS_SET, room.usedQIds);
  if (!q) {
    return null;
  }
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
      player1Stats: { ...s0, finalHp: room.state.players[0].hp },
      player2Stats: { ...s1, finalHp: room.state.players[1].hp },
    });

    const updateGames = _getUpdateGamesStmt();
    if (updateGames) {
      if (p0?.userId) {
        updateGames.run(winnerIdx === 0 ? 1 : 0, p0.userId);
      }
      if (p1?.userId) {
        updateGames.run(winnerIdx === 1 ? 1 : 0, p1.userId);
      }
    }
  } catch (e) {
    console.warn('[qlashique] Failed to save game result:', e.message);
  }
}

function _initQlasRoomState(room) {
  room.started = true;
  room.startedAt = Date.now();
  room.state = createQlasGame(_testHPOverride ?? QLAS_DEFAULT_HP);
  _testHPOverride = null;
  room.qlasStats = [
    { answered: 0, correct: 0 },
    { answered: 0, correct: 0 },
  ];
  room.qlasHistory = [];
  for (const p of room.players) {
    registerActiveSocket(p.id);
  }
}

function _emitQlasTurnStart(ioServer, code, room) {
  const idx = room.state.currentPlayerIdx;
  const timerSeconds = calcTimer(room.state.turnNumber);
  room.questionIdx = 0;
  room.qlasTimerSeconds = timerSeconds;
  room.qlasTimerExpired = false;
  ioServer.to(code).emit('qlashique:turn_start', {
    playerIdx: idx,
    timerSeconds,
  });
}

// Wait for Redis to be ready before accepting traffic — any request before
// this would be a cache miss into a broken session store.
waitForRedisReady(10_000)
  .then(() => {
    httpServer.listen(PORT, () => console.log(`Weeqlash server :${PORT}`));
  })
  .catch((err) => {
    console.error('[startup] Redis not ready:', err.message);
    process.exit(1);
  });

export { app };
