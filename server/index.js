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
  createQlashwordRoom,
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
import * as mathquiz from './game/mathquiz.ts';
import { generateSet as mathGenerateSet, toPublic as mathToPublic } from './game/mathgen.ts';
import * as centographer from './game/centographer.ts';
import * as howhigh from './game/howhigh.ts';
import {
  createChallenge,
  finishP1,
  joinChallenge,
  finishP2,
  getChallengeByCode,
  getChallengesForUser,
  getUsernameById,
  expireStale as expireHowHighStale,
} from './game/howhigh-store.ts';
import {
  createQlasGame,
  calcTimer,
  processAnswer,
  endTurn,
  applyOutcome,
  checkGameOver,
  QLAS_DEFAULT_HP,
  QLAS_HP_OPTIONS,
  PHASE as QLAS_PHASE,
} from './game/qlashique.ts';
import {
  createGame as createQlashwordGame,
  validatePlacement as qwValidatePlacement,
  collectWords as qwCollectWords,
  allWordsValid as qwAllWordsValid,
  planBonusQuestions as qwPlanBonusQuestions,
  applyTurn as qwApplyTurn,
  passTurn as qwPassTurn,
  swapTiles as qwSwapTiles,
  checkGameOver as qwCheckGameOver,
  finalScores as qwFinalScores,
  coordKey as qwCoordKey,
  PHASE as QW_PHASE,
} from './game/qlashword.ts';
import { getDictionary } from './game/qlashword-dict.ts';
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
import adminRoutes from './routes/admin.ts';
import { rooms, socketToRoom } from './game/rooms.ts';

const app = express();
app.set('trust proxy', 1);
const httpServer = createServer(app);

// =============================================================================
// SECURITY MIDDLEWARE
// =============================================================================

// CSP Headers - strict for game client, relaxed for AdminJS
const cspOrigin = process.env.CLIENT_URL || 'http://localhost:3000';
const CSP_BASE =
  "default-src 'self'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' data:; " +
  `connect-src 'self' ws: wss: ${cspOrigin}; ` +
  "frame-ancestors 'none'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self';";

const CSP_APP = CSP_BASE.replace(
  "default-src 'self'",
  `default-src 'self'; script-src 'self' ${cspOrigin}`,
);
const CSP_ADMIN = CSP_BASE.replace(
  "default-src 'self'",
  `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' ${cspOrigin}`,
);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
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
    secret:
      process.env.SESSION_SECRET ||
      (() => {
        throw new Error('SESSION_SECRET env var is required');
      })(),
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
  : ['https://brawl.weeqlash.icu'];
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
const howHighRuns = new Map();
const mathquizRuns = new Map();
const centographerRuns = new Map();

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
  for (const [socketId, run] of howHighRuns) {
    if (now - run.startedAt > 10 * 60_000) {
      howHighRuns.delete(socketId);
    }
  }
  for (const [socketId, run] of mathquizRuns) {
    if (now - run.startedAt > 10 * 60_000) {
      mathquizRuns.delete(socketId);
    }
  }
  for (const [socketId, run] of centographerRuns) {
    if (now - run.startedAt > 10 * 60_000) {
      centographerRuns.delete(socketId);
    }
  }
}, 30_000);
cleanupInterval.unref();

// Expire stale HowHigh challenges every 10 minutes (48h TTL)
const howHighExpireInterval = setInterval(() => {
  try {
    const n = expireHowHighStale(48 * 60 * 60_000);
    if (n > 0) {
      console.log(`[howhigh] expired ${n} stale challenges`);
    }
  } catch {
    /* DB may not be initialized yet */
  }
}, 10 * 60_000);
howHighExpireInterval.unref();

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
  clearInterval(howHighExpireInterval);
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

// Last-resort net: a malformed socket payload (e.g. a null arg where a handler
// destructures an object) throws inside socket.io's process.nextTick dispatch,
// which would otherwise terminate the whole process and kill every live game.
// Log and stay up instead of crashing.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// Load questions once at startup
const questionsDb = loadQuestions();
initDb();
initAuthDb();

// Parse JSON bodies
app.use(express.json({ limit: '1mb' }));

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

  app.post('/test/set-howhigh-bonus', (req, res) => {
    const { bonusQ3, bonusQ6 } = req.body;
    if (bonusQ3 && bonusQ3 !== 'dice' && bonusQ3 !== 'double_or_nothing') {
      return res.status(400).json({ error: 'bonusQ3 must be dice or double_or_nothing' });
    }
    if (bonusQ6 && bonusQ6 !== 'gowild' && bonusQ6 !== 'time_crunch') {
      return res.status(400).json({ error: 'bonusQ6 must be gowild or time_crunch' });
    }
    _testBonusQ3Override = bonusQ3 || null;
    _testBonusQ6Override = bonusQ6 || null;
    res.json({ ok: true, bonusQ3: _testBonusQ3Override, bonusQ6: _testBonusQ6Override });
  });

  // Test-only: force a Qlashword player's rack to a known set of tiles, then
  // re-send it to that player so the client renders the override.
  app.post('/test/qw-set-rack', (req, res) => {
    const { code, playerIdx, rack } = req.body;
    const room = getRoom(code);
    if (!room?.state || room.mode !== 'qlashword') {
      return res.status(404).json({ error: 'No active qlashword game' });
    }
    if (playerIdx !== 0 && playerIdx !== 1) {
      return res.status(400).json({ error: 'playerIdx must be 0 or 1' });
    }
    if (!Array.isArray(rack) || rack.some((t) => typeof t !== 'string')) {
      return res.status(400).json({ error: 'rack must be an array of letters' });
    }
    room.state.racks[playerIdx] = rack.slice();
    const pid = room.players[playerIdx]?.id;
    if (pid) {
      io.to(pid).emit('qlashword:rack', { rack: room.state.racks[playerIdx] });
    }
    res.json({ ok: true, rack: room.state.racks[playerIdx] });
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

  // Coerce null/undefined payload args to {} before they reach a handler's
  // destructure (only null/undefined throw on destructuring; primitives don't).
  // Defense-in-depth alongside the global uncaughtException net so a malformed
  // emit fails via each handler's own validation instead of crashing.
  socket.use((packet, next) => {
    for (let i = 1; i < packet.length; i++) {
      if (packet[i] === null || packet[i] === undefined) {
        packet[i] = {};
      }
    }
    next();
  });

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
  socket.on('auth:setUserId', (_clientUserId, cb) => {
    const ack = typeof cb === 'function' ? cb : () => {};
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
        ack({ ok: true });
      } else {
        if (DEBUG) {
          console.log('[auth] auth:setUserId rejected — no session available');
        }
        ack({ error: 'no session' });
      }
      return;
    }

    reload((err) => {
      if (err) {
        if (DEBUG) {
          console.log('[auth] auth:setUserId reload error:', err.message);
        }
        ack({ error: 'reload failed' });
        return;
      }
      const sessionUserId = socket.request.session?.userId;
      if (!sessionUserId) {
        if (DEBUG) {
          console.log('[auth] auth:setUserId rejected — session has no userId after reload');
        }
        ack({ error: 'no userId' });
        return;
      }
      applyUserId(sessionUserId);
      ack({ ok: true });
    });
  });

  // --- Lobby ---

  socket.on('room:create', ({ playerName, playerCount, boardSize, timer, enabledCats }, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    if (!socket.userId) {
      return cb({ error: 'Login required' });
    }
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
    if (typeof cb !== 'function') {
      return;
    }
    if (!socket.userId) {
      return cb({ error: 'Login required' });
    }
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
      qlasHP: room.qlasHP || undefined,
    });
    if (room.players.length === room.settings.playerCount) {
      io.to(code).emit('room:full', {
        players: room.players.map(publicPlayer),
        maxHp: room.qlasHP || undefined,
      });
      if (room.mode === 'qlashique' && !room.started) {
        _initQlasRoomState(room);
        _emitQlasTurnStart(io, code, room);
      }
    }
  });

  socket.on('room:start', ({ code }, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
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
    if (room.mode === 'qlashword') {
      if (room.players.length !== 2) {
        return cb({ error: 'Qlashword needs exactly 2 players' });
      }
      try {
        room.state = createQlashwordGame();
      } catch (err) {
        console.error(`[qlashword] ${code} failed to create game:`, err.message);
        return cb({ error: 'Failed to start game' });
      }
      room.started = true;
      room.startedAt = Date.now();
      room.qwTurn = null;
      room.qwUsedQIds = new Set();
      for (const player of room.players) {
        registerActiveSocket(player.id);
        quizRuns.delete(player.id);
      }
      console.log(`[qlashword] ${code} started (2p)`);
      _emitQwGameStart(io, code, room);
      return cb({ ok: true });
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
    if (typeof cb !== 'function') {
      return;
    }
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
    reattachSocket(oldSocketId, socket.id, code);
    registerActiveSocket(socket.id);
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
    if (typeof cb !== 'function') {
      return;
    }
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
    if (typeof cb !== 'function') {
      return;
    }
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
    if (typeof cb !== 'function') {
      return;
    }
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
      const qIdx = pending.questionsTotal - room.state.pendingTurn.questionsRemaining;

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
      for (const p of room.players) {
        unregisterActiveSocket(p.id);
      }
      recordGameStats(room);
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
    if (typeof cb !== 'function') {
      return;
    }
    if (!socket.userId) {
      return cb({ error: 'Login required' });
    }

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
    if (typeof cb !== 'function') {
      return;
    }
    const run = quizRuns.get(socket.id);
    if (!run) {
      return cb({ error: 'Quiz not started' });
    }
    if (run.gameOver) {
      return cb({ error: 'Quiz already ended' });
    }

    if (typeof answerIdx !== 'number' || answerIdx < -1 || answerIdx > 3) {
      return cb({ error: 'Invalid answer index' });
    }

    const q = questionsDb._byId[run.questionIds[run.answers]];
    if (!q) {
      return cb({ error: 'Question not found' });
    }

    const correct = answerIdx !== -1 && q.a === answerIdx;

    if (!correct) {
      run.gameOver = true;
      const endTime = Date.now();
      const timeSec = (endTime - run.startedAt) / 1000;
      const qualifies = checkQualifiesTop10ForMode(run.mode, run.answers, endTime - run.startedAt);
      const res = {
        ok: true,
        correct: false,
        gameOver: true,
        answers: run.answers,
        timeSec: Math.round(timeSec * 10) / 10,
        qualifies,
      };
      if (answerIdx !== -1) {
        res.correctIdx = q.a;
      }
      return cb(res);
    }

    run.answers++;
    cb({ ok: true, correct: true });
  });

  socket.on('quiz:next', (cb) => {
    if (typeof cb !== 'function') {
      return;
    }
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
    if (typeof cb !== 'function') {
      return;
    }
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
    if (typeof cb !== 'function') {
      return;
    }
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
    if (!socket.userId) {
      return cb({ error: 'Login required' });
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
    if (typeof cb !== 'function') {
      return;
    }
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

  // --- MathQuiz (solo numeric-input math/calculus quiz) ---
  //
  // Procedurally generated: no question bank. Server builds the problems with
  // their truth (answer/tol/range) kept server-side, hands the client only the
  // public fields (prompt/tex/graph/points). Client runs locally with its own
  // timer; on each answer the server scores via mathquiz.scorePick and returns
  // the OUTCOME (correct/partial/wrong) — never the true value mid-round. The
  // real answers are revealed only at finish for the review screen.
  socket.on('mathquiz:start', (cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    if (!socket.userId) {
      return cb({ error: 'Login required' });
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

    const problems = mathGenerateSet(mathquiz.QUESTION_COUNT);
    const run = {
      startedAt: now,
      problems, // server-side copy with answer/tol/range
      guesses: new Array(mathquiz.QUESTION_COUNT).fill(undefined),
      currentIdx: 0,
      finished: false,
      finalScore: 0,
      finalTimeMs: 0,
    };
    mathquizRuns.set(socket.id, run);

    cb({
      ok: true,
      total: mathquiz.QUESTION_COUNT,
      timerMs: mathquiz.TIMER_MS,
      problems: problems.map((p, i) => ({ index: i, ...mathToPublic(p) })),
    });
  });

  // Submit one numeric guess. value is a finite number; anything else scores 0.
  socket.on('mathquiz:answer', ({ index, value } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const run = mathquizRuns.get(socket.id);
    if (!run || run.finished) {
      return cb({ error: 'Math quiz not running' });
    }
    if (run.currentIdx >= run.problems.length) {
      return cb({ error: 'Run exhausted' });
    }
    if (index !== run.currentIdx) {
      return cb({ error: 'Out of sequence' });
    }
    const guess = typeof value === 'number' && Number.isFinite(value) ? value : null;
    const { earned, fraction, outcome, bonus } = mathquiz.scorePick(
      run.problems[run.currentIdx],
      guess,
    );
    run.guesses[run.currentIdx] = guess;
    run.currentIdx += 1;
    // outcome + points earned are feedback; the true answer is withheld until finish.
    cb({ ok: true, outcome, earned, fraction, bonus });
  });

  // Skip / timeout — record null, advance cursor, no score.
  socket.on('mathquiz:skip', ({ index } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const run = mathquizRuns.get(socket.id);
    if (!run || run.finished) {
      return cb({ error: 'Math quiz not running' });
    }
    if (run.currentIdx >= run.problems.length) {
      return cb({ error: 'Run exhausted' });
    }
    if (index !== run.currentIdx) {
      return cb({ error: 'Out of sequence' });
    }
    run.guesses[run.currentIdx] = null;
    run.currentIdx += 1;
    cb({ ok: true });
  });

  socket.on('mathquiz:finish', ({ totalMs } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const run = mathquizRuns.get(socket.id);
    if (!run) {
      return cb({ error: 'Math quiz not started' });
    }
    if (run.finished) {
      return cb({ error: 'Run already finished' });
    }
    const guesses = run.guesses.map((g) => (g === undefined ? null : g));
    const minMs = run.problems.length * 100;
    const maxMs = run.problems.length * (mathquiz.TIMER_MS + 2000);
    const reportedMs =
      typeof totalMs === 'number' && totalMs >= 0 ? totalMs : Date.now() - run.startedAt;
    const elapsedMs = Math.min(Math.max(reportedMs, minMs), maxMs);

    const { score, results, earned } = mathquiz.scorePicks(run.problems, guesses);
    run.finished = true;
    run.finalScore = score;
    run.finalTimeMs = elapsedMs;

    const qualifies = checkQualifiesTop10ForMode('mathquiz', score, elapsedMs);
    cb({
      ok: true,
      score,
      timeMs: elapsedMs,
      qualifies,
      // Review screen: per-question outcome + points only. The true answer is
      // NEVER sent — not mid-round, not post-round (user rule). Only the
      // player's own guess is echoed back.
      review: run.problems.map((p, i) => ({
        guess: guesses[i],
        earned: earned[i],
        outcome: results[i],
        points: p.points,
      })),
    });
  });

  socket.on('mathquiz:submit_score', ({ name } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const run = mathquizRuns.get(socket.id);
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
    const top10 = insertScoreForMode('mathquiz', sanitizedName, run.finalScore, run.finalTimeMs);
    mathquizRuns.delete(socket.id);
    cb({ ok: true, top10 });
  });

  // --- CentoGrapher (single-question geography "select all related") ---
  // One mega-question = whole quiz. Server builds the choice set (correct flags
  // secret), client selects, server scores. The true correct set is NEVER sent;
  // only the player's own picks get a verdict.
  socket.on('centographer:start', (cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    if (!socket.userId) {
      return cb({ error: 'Login required' });
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

    const country =
      centographer.COUNTRIES[Math.floor(Math.random() * centographer.COUNTRIES.length)];
    const choices = centographer.buildChoices(country);
    centographerRuns.set(socket.id, {
      startedAt: now,
      country,
      choices, // with secret correct flags
      finished: false,
      finalScore: 0,
      finalTimeMs: 0,
    });
    cb({
      ok: true,
      slug: country.slug,
      name: country.name,
      timerMs: centographer.TIMER_MS,
      total: centographer.CHOICE_COUNT,
      choices: choices.map((c) => ({ id: c.id, label: c.label })), // no `correct`
    });
  });

  socket.on('centographer:submit', ({ selected } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const run = centographerRuns.get(socket.id);
    if (!run) {
      return cb({ error: 'CentoGrapher not started' });
    }
    if (run.finished) {
      return cb({ error: 'Already submitted' });
    }
    const ids = Array.isArray(selected)
      ? selected.filter((s) => typeof s === 'string').slice(0, centographer.CHOICE_COUNT)
      : [];
    const { score, correctPicked, wrongPicked } = centographer.scoreCento(run.choices, ids);
    const totalCorrect = run.choices.filter((c) => c.correct).length;
    const missingCorrect = totalCorrect - correctPicked;
    run.finished = true;
    run.finalScore = score;
    run.finalTimeMs = Math.min(
      Math.max(Date.now() - run.startedAt, 0),
      centographer.TIMER_MS + 2000,
    );

    // verdict only for the player's own picks — true correct set stays hidden
    const sel = new Set(ids);
    const verdict = {};
    for (const c of run.choices) {
      if (sel.has(c.id)) {
        verdict[c.id] = c.correct;
      }
    }
    const qualifies = checkQualifiesTop10ForMode('centographer', score, run.finalTimeMs);
    cb({ ok: true, score, correctPicked, wrongPicked, missingCorrect, verdict, qualifies });
  });

  socket.on('centographer:submit_score', ({ name } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const run = centographerRuns.get(socket.id);
    if (!run || !run.finished) {
      return cb({ error: 'No completed run' });
    }
    const sanitizedName = name?.trim();
    if (!sanitizedName || sanitizedName.length > 16) {
      return cb({ error: 'Name must be 1-16 characters' });
    }
    const top10 = insertScoreForMode(
      'centographer',
      sanitizedName,
      run.finalScore,
      run.finalTimeMs,
    );
    centographerRuns.delete(socket.id);
    cb({ ok: true, top10 });
  });

  // --- HowHigh? (async 2P challenge) ---

  function _pickHowHighPool(count) {
    const overrideId = _consumeQuestionOverride(questionsDb);
    if (overrideId && questionsDb._byId?.[overrideId]) {
      const q = questionsDb._byId[overrideId];
      return Array.from({ length: count }, () => q);
    }
    const used = new Set();
    const out = [];
    for (let i = 0; i < count; i++) {
      const q = pickRandomQuestion(questionsDb, DEFAULT_CATS_SET, used);
      if (!q || used.has(q.id)) {
        return null;
      }
      used.add(q.id);
      out.push(q);
    }
    return out;
  }

  socket.on('howhigh:start', (cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    if (!socket.userId) {
      return cb({ error: 'Login required' });
    }

    const now = Date.now();
    const lastQuiz = quizTimestamps.get(socket.id) || 0;
    if (now - lastQuiz < QUIZ_RATE_LIMIT_MS) {
      return cb({ error: 'Please wait before starting another quiz.' });
    }
    quizTimestamps.set(socket.id, now);

    if (isInActiveGame(socket.id)) {
      return cb({ error: 'Cannot play while in an active game.' });
    }

    // Pick 12 questions (10 base + 2 GoWild extras)
    const allQuestions = _pickHowHighPool(howhigh.GOWILD_Q_COUNT);
    if (!allQuestions) {
      return cb({ error: 'Not enough questions in active categories.' });
    }

    const baseQuestions = allQuestions.slice(0, howhigh.BASE_Q_COUNT);
    const extraQuestions = allQuestions.slice(howhigh.BASE_Q_COUNT);
    const dice = {
      die1: Math.floor(Math.random() * 6) + 1,
      die2: Math.floor(Math.random() * 6) + 1,
    };

    const bonusQ3 = _testBonusQ3Override || howhigh.pickBonusQ3();
    const bonusQ6 = _testBonusQ6Override || howhigh.pickBonusQ6();

    let challengeCode;
    try {
      challengeCode = createChallenge(
        socket.userId,
        baseQuestions.map((q) => q.id),
        extraQuestions.map((q) => q.id),
        dice,
        bonusQ3,
        bonusQ6,
      );
    } catch (err) {
      console.error('[howhigh] createChallenge failed:', err.message);
      return cb({ error: 'Failed to create challenge' });
    }
    const run = {
      startedAt: now,
      challengeCode,
      questions: baseQuestions,
      extraQuestions,
      picks: new Array(howhigh.BASE_Q_COUNT).fill(undefined),
      currentIdx: 0,
      dice,
      diceAccepted: null,
      goWildAccepted: null,
      donAccepted: null,
      timeCrunchAccepted: null,
      bonusQ3,
      bonusQ6,
      totalQuestions: howhigh.BASE_Q_COUNT,
      timerMs: howhigh.BASE_TIMER_MS,
      finished: false,
      isPlayer2: false,
    };
    howHighRuns.set(socket.id, run);

    cb({
      ok: true,
      total: howhigh.BASE_Q_COUNT,
      timerMs: howhigh.BASE_TIMER_MS,
      dice,
      bonusQ3,
      bonusQ6,
      questions: baseQuestions.map((q) => ({
        id: q.id,
        q: q.q,
        opts: q.opts,
        category: q.category,
      })),
    });
  });

  socket.on('howhigh:answer', ({ id, optionIdx } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const run = howHighRuns.get(socket.id);
    if (!run || run.finished) {
      return cb({ error: 'HowHigh not running' });
    }
    if (typeof optionIdx !== 'number' || optionIdx < 0 || optionIdx >= howhigh.OPTIONS_PER_Q) {
      return cb({ error: 'Invalid option index' });
    }
    if (run.currentIdx >= run.totalQuestions) {
      return cb({ error: 'Run exhausted' });
    }

    const currentQ = run.questions[run.currentIdx];
    if (!currentQ || currentQ.id !== id) {
      return cb({ error: 'Out of sequence' });
    }

    const correct = optionIdx === currentQ.a;
    run.picks[run.currentIdx] = optionIdx;
    run.currentIdx += 1;

    if (socket.userId) {
      try {
        trackAnswer(socket.userId, currentQ.category, correct);
      } catch (err) {
        console.error('[howhigh] trackAnswer failed:', err.message);
      }
    }

    // Check for phase transitions and timer changes
    let nextEvent;
    let timerMs;
    if (run.currentIdx === howhigh.DICE_AFTER_Q) {
      if (run.bonusQ3 === 'dice' && run.diceAccepted === null) {
        nextEvent = 'dice_offer';
      } else if (run.bonusQ3 === 'double_or_nothing' && run.donAccepted === null) {
        nextEvent = 'don_offer';
      }
    } else if (run.currentIdx === howhigh.GOWILD_AFTER_Q) {
      if (run.bonusQ6 === 'gowild' && run.goWildAccepted === null) {
        nextEvent = 'gowild_offer';
      } else if (run.bonusQ6 === 'time_crunch' && run.timeCrunchAccepted === null) {
        nextEvent = 'time_crunch_offer';
      }
    }
    if (
      run.timeCrunchAccepted &&
      run.currentIdx === howhigh.GOWILD_AFTER_Q + howhigh.TIME_CRUNCH_Q_COUNT
    ) {
      run.timerMs = howhigh.BASE_TIMER_MS;
      timerMs = howhigh.BASE_TIMER_MS;
    }

    const resp = { ok: true, correct, nextEvent };
    if (timerMs) {
      resp.timerMs = timerMs;
    }
    cb(resp);
  });

  socket.on('howhigh:timeout', ({ id } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const run = howHighRuns.get(socket.id);
    if (!run || run.finished) {
      return cb({ error: 'HowHigh not running' });
    }
    if (run.currentIdx >= run.totalQuestions) {
      return cb({ error: 'Run exhausted' });
    }

    const currentQ = run.questions[run.currentIdx];
    if (!currentQ || currentQ.id !== id) {
      return cb({ error: 'Out of sequence' });
    }

    run.picks[run.currentIdx] = null;
    run.currentIdx += 1;

    let nextEvent;
    let timerMs;
    if (run.currentIdx === howhigh.DICE_AFTER_Q) {
      if (run.bonusQ3 === 'dice' && run.diceAccepted === null) {
        nextEvent = 'dice_offer';
      } else if (run.bonusQ3 === 'double_or_nothing' && run.donAccepted === null) {
        nextEvent = 'don_offer';
      }
    } else if (run.currentIdx === howhigh.GOWILD_AFTER_Q) {
      if (run.bonusQ6 === 'gowild' && run.goWildAccepted === null) {
        nextEvent = 'gowild_offer';
      } else if (run.bonusQ6 === 'time_crunch' && run.timeCrunchAccepted === null) {
        nextEvent = 'time_crunch_offer';
      }
    }
    if (
      run.timeCrunchAccepted &&
      run.currentIdx === howhigh.GOWILD_AFTER_Q + howhigh.TIME_CRUNCH_Q_COUNT
    ) {
      run.timerMs = howhigh.BASE_TIMER_MS;
      timerMs = howhigh.BASE_TIMER_MS;
    }

    const resp = { ok: true, nextEvent };
    if (timerMs) {
      resp.timerMs = timerMs;
    }
    cb(resp);
  });

  socket.on('howhigh:dice_respond', ({ accept } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const run = howHighRuns.get(socket.id);
    if (!run || run.finished) {
      return cb({ error: 'HowHigh not running' });
    }
    if (run.bonusQ3 !== 'dice') {
      return cb({ error: 'Dice not available this run' });
    }
    if (run.diceAccepted !== null) {
      return cb({ error: 'Dice already decided' });
    }
    if (run.currentIdx !== howhigh.DICE_AFTER_Q) {
      return cb({ error: 'Not at dice phase' });
    }

    run.diceAccepted = !!accept;
    cb({ ok: true, dice: run.dice, accepted: run.diceAccepted });
  });

  socket.on('howhigh:don_respond', ({ accept } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const run = howHighRuns.get(socket.id);
    if (!run || run.finished) {
      return cb({ error: 'HowHigh not running' });
    }
    if (run.bonusQ3 !== 'double_or_nothing') {
      return cb({ error: 'Double or Nothing not available this run' });
    }
    if (run.donAccepted !== null) {
      return cb({ error: 'DoN already decided' });
    }
    if (run.currentIdx !== howhigh.DON_AFTER_Q) {
      return cb({ error: 'Not at DoN phase' });
    }

    run.donAccepted = !!accept;
    cb({ ok: true, accepted: run.donAccepted });
  });

  socket.on('howhigh:gowild_respond', ({ accept } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const run = howHighRuns.get(socket.id);
    if (!run || run.finished) {
      return cb({ error: 'HowHigh not running' });
    }
    if (run.bonusQ6 !== 'gowild') {
      return cb({ error: 'GoWild not available this run' });
    }
    if (run.goWildAccepted !== null) {
      return cb({ error: 'GoWild already decided' });
    }
    if (run.currentIdx !== howhigh.GOWILD_AFTER_Q) {
      return cb({ error: 'Not at GoWild phase' });
    }

    run.goWildAccepted = !!accept;

    if (run.goWildAccepted) {
      run.totalQuestions = howhigh.GOWILD_Q_COUNT;
      run.timerMs = howhigh.GOWILD_TIMER_MS;
      run.questions.push(...run.extraQuestions);
      run.picks.push(...new Array(howhigh.GOWILD_Q_COUNT - howhigh.BASE_Q_COUNT).fill(undefined));
      cb({
        ok: true,
        accepted: true,
        timerMs: howhigh.GOWILD_TIMER_MS,
        totalQuestions: howhigh.GOWILD_Q_COUNT,
        extraQuestions: run.extraQuestions.map((q) => ({
          id: q.id,
          q: q.q,
          opts: q.opts,
          category: q.category,
        })),
      });
    } else {
      cb({ ok: true, accepted: false });
    }
  });

  socket.on('howhigh:time_crunch_respond', ({ accept } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const run = howHighRuns.get(socket.id);
    if (!run || run.finished) {
      return cb({ error: 'HowHigh not running' });
    }
    if (run.bonusQ6 !== 'time_crunch') {
      return cb({ error: 'Time Crunch not available this run' });
    }
    if (run.timeCrunchAccepted !== null) {
      return cb({ error: 'Time Crunch already decided' });
    }
    if (run.currentIdx !== howhigh.GOWILD_AFTER_Q) {
      return cb({ error: 'Not at Time Crunch phase' });
    }

    run.timeCrunchAccepted = !!accept;

    if (run.timeCrunchAccepted) {
      run.timerMs = howhigh.TIME_CRUNCH_TIMER_MS;
      cb({ ok: true, accepted: true, timerMs: howhigh.TIME_CRUNCH_TIMER_MS });
    } else {
      cb({ ok: true, accepted: false });
    }
  });

  socket.on('howhigh:finish', ({ totalMs } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const run = howHighRuns.get(socket.id);
    if (!run) {
      return cb({ error: 'HowHigh not started' });
    }
    if (run.finished) {
      return cb({ error: 'Run already finished' });
    }

    const picks = run.picks.map((p) => (p === undefined ? null : p));
    const minMs = run.totalQuestions * 100;
    const baseTimerMs = run.goWildAccepted ? howhigh.GOWILD_TIMER_MS : howhigh.BASE_TIMER_MS;
    const tcQs = run.timeCrunchAccepted ? howhigh.TIME_CRUNCH_Q_COUNT : 0;
    const maxMs =
      (run.totalQuestions - tcQs) * (baseTimerMs + 2000) +
      tcQs * (howhigh.TIME_CRUNCH_TIMER_MS + 2000);
    const reportedMs =
      typeof totalMs === 'number' && totalMs >= 0 ? totalMs : Date.now() - run.startedAt;
    const elapsedMs = Math.min(Math.max(reportedMs, minMs), maxMs);

    const { score } = howhigh.scorePicks(run.questions, picks, {
      dice: { die1: run.dice.die1, die2: run.dice.die2, accepted: !!run.diceAccepted },
      bonusQ3: run.bonusQ3,
      bonusQ6: run.bonusQ6,
      donAccepted: !!run.donAccepted,
      timeCrunchAccepted: !!run.timeCrunchAccepted,
    });
    try {
      run.finished = true;
      if (run.isPlayer2) {
        const challenge = finishP2(
          run.challengeCode,
          score,
          picks.map((p, i) =>
            p === null ? 'timeout' : p === run.questions[i]?.a ? 'correct' : 'wrong',
          ),
          !!run.diceAccepted,
          !!run.goWildAccepted,
          elapsedMs,
        );
        const p1Name = getUsernameById(challenge.player1_id) || 'Player 1';
        const p2Name = getUsernameById(challenge.player2_id) || 'Player 2';
        howHighRuns.delete(socket.id);
        // Also save to game_history
        try {
          insertGameResult({
            player1Id: challenge.player1_id,
            player2Id: challenge.player2_id,
            winnerId: challenge.winner_id,
            gameMode: 'howhigh',
            boardSize: null,
            durationMs: elapsedMs,
            player1Stats: {
              score: challenge.p1_score,
              diceAccepted: !!challenge.p1_dice_accepted,
              goWildAccepted: !!challenge.p1_gowild_accepted,
            },
            player2Stats: {
              score,
              diceAccepted: !!run.diceAccepted,
              goWildAccepted: !!run.goWildAccepted,
            },
          });
        } catch (err) {
          console.error('[howhigh] insertGameResult failed:', err.message);
        }
        cb({
          ok: true,
          score,
          challengeCode: run.challengeCode,
          result: {
            p1Score: challenge.p1_score,
            p2Score: score,
            p1Name,
            p2Name,
            youWon: challenge.winner_id === socket.userId,
          },
        });
      } else {
        finishP1(
          run.challengeCode,
          score,
          picks.map((p, i) =>
            p === null ? 'timeout' : p === run.questions[i]?.a ? 'correct' : 'wrong',
          ),
          !!run.diceAccepted,
          !!run.goWildAccepted,
          elapsedMs,
        );
        howHighRuns.delete(socket.id);
        cb({ ok: true, score, challengeCode: run.challengeCode });
      }
    } catch (err) {
      run.finished = false;
      console.error('[howhigh] finish failed:', err.message);
      cb({ error: 'Failed to save results' });
    }
  });

  socket.on('howhigh:join', ({ code } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    if (!socket.userId) {
      return cb({ error: 'Login required' });
    }
    if (!code || typeof code !== 'string') {
      return cb({ error: 'Invalid code' });
    }

    const now = Date.now();
    const lastQuiz = quizTimestamps.get(socket.id) || 0;
    if (now - lastQuiz < QUIZ_RATE_LIMIT_MS) {
      return cb({ error: 'Please wait before starting.' });
    }
    quizTimestamps.set(socket.id, now);

    if (isInActiveGame(socket.id)) {
      return cb({ error: 'Cannot play while in an active game.' });
    }

    let challenge;
    try {
      challenge = joinChallenge(code.toUpperCase().trim(), socket.userId);
    } catch (err) {
      return cb({ error: err.message });
    }

    let questionIds, extraQuestionIds;
    try {
      questionIds = JSON.parse(challenge.question_ids);
      extraQuestionIds = challenge.extra_question_ids
        ? JSON.parse(challenge.extra_question_ids)
        : [];
    } catch {
      return cb({ error: 'Invalid challenge data' });
    }

    // Resolve full question objects from the DB
    const baseQuestions = questionIds.map((qId) => questionsDb._byId?.[qId]).filter(Boolean);
    const extraQuestions = extraQuestionIds.map((qId) => questionsDb._byId?.[qId]).filter(Boolean);

    if (
      baseQuestions.length !== questionIds.length ||
      extraQuestions.length !== extraQuestionIds.length
    ) {
      return cb({ error: 'Some questions no longer available' });
    }

    const dice = { die1: challenge.dice_die1, die2: challenge.dice_die2 };
    const bonusQ3 = _testBonusQ3Override || challenge.bonus_q3 || howhigh.pickBonusQ3();
    const bonusQ6 = _testBonusQ6Override || challenge.bonus_q6 || howhigh.pickBonusQ6();

    const run = {
      startedAt: now,
      challengeCode: code.toUpperCase().trim(),
      questions: baseQuestions,
      extraQuestions,
      picks: new Array(howhigh.BASE_Q_COUNT).fill(undefined),
      currentIdx: 0,
      dice,
      diceAccepted: null,
      goWildAccepted: null,
      donAccepted: null,
      timeCrunchAccepted: null,
      bonusQ3,
      bonusQ6,
      totalQuestions: howhigh.BASE_Q_COUNT,
      timerMs: howhigh.BASE_TIMER_MS,
      finished: false,
      isPlayer2: true,
    };
    howHighRuns.set(socket.id, run);

    cb({
      ok: true,
      total: howhigh.BASE_Q_COUNT,
      timerMs: howhigh.BASE_TIMER_MS,
      dice,
      bonusQ3,
      bonusQ6,
      questions: baseQuestions.map((q) => ({
        id: q.id,
        q: q.q,
        opts: q.opts,
        category: q.category,
      })),
    });
  });

  socket.on('howhigh:my_challenges', (cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    if (!socket.userId) {
      return cb({ error: 'Login required' });
    }
    try {
      const challenges = getChallengesForUser(socket.userId);
      const mapped = challenges.map((c) => ({
        code: c.code,
        status: c.status,
        p1Name: getUsernameById(c.player1_id) || 'Unknown',
        p2Name: c.player2_id ? getUsernameById(c.player2_id) || 'Unknown' : null,
        p1Score: c.p1_score,
        p2Score: c.p2_score,
        youWon: c.winner_id === socket.userId,
        isP1: c.player1_id === socket.userId,
        createdAt: c.created_at,
        completedAt: c.completed_at,
      }));
      cb({ ok: true, challenges: mapped });
    } catch (err) {
      console.error('[howhigh] my_challenges failed:', err.message);
      cb({ error: 'Failed to load challenges' });
    }
  });

  socket.on('howhigh:challenge_result', ({ code } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    if (!socket.userId) {
      return cb({ error: 'Login required' });
    }
    if (!code) {
      return cb({ error: 'Missing code' });
    }

    const challenge = getChallengeByCode(code);
    if (!challenge) {
      return cb({ error: 'Challenge not found' });
    }
    if (challenge.player1_id !== socket.userId && challenge.player2_id !== socket.userId) {
      return cb({ error: 'Not your challenge' });
    }

    cb({
      ok: true,
      challenge: {
        code: challenge.code,
        status: challenge.status,
        p1Name: getUsernameById(challenge.player1_id) || 'Unknown',
        p2Name: challenge.player2_id ? getUsernameById(challenge.player2_id) || 'Unknown' : null,
        p1Score: challenge.p1_score,
        p2Score: challenge.p2_score,
        p1DiceAccepted: !!challenge.p1_dice_accepted,
        p2DiceAccepted: !!challenge.p2_dice_accepted,
        p1GoWildAccepted: !!challenge.p1_gowild_accepted,
        p2GoWildAccepted: !!challenge.p2_gowild_accepted,
        p1TimeMs: challenge.p1_time_ms,
        p2TimeMs: challenge.p2_time_ms,
        winnerId: challenge.winner_id,
        diceSum: challenge.dice_die1 + challenge.dice_die2,
        createdAt: challenge.created_at,
        completedAt: challenge.completed_at,
      },
    });
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
      room.playersBySocket = new Map(fakePlayers.map((p) => [p.id, p]));
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

  socket.on('qlashique:create_room', ({ playerName, hp } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    if (!socket.userId) {
      return cb({ error: 'Login required' });
    }
    if (checkLobbyRateLimit(socket.id, cb)) {
      return;
    }
    quizRuns.delete(socket.id);
    const userId = socket.userId || socket.pendingUserId;
    const room = createQlasRoom();
    room.qlasHP = QLAS_HP_OPTIONS.includes(hp) ? hp : QLAS_DEFAULT_HP;
    const player = joinRoom(room.code, socket.id, playerName, userId || null);
    if (player.error) {
      rooms.delete(room.code);
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
    if (typeof cb !== 'function') {
      return;
    }
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
      try {
        if (!room.state || room.state.phase !== QLAS_PHASE.GUESSING) {
          return;
        }
        room.qlasTimerExpired = true;
        io.to(code).emit('qlashique:timer_expired');
        // Force-end the turn so an AFK active player can't freeze the duel.
        // (The +3s grace is already baked into _gracedMs above.)
        _endQlasTurn(io, code, room, 'attack');
      } catch (err) {
        console.error('[qlashique] timer callback error:', err);
      }
    }, _gracedMs);
  });

  socket.on('qlashique:answer', ({ code, answerIdx } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
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
      return cb({ error: 'Turn time expired' });
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
    if (typeof cb !== 'function') {
      return;
    }
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
    if (typeof cb !== 'function') {
      return;
    }
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

    const result = _endQlasTurn(io, code, room, choice);
    if (result.error) {
      return cb(result);
    }
    cb({ ok: true });
  });

  // --- Qlashword ---

  socket.on('qlashword:create_room', ({ playerName } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    if (!socket.userId) {
      return cb({ error: 'Login required' });
    }
    if (checkLobbyRateLimit(socket.id, cb)) {
      return;
    }
    quizRuns.delete(socket.id);
    const userId = socket.userId || socket.pendingUserId;
    const room = createQlashwordRoom();
    const player = joinRoom(room.code, socket.id, playerName, userId || null);
    if (player.error) {
      rooms.delete(room.code);
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

  socket.on('qlashword:submit_turn', ({ code, placement } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const ctx = _qwTurnGuard(socket, code, cb, QW_PHASE.PLACE);
    if (!ctx) {
      return;
    }
    const { room, player } = ctx;

    const clean = _qwSanitizePlacement(placement);
    if (!clean) {
      return cb({ error: 'Invalid placement' });
    }

    const state = room.state;
    const geo = qwValidatePlacement(state.board, clean);
    if (!geo.ok) {
      return cb({ error: geo.error });
    }

    const words = qwCollectWords(state.board, clean, geo.orientation);
    if (words.length === 0) {
      return cb({ error: 'No word formed' });
    }

    const dict = getDictionary();
    if (!qwAllWordsValid(words, dict)) {
      const bad = words.find((w) => !dict.has(w.word.toUpperCase()));
      return cb({ error: `Not a word: ${bad ? bad.word : '?'}` });
    }

    // Rack coverage pre-check — bonus questions resolve before we mutate, so
    // verify the play is legal up front rather than failing after the quiz.
    if (!_qwRackCovers(state.racks[player.index], clean)) {
      return cb({ error: 'Placement uses tiles not on your rack' });
    }

    // One gated question per premium square the new tiles cover.
    const bonuses = qwPlanBonusQuestions(clean)
      .map((b) => {
        const q = _qwPickBonusQuestion(room);
        return q ? { ...b, questionId: q.id } : null;
      })
      .filter(Boolean);

    if (bonuses.length === 0) {
      const res = qwApplyTurn(state, player.index, clean, words, {});
      if (res.error) {
        return cb({ error: res.error });
      }
      cb({ ok: true, bonusCount: 0 });
      _qwEmitTurnResult(io, code, room, player.index, res.breakdown);
      _qwAfterTurn(io, code, room);
      return;
    }

    room.qwTurn = {
      playerIdx: player.index,
      placement: clean,
      words,
      bonuses,
      bonusIdx: 0,
      bonusResults: {},
      awaitingStart: true,
    };
    state.phase = QW_PHASE.BONUS_Q;
    _qwClearTurnTimer(room); // bonus questions have their own timer
    cb({ ok: true, bonusCount: bonuses.length });
    _qwSendBonusPrompt(io, code, room);
  });

  socket.on('qlashword:answer_bonus', ({ code, answerIdx } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const ctx = _qwTurnGuard(socket, code, cb, QW_PHASE.BONUS_Q);
    if (!ctx) {
      return;
    }
    const { room, player } = ctx;
    const turn = room.qwTurn;
    if (!turn || turn.playerIdx !== player.index) {
      return cb({ error: 'No bonus question pending' });
    }
    if (turn.awaitingStart) {
      return cb({ error: 'Question not started yet' });
    }
    if (turn.answered) {
      return cb({ error: 'Already answered' });
    }
    if (room.qwTimerExpired) {
      return cb({ error: 'Time expired' });
    }
    if (typeof answerIdx !== 'number' || answerIdx < -1 || answerIdx > 3) {
      return cb({ error: 'Invalid answer' });
    }
    const bonus = turn.bonuses[turn.bonusIdx];
    const q = questionsDb._byId[bonus.questionId];
    const correct = !!q && answerIdx === q.a;
    turn.answered = true;
    cb({ ok: true });
    _qwResolveBonus(io, code, room, correct, answerIdx);
  });

  // Active player opts in to the gated bonus question — only now do we send the
  // question and start the answer timer (so reading the prompt doesn't burn time).
  socket.on('qlashword:bonus_start', ({ code } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const ctx = _qwTurnGuard(socket, code, cb, QW_PHASE.BONUS_Q);
    if (!ctx) {
      return;
    }
    const { room, player } = ctx;
    const turn = room.qwTurn;
    if (!turn || turn.playerIdx !== player.index) {
      return cb({ error: 'No bonus question pending' });
    }
    if (!turn.awaitingStart) {
      return cb({ error: 'Question already started' });
    }
    turn.awaitingStart = false;
    cb({ ok: true });
    _qwSendBonusQuestion(io, code, room);
  });

  socket.on('qlashword:pass', ({ code } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const ctx = _qwTurnGuard(socket, code, cb, QW_PHASE.PLACE);
    if (!ctx) {
      return;
    }
    const { room, player } = ctx;
    const res = qwPassTurn(room.state, player.index);
    if (res.error) {
      return cb({ error: res.error });
    }
    cb({ ok: true });
    io.to(code).emit('qlashword:passed', {
      playerIdx: player.index,
      turn: room.state.turnNumber - 1,
    });
    _qwAfterTurn(io, code, room);
  });

  socket.on('qlashword:swap', ({ code, indices } = {}, cb) => {
    if (typeof cb !== 'function') {
      return;
    }
    const ctx = _qwTurnGuard(socket, code, cb, QW_PHASE.PLACE);
    if (!ctx) {
      return;
    }
    const { room, player } = ctx;
    if (!Array.isArray(indices) || indices.some((i) => !Number.isInteger(i))) {
      return cb({ error: 'Invalid swap selection' });
    }
    const res = qwSwapTiles(room.state, player.index, indices);
    if (res.error) {
      return cb({ error: res.error });
    }
    cb({ ok: true });
    io.to(code).emit('qlashword:swapped', {
      playerIdx: player.index,
      turn: room.state.turnNumber - 1,
      count: indices.length,
    });
    _qwAfterTurn(io, code, room);
  });

  // --- Disconnect ---

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id}`);
    quizRuns.delete(socket.id);
    _disposeSkipnotRun(socket.id);
    howHighRuns.delete(socket.id);
    mathquizRuns.delete(socket.id);
    centographerRuns.delete(socket.id);
    unregisterActiveSocket(socket.id);
    const { room, player } = removePlayerFromRoom(socket.id);
    if (room && player) {
      // If game was in progress, notify remaining players and end the game
      if (room.started && room.state) {
        let alreadyOver;
        if (room.mode === 'qlashique') {
          alreadyOver = room.state.phase === QLAS_PHASE.GAME_OVER;
        } else if (room.mode === 'qlashword') {
          alreadyOver = room.state.phase === QW_PHASE.GAME_OVER;
        } else {
          alreadyOver = room.state.phase === PHASE.GAME_OVER;
        }
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
          } else if (room.mode === 'qlashword') {
            if (room.qwTimer) {
              clearTimeout(room.qwTimer);
              room.qwTimer = null;
            }
            if (room.qwTurnTimer) {
              clearTimeout(room.qwTurnTimer);
              room.qwTurnTimer = null;
            }
            room.qwTimerExpired = true;
            room.qwTurn = null;
            room.state.phase = QW_PHASE.GAME_OVER;
            io.to(room.code).emit('qlashword:game_over', {
              winnerIdx: winner.index,
              reason: 'disconnect',
              scores: room.state.scores,
            });
          } else {
            room.state.phase = PHASE.GAME_OVER;
            room.state.winner = winner.index;
            room.players.push(player);
            recordGameStats(room);
            room.players.pop();
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

function _getExistingUserIdSet(ids) {
  const cleanIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (cleanIds.length === 0) {
    return new Set();
  }
  const db = getDb();
  if (!db) {
    return new Set();
  }
  const rows = db
    .prepare(`SELECT id FROM users WHERE id IN (${cleanIds.map(() => '?').join(',')})`)
    .all(...cleanIds);
  return new Set(rows.map((row) => row.id));
}

function recordGameStats(room) {
  if (!room || !room.startedAt || !room.state?.players || room.state.players.length < 2) {
    return;
  }

  const players = room.state.players;
  const winnerIdx = room.state.winner;
  const durationMs = Date.now() - room.startedAt;
  const winnerUserId =
    winnerIdx !== null ? (room.players.find((p) => p.index === winnerIdx)?.userId ?? null) : null;

  const player1UserId = room.players.find((p) => p.index === 0)?.userId;
  const player2UserId = room.players.find((p) => p.index === 1)?.userId;
  const existingUserIds = _getExistingUserIdSet([player1UserId, player2UserId, winnerUserId]);
  const validPlayer1UserId = existingUserIds.has(player1UserId) ? player1UserId : null;
  const validPlayer2UserId = existingUserIds.has(player2UserId) ? player2UserId : null;
  const validWinnerUserId = existingUserIds.has(winnerUserId) ? winnerUserId : null;

  const db = getDb();
  if (!db) {
    return;
  }

  try {
    db.transaction(() => {
      if (validPlayer1UserId && validPlayer2UserId) {
        const player1Stats = players[0]?.stats ?? { byCategory: {} };
        const player2Stats = players[1]?.stats ?? { byCategory: {} };

        insertGameResult({
          player1Id: validPlayer1UserId,
          player2Id: validPlayer2UserId,
          winnerId: validWinnerUserId,
          gameMode: 'duel',
          boardSize: room.settings.boardSize,
          durationMs,
          player1Stats,
          player2Stats,
        });

        for (const [cat, stat] of Object.entries(player1Stats.byCategory ?? {})) {
          trackAnswersBatch(validPlayer1UserId, cat, stat.attempts ?? 0, stat.correct ?? 0);
        }
        for (const [cat, stat] of Object.entries(player2Stats.byCategory ?? {})) {
          trackAnswersBatch(validPlayer2UserId, cat, stat.attempts ?? 0, stat.correct ?? 0);
        }
      }

      const updateGames = _getUpdateGamesStmt();
      if (updateGames) {
        for (let i = 0; i < room.players.length; i++) {
          const uid = room.players[i]?.userId;
          if (existingUserIds.has(uid)) {
            updateGames.run(winnerIdx === room.players[i]?.index ? 1 : 0, uid);
          }
        }
      }
    })();
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
let _testBonusQ3Override = null;
let _testBonusQ6Override = null;

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
  const existingUserIds = _getExistingUserIdSet([p0?.userId, p1?.userId]);
  const p0UserId = existingUserIds.has(p0?.userId) ? p0.userId : null;
  const p1UserId = existingUserIds.has(p1?.userId) ? p1.userId : null;
  if (!p0UserId || !p1UserId) {
    return;
  }

  const db = getDb();
  if (!db) {
    return;
  }

  try {
    db.transaction(() => {
      insertGameResult({
        player1Id: p0UserId,
        player2Id: p1UserId,
        winnerId: winnerIdx === 0 ? p0UserId : p1UserId,
        gameMode: 'qlashique',
        boardSize: null,
        durationMs,
        player1Stats: { ...s0, finalHp: room.state.players[0].hp },
        player2Stats: { ...s1, finalHp: room.state.players[1].hp },
      });

      const updateGames = _getUpdateGamesStmt();
      if (updateGames) {
        updateGames.run(winnerIdx === 0 ? 1 : 0, p0UserId);
        updateGames.run(winnerIdx === 1 ? 1 : 0, p1UserId);
      }
    })();
  } catch (e) {
    console.warn('[qlashique] Failed to save game result:', e.message);
  }
}

// Persist a COMPLETED Qlashword game to stats (played/won). Only called on
// normal end (not disconnect). Both players must be logged-in accounts.
function _saveQwResult(room, winnerIdx) {
  const [p0, p1] = room.players;
  const existingUserIds = _getExistingUserIdSet([p0?.userId, p1?.userId]);
  const p0UserId = existingUserIds.has(p0?.userId) ? p0.userId : null;
  const p1UserId = existingUserIds.has(p1?.userId) ? p1.userId : null;
  if (!p0UserId || !p1UserId) {
    return;
  }
  const db = getDb();
  if (!db) {
    return;
  }
  const durationMs = room.startedAt ? Date.now() - room.startedAt : null;
  const scores = room.state.scores;
  const winnerId = winnerIdx === 0 ? p0UserId : winnerIdx === 1 ? p1UserId : null;
  try {
    db.transaction(() => {
      insertGameResult({
        player1Id: p0UserId,
        player2Id: p1UserId,
        winnerId,
        gameMode: 'qlashword',
        boardSize: null,
        durationMs,
        player1Stats: { score: scores[0] },
        player2Stats: { score: scores[1] },
      });
      const updateGames = _getUpdateGamesStmt();
      if (updateGames) {
        updateGames.run(winnerIdx === 0 ? 1 : 0, p0UserId);
        updateGames.run(winnerIdx === 1 ? 1 : 0, p1UserId);
      }
    })();
  } catch (e) {
    console.warn('[qlashword] Failed to save game result:', e.message);
  }
}

function _initQlasRoomState(room) {
  room.started = true;
  room.startedAt = Date.now();
  room.state = createQlasGame(_testHPOverride ?? room.qlasHP ?? QLAS_DEFAULT_HP);
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
    maxHp: room.state.maxHp,
  });
}

// Resolve the active player's turn: score it, apply outcome, broadcast HP and
// either game-over or the next turn. Shared by the qlashique:end_turn handler
// and the authoritative timer (so an AFK active player can't freeze the duel).
// Caller must have already validated room/phase. Returns {ok} or {error}.
function _endQlasTurn(ioServer, code, room, choice = 'attack') {
  if (room.qlasTimer) {
    clearTimeout(room.qlasTimer);
    room.qlasTimer = null;
  }

  const scoreBeforeEnd = room.state.currentScore;
  const { outcome, error, actingPlayerIdx } = endTurn(room.state);
  if (error) {
    return { error };
  }

  let finalOutcome = outcome;
  let finalActingIdx = actingPlayerIdx;
  if (outcome === 'choose') {
    const safeChoice = choice === 'heal' ? 'heal' : 'attack';
    const result = applyOutcome(room.state, safeChoice);
    if (result.error) {
      return result;
    }
    finalOutcome = safeChoice;
    finalActingIdx = result.actingPlayerIdx;
  }

  ioServer.to(code).emit('qlashique:turn_end', {
    score: scoreBeforeEnd,
    outcome: finalOutcome,
  });
  ioServer.to(code).emit('qlashique:hp_update', {
    p0hp: room.state.players[0].hp,
    p1hp: room.state.players[1].hp,
  });

  const winnerIdx = checkGameOver(room.state, finalActingIdx);
  if (winnerIdx >= 0 && winnerIdx < 2) {
    room.state.phase = QLAS_PHASE.GAME_OVER;
    for (const p of room.players) {
      unregisterActiveSocket(p.id);
    }
    _saveQlasResult(room, winnerIdx);
    ioServer.to(code).emit('qlashique:game_over', {
      winnerIdx,
      reason: 'hp',
      history: room.qlasHistory ?? [],
      stats: room.qlasStats ?? null,
    });
    return { ok: true };
  }

  _emitQlasTurnStart(ioServer, code, room);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Qlashword helpers
// ---------------------------------------------------------------------------

const QW_BONUS_TIMER_S = 15;
const QW_BONUS_PROMPT_TIMEOUT_S = 30; // auto no-unlock if the player never opts in
const QW_BONUS_RESULT_MS = 1300; // pause showing the green/red pick before advancing
const QW_TURN_TIMER_S = 90; // placement turn clock — auto-pass so games can't stall
// Bonus questions are pulled from every category EXCEPT death_metal.
const QW_BONUS_CATS_SET = new Set([...CATS_SET].filter((c) => c !== 'death_metal'));

// Shared guard for in-game qlashword handlers. Returns {room, player} or null
// (after invoking cb with the appropriate error).
function _qwTurnGuard(socket, code, cb, requiredPhase) {
  const room = getRoom(code);
  if (!room?.state || room.mode !== 'qlashword') {
    cb({ error: 'No active game' });
    return null;
  }
  const player = getPlayerBySocket(room, socket.id);
  if (!player) {
    cb({ error: 'Not in this room' });
    return null;
  }
  if (room.state.currentPlayerIdx !== player.index) {
    cb({ error: 'Not your turn' });
    return null;
  }
  if (room.state.phase !== requiredPhase) {
    cb({ error: 'Wrong phase' });
    return null;
  }
  return { room, player };
}

// Validate + normalize a client placement into trusted PlacedTile objects.
function _qwSanitizePlacement(placement) {
  if (!Array.isArray(placement) || placement.length === 0 || placement.length > 7) {
    return null;
  }
  const clean = [];
  for (const t of placement) {
    if (!t || typeof t !== 'object') {
      return null;
    }
    const { row, col } = t;
    if (!Number.isInteger(row) || !Number.isInteger(col)) {
      return null;
    }
    if (row < 0 || row > 14 || col < 0 || col > 14) {
      return null;
    }
    if (typeof t.letter !== 'string' || !/^[A-Z]$/.test(t.letter)) {
      return null;
    }
    clean.push({ row, col, letter: t.letter, blank: !!t.blank });
  }
  return clean;
}

// True iff the rack holds every tile a placement consumes (blanks use '_').
function _qwRackCovers(rack, placement) {
  const copy = rack.slice();
  for (const t of placement) {
    const needed = t.blank ? '_' : t.letter;
    const idx = copy.indexOf(needed);
    if (idx === -1) {
      return false;
    }
    copy.splice(idx, 1);
  }
  return true;
}

function _qwPickBonusQuestion(room) {
  // Test-only override hook (mirrors the board/qlas question override).
  const overrideId = _consumeQuestionOverride(questionsDb);
  if (overrideId) {
    const oq = questionsDb._byId[overrideId];
    if (oq) {
      room.qwUsedQIds.add(oq.id);
      return oq;
    }
  }
  const q = pickRandomQuestion(questionsDb, QW_BONUS_CATS_SET, room.qwUsedQIds);
  if (q) {
    room.qwUsedQIds.add(q.id);
  }
  return q;
}

function _qwClearTimer(room) {
  if (room.qwTimer) {
    clearTimeout(room.qwTimer);
    room.qwTimer = null;
  }
}

function _qwClearTurnTimer(room) {
  if (room.qwTurnTimer) {
    clearTimeout(room.qwTurnTimer);
    room.qwTurnTimer = null;
  }
}

// Start the placement-turn clock for the current player. On expiry the turn is
// auto-passed so a player can't stall the game by never finishing their turn.
function _qwStartTurnTimer(ioServer, code, room) {
  _qwClearTurnTimer(room);
  if (!room.state || room.state.phase !== QW_PHASE.PLACE) {
    return;
  }
  const idx = room.state.currentPlayerIdx;
  ioServer.to(code).emit('qlashword:turn_start', { playerIdx: idx, seconds: QW_TURN_TIMER_S });
  room.qwTurnTimer = setTimeout(() => {
    room.qwTurnTimer = null;
    try {
      if (!room.state || room.state.phase !== QW_PHASE.PLACE) {
        return;
      }
      const cur = room.state.currentPlayerIdx;
      const res = qwPassTurn(room.state, cur);
      if (res.error) {
        return;
      }
      ioServer.to(code).emit('qlashword:passed', {
        playerIdx: cur,
        turn: room.state.turnNumber - 1,
        reason: 'timeout',
      });
      _qwAfterTurn(ioServer, code, room);
    } catch (err) {
      console.error('[qlashword] turn timer error:', err);
    }
  }, QW_TURN_TIMER_S * 1000);
}

// Public (shared) view of the board state. Racks are sent privately.
function _qwPublicState(room) {
  const s = room.state;
  return {
    board: s.board,
    scores: s.scores,
    currentPlayerIdx: s.currentPlayerIdx,
    turnNumber: s.turnNumber,
    phase: s.phase,
    bagCount: s.bag.length,
    rackCounts: [s.racks[0].length, s.racks[1].length],
  };
}

// Broadcast shared state to the room and each player's private rack to them.
function _qwEmitState(ioServer, code, room) {
  ioServer.to(code).emit('qlashword:state', _qwPublicState(room));
  for (const p of room.players) {
    ioServer.to(p.id).emit('qlashword:rack', { rack: room.state.racks[p.index] });
  }
}

function _emitQwGameStart(ioServer, code, room) {
  ioServer.to(code).emit('qlashword:start', {
    players: room.players.map(publicPlayer),
    state: _qwPublicState(room),
  });
  for (const p of room.players) {
    ioServer.to(p.id).emit('qlashword:rack', { rack: room.state.racks[p.index] });
  }
  _qwStartTurnTimer(ioServer, code, room);
}

// Announce the next gated bonus square WITHOUT the question — the active player
// must opt in (qlashword:bonus_start) before the question + timer are sent.
function _qwSendBonusPrompt(ioServer, code, room) {
  const turn = room.qwTurn;
  turn.awaitingStart = true;
  turn.answered = false;
  const bonus = turn.bonuses[turn.bonusIdx];
  room.qwTimerExpired = false;
  ioServer.to(code).emit('qlashword:bonus_prompt', {
    bonus: { row: bonus.row, col: bonus.col, bonusType: bonus.bonusType },
    bonusIdx: turn.bonusIdx,
    bonusTotal: turn.bonuses.length,
    activePlayerIdx: turn.playerIdx,
  });
  // Safety: if the active player never opts in, auto-resolve as no-unlock.
  _qwClearTimer(room);
  room.qwTimer = setTimeout(() => {
    room.qwTimer = null;
    try {
      if (room.state?.phase !== QW_PHASE.BONUS_Q || !room.qwTurn?.awaitingStart) {
        return;
      }
      _qwResolveBonus(ioServer, code, room, false, -1);
    } catch (err) {
      console.error('[qlashword] bonus prompt timer error:', err);
    }
  }, QW_BONUS_PROMPT_TIMEOUT_S * 1000);
}

function _qwSendBonusQuestion(ioServer, code, room) {
  const turn = room.qwTurn;
  const bonus = turn.bonuses[turn.bonusIdx];
  const q = questionsDb._byId[bonus.questionId];
  if (!q) {
    // Defensive: don't wedge the turn — treat a missing question as no-unlock.
    _qwResolveBonus(ioServer, code, room, false, -1);
    return;
  }
  room.qwTimerExpired = false;
  ioServer.to(code).emit('qlashword:bonus_question', {
    question: { id: q.id, q: q.q, opts: q.opts, category: q.category },
    bonus: { row: bonus.row, col: bonus.col, bonusType: bonus.bonusType },
    bonusIdx: turn.bonusIdx,
    bonusTotal: turn.bonuses.length,
    activePlayerIdx: turn.playerIdx,
    timerSeconds: QW_BONUS_TIMER_S,
  });
  _qwClearTimer(room);
  room.qwTimer = setTimeout(
    () => {
      room.qwTimer = null;
      try {
        if (room.state?.phase !== QW_PHASE.BONUS_Q) {
          return;
        }
        room.qwTimerExpired = true;
        _qwResolveBonus(ioServer, code, room, false, -1); // timeout = no-unlock
      } catch (err) {
        console.error('[qlashword] bonus timer error:', err);
      }
    },
    (QW_BONUS_TIMER_S + 3) * 1000,
  );
}

function _qwResolveBonus(ioServer, code, room, correct, answerIdx = -1) {
  const turn = room.qwTurn;
  if (!turn) {
    return;
  }
  _qwClearTimer(room);
  const bonus = turn.bonuses[turn.bonusIdx];
  turn.bonusResults[qwCoordKey(bonus.row, bonus.col)] = correct;
  ioServer.to(code).emit('qlashword:bonus_result', {
    bonus: { row: bonus.row, col: bonus.col, bonusType: bonus.bonusType },
    correct,
    answerIdx,
    bonusIdx: turn.bonusIdx,
  });
  // Brief pause so both players see the green/red pick before moving on.
  room.qwTimer = setTimeout(() => {
    room.qwTimer = null;
    try {
      if (!room.qwTurn) {
        return;
      }
      room.qwTurn.bonusIdx++;
      if (room.qwTurn.bonusIdx < room.qwTurn.bonuses.length) {
        _qwSendBonusPrompt(ioServer, code, room);
      } else {
        _qwFinalizeTurn(ioServer, code, room);
      }
    } catch (err) {
      console.error('[qlashword] bonus advance error:', err);
    }
  }, QW_BONUS_RESULT_MS);
}

function _qwFinalizeTurn(ioServer, code, room) {
  const turn = room.qwTurn;
  room.qwTurn = null;
  room.state.phase = QW_PHASE.PLACE;
  const res = qwApplyTurn(
    room.state,
    turn.playerIdx,
    turn.placement,
    turn.words,
    turn.bonusResults,
  );
  if ('error' in res) {
    console.error('[qlashword] finalize failed:', res.error);
    _qwEmitState(ioServer, code, room);
    return;
  }
  _qwEmitTurnResult(ioServer, code, room, turn.playerIdx, res.breakdown);
  _qwAfterTurn(ioServer, code, room);
}

function _qwEmitTurnResult(ioServer, code, room, playerIdx, breakdown) {
  ioServer.to(code).emit('qlashword:turn_result', {
    playerIdx,
    turn: room.state.turnNumber - 1,
    breakdown,
    scores: room.state.scores,
  });
}

// Broadcast post-turn state, then end the game if the end condition is met.
function _qwAfterTurn(ioServer, code, room) {
  _qwEmitState(ioServer, code, room);
  if (qwCheckGameOver(room.state)) {
    const finals = qwFinalScores(room.state);
    room.state.scores = finals;
    room.state.phase = QW_PHASE.GAME_OVER;
    _qwClearTimer(room);
    _qwClearTurnTimer(room);
    for (const p of room.players) {
      unregisterActiveSocket(p.id);
    }
    const winnerIdx = finals[0] === finals[1] ? -1 : finals[0] > finals[1] ? 0 : 1;
    _saveQwResult(room, winnerIdx); // completed games count toward played/won
    ioServer.to(code).emit('qlashword:game_over', {
      winnerIdx,
      reason: 'normal',
      scores: finals,
    });
    return;
  }
  _qwStartTurnTimer(ioServer, code, room);
}

// Wait for Redis to be ready before accepting traffic — any request before
// this would be a cache miss into a broken session store.
if (process.env.VITEST) {
  waitForRedisReady(10_000).catch((err) => {
    console.error('[startup] Redis not ready:', err.message);
  });
} else {
  waitForRedisReady(10_000)
    .then(() => {
      httpServer.listen(PORT, () => console.log(`Weeqlash server :${PORT}`));
    })
    .catch((err) => {
      console.error('[startup] Redis not ready:', err.message);
      process.exit(1);
    });
}

export { app };
