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
  Category,
} from './game/engine.ts';
import { loadQuestions, getAllQuestions, getQuestionsForCategories } from './game/questions.ts';
import { QUIZ_MODES_BY_ID } from './game/quiz-modes.ts';
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
  createUser,
  clearTestUsers,
  clearTestHistory,
} from './game/auth.ts';
import { registerAuthRoutes } from './game/auth-routes.ts';
import adminRoutes from './routes/admin.ts';
import { rooms, socketToRoom } from './game/rooms.ts';

const app = express();
app.set('trust proxy', 1);

// Types for our game logic integrations
import type {
  GameState,
  Submission,
  QuestionsDb,
  Question,
  GameResult,
  TurnResult,
} from './game/engine.ts';
import type { QlashiqueState } from './game/qlashique.ts';
import type { PlayerInRoom, RoomState } from './game/rooms.ts';

const PORT = process.env.PORT || 3000;
const ORIGINS = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : [];
const SESSION_SECRET = process.env.SESSION_SECRET || 'fallback-secret';
const QUESTIONS_KEY = process.env.QUESTIONS_KEY;
if (!QUESTIONS_KEY) {
  throw new Error('QUESTIONS_KEY environment variable is required');
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ORIGINS.length > 0 ? ORIGINS : '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: 'weeqlash.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
    },
  }),
);

// Serve static files from client directory
app.use(express.static(path.join(__dirname, '..', 'client')));

// Health check endpoint
app.get('/health', (_req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Admin routes
app.use('/admin', adminRoutes);

// Auth routes
registerAuthRoutes(app);

// Initialize databases
try {
  initDb();
  const authDbResult = initAuthDb();
  if (authDbResult.error) {
    console.error('[init] Auth DB initialization failed:', authDbResult.error);
    process.exit(1);
  }
} catch (error) {
  console.error('[init] DB initialization failed:', (error as Error).message);
  process.exit(1);
}

console.log('[init] Databases initialized');

// Get database instance
const db = getDb();

// Load questions at startup
let questionsDb: QuestionsDb | null = null;
try {
  const loaded = loadQuestions();
  questionsDb = loaded as QuestionsDb;
  console.log('[init] Questions loaded');
} catch (error) {
  console.error('[init] Failed to load questions:', error);
  process.exit(1);
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`[socket] Connected: ${socket.id}`);

  // Helper function to get client IP
  const getClientIp = (): string => {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    const headerValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const raw = headerValue || socket.handshake.address || socket.conn.remoteAddress || 'unknown';
    // Normalize IPv6-mapped IPv4 (e.g. ::ffff:127.0.0.1 → 127.0.0.1)
    return typeof raw === 'string' && raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  };

  // Rate limiting for Socket.IO events
  const socketRateLimits = new Map<string, { count: number; firstAttempt: number }>();
  const SOCKET_RATE_LIMIT = 20;
  const SOCKET_RATE_WINDOW_MS = 5000;

  const checkSocketRateLimit = (socketId: string): boolean => {
    const now = Date.now();
    const entry = socketRateLimits.get(socketId);
    if (!entry || now - entry.firstAttempt > SOCKET_RATE_WINDOW_MS) {
      socketRateLimits.set(socketId, { count: 1, firstAttempt: now });
      return true;
    }
    if (entry.count >= SOCKET_RATE_LIMIT) {
      return false;
    }
    entry.count++;
    return true;
  };

  const applySocketRateLimit = (): boolean => {
    const socketId = socket.id;
    if (!checkSocketRateLimit(socketId)) {
      socket.emit('error', { message: 'Too many requests. Please slow down.' });
      return false;
    }
    return true;
  };

  // Create room handler
  socket.on(
    'createRoom',
    (
      {
        playerCount,
        boardSize,
        timer,
        enabledCats,
      }: {
        playerCount?: number;
        boardSize?: number;
        timer?: number;
        enabledCats?: Category[];
      },
      callback,
    ) => {
      if (!applySocketRateLimit()) return;

      try {
        const room = createRoom({ playerCount, boardSize, timer, enabledCats });
        callback({ ok: true, roomCode: room.code });
      } catch (error) {
        console.error('[socket] createRoom error:', error as Error);
        callback({ error: 'Failed to create room' });
      }
    },
  );

  // Join room handler
  socket.on(
    'joinRoom',
    (
      {
        roomCode,
        playerName,
        userId = null,
      }: {
        roomCode: string;
        playerName: string;
        userId: string | null;
      },
      callback,
    ) => {
      if (!applySocketRateLimit()) return;

      try {
        const result = joinRoom(roomCode.toUpperCase(), socket.id, playerName, userId);
        if ('error' in result) {
          callback(result);
        } else {
          const playerResult = result as PlayerInRoom;
          const roomCodeUpper = roomCode.toUpperCase();
          socketToRoom.set(socket.id, roomCodeUpper);
          const room = rooms.get(roomCodeUpper);
          if (!room) {
            return callback({ error: 'Room not found after joining' });
          }
          callback({ ok: true, player: playerResult });
        }
      } catch (error) {
        console.error('[socket] joinRoom error:', error as Error);
        callback({ error: 'Failed to join room' });
      }
    },
  );

  // Disconnect handler
  socket.on('disconnect', (reason) => {
    console.log(`[socket] Disconnected: ${socket.id} (reason: ${reason})`);
    const roomCode = socketToRoom.get(socket.id);
    if (roomCode) {
      const result = removeRoomPlayer(socket.id);
      if ('room' in result && typeof result !== 'boolean' && 'player' in result) {
        const { room, player } = result as { room: RoomState; player: PlayerInRoom };
        // Notify remaining players in the room
        socket.to(roomCode).emit('playerLeft', {
          playerId: player.id,
          playerName: player.name,
          remainingPlayers: room.players.length,
        });

        // Clean up empty rooms after delay
        if (room.players.length === 0) {
          const codeToCheck = room.code;
          setTimeout(() => {
            const existingRoom = rooms.get(codeToCheck);
            if (existingRoom && existingRoom.players.length === 0) {
              console.log(`[room] cleaning up empty room ${codeToCheck}`);
              rooms.delete(codeToCheck);
            }
          }, 15000);
        }
      }
    }
    socketToRoom.delete(socket.id);
  });

  // Helper to remove player from room and return room/player
  const removeRoomPlayer = (socketId: string): { room?: RoomState; player?: PlayerInRoom } | {} => {
    const roomCode = socketToRoom.get(socketId);
    if (!roomCode) {
      return {};
    }

    const room = rooms.get(roomCode);
    if (!room) {
      socketToRoom.delete(socketId);
      return {};
    }

    // Use O(1) Map lookup instead of find
    const player = room.playersBySocket.get(socketId);
    if (player) {
      room.playersBySocket.delete(socketId);
    }
    room.players = room.players.filter((p) => p.id !== socketId);
    socketToRoom.delete(socketId);

    return { room, player };
  };

  // Select peg handler
  socket.on('selectPeg', ({ pegId }: { pegId: number }, callback) => {
    if (!applySocketRateLimit()) return;

    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) {
      return callback({ error: 'Not in a room' });
    }

    const room = rooms.get(roomCode);
    if (!room) {
      socketToRoom.delete(socket.id);
      return callback({ error: 'Room not found' });
    }

    if (room.started) {
      return callback({ error: 'Game already started' });
    }

    const player = getPlayerBySocket(room, socket.id);
    if (!player) {
      return callback({ error: 'Player not found in room' });
    }

    try {
      const gameState = createGame(room.state);
      // Convert pegId back to row and column coordinates
      const targetC = pegId % COORD_BASE;
      const targetR = Math.floor(pegId / COORD_BASE);

      // Find the peg at this position that belongs to the current player
      let targetPegId: string | null = null;
      for (const [pegId, peg] of Object.entries(gameState.pegs)) {
        if (peg.playerId === player.index && peg.row === targetR && peg.col === targetC) {
          targetPegId = pegId;
          break;
        }
      }

      if (!targetPegId) {
        return callback({ error: 'No peg found at selected position' });
      }

      const validMovesResult = selectPeg(gameState, player.index, targetPegId);
      if ('validMoves' in validMovesResult) {
        callback({ ok: true, validMoves: validMovesResult.validMoves });
      } else {
        callback({ error: validMovesResult.error });
      }
    } catch (error) {
      console.error('[socket] selectPeg error:', error as Error);
      callback({ error: 'Invalid move' });
    }
  });

  // Select tile handler
  socket.on('selectTile', ({ tileId }: { tileId: number }, callback) => {
    if (!applySocketRateLimit()) return;

    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) {
      return callback({ error: 'Not in a room' });
    }

    const room = rooms.get(roomCode);
    if (!room) {
      socketToRoom.delete(socket.id);
      return callback({ error: 'Room not found' });
    }

    if (!room.started) {
      return callback({ error: 'Game not started' });
    }

    const player = getPlayerBySocket(room, socket.id);
    if (!player) {
      return callback({ error: 'Player not found in room' });
    }

    try {
      const gameState = createGame(room.state);
      if (!questionsDb) {
        return callback({ error: 'Questions database not loaded' });
      }
      // Convert tileId back to row and column coordinates
      const targetC = tileId % COORD_BASE;
      const targetR = Math.floor(tileId / COORD_BASE);

      // Find the peg at this position that belongs to the current player
      let targetPegId: string | null = null;
      for (const [pegId, peg] of Object.entries(gameState.pegs)) {
        if (peg.playerId === player.index && peg.row === targetR && peg.col === targetC) {
          targetPegId = pegId;
          break;
        }
      }

      if (!targetPegId) {
        return callback({ error: 'No peg found at selected position' });
      }

      const moveTypeResult = planTurnQuestions(
        gameState,
        targetPegId,
        targetR,
        targetC,
        questionsDb,
      );

      if (!moveTypeResult || !moveTypeResult.questionId) {
        return callback({ error: 'No question available for this move' });
      }

      // Get the question data
      const questionAny = questionsDb._byId?.[moveTypeResult.questionId];
      if (!questionAny) {
        return callback({ error: 'Question not found' });
      }
      const question = questionAny as unknown as {
        id: string;
        question: string;
        options: string[];
        category: string;
      };

      callback({
        ok: true,
        moveType: moveTypeResult.moveType,
        questionId: moveTypeResult.questionId,
        question: {
          id: question.id,
          question: question.question,
          options: question.options,
          category: question.category,
        },
      });
    } catch (error) {
      console.error('[socket] selectTile error:', error as Error);
      callback({ error: 'Invalid move' });
    }
  });

  // Submit answer handler
  socket.on(
    'submitAnswer',
    ({ answerIndex, questionId }: { answerIndex: number; questionId: string }, callback) => {
      if (!applySocketRateLimit()) return;

      const roomCode = socketToRoom.get(socket.id);
      if (!roomCode) {
        return callback({ error: 'Not in a room' });
      }

      const room = rooms.get(roomCode);
      if (!room) {
        socketToRoom.delete(socket.id);
        return callback({ error: 'Room not found' });
      }

      if (!room.started) {
        return callback({ error: 'Game not started' });
      }

      const player = getPlayerBySocket(room, socket.id);
      if (!player) {
        return callback({ error: 'Player not found in room' });
      }

      try {
        const gameState = createGame(room.state);
        // Get the pending turn from the room state to construct a proper submission
        const pendingTurn = room.state?.pendingTurn;
        if (!pendingTurn) {
          return callback({ error: 'No pending turn' });
        }

        const submission: Submission = {
          pegId: pendingTurn.pegId,
          targetR: pendingTurn.targetR,
          targetC: pendingTurn.targetC,
          answerIdx: answerIndex,
        };
        const result: GameResult = applyTurn(gameState, player.index, submission, questionsDb);

        if ('state' in result) {
          // Update room state
          room.state = result.state as GameState;

          // Track the answer for stats if we have a user ID
          if (player.userId !== null) {
            // Find the question category to track stats
            // Note: We'd need to get the actual questionId from pending turn
            // This is simplified - in practice we'd track this better
          }

          // Emit result to player
          socket.emit('answerResult', {
            correct: (result as TurnResult).correct,
            questionId: '',
            // Include any additional result data needed by client
            ...((result as TurnResult).events || {}),
          });

          // Broadcast updated state to room
          io.to(roomCode).emit('gameStateUpdate', {
            state: room.state,
          });

          callback({ ok: true, correct: (result as TurnResult).correct });
        } else {
          callback({ error: (result as { error: string }).error });
        }
      } catch (error) {
        console.error('[socket] submitAnswer error:', error as Error);
        callback({ error: 'Failed to process answer' });
      }
    },
  );

  // Qlashique-specific handlers
  socket.on('qlashique:createRoom', (callback) => {
    if (!applySocketRateLimit()) return;

    try {
      const room = createQlasRoom();
      callback({ ok: true, roomCode: room.code });
    } catch (error) {
      console.error('[socket] qlashique:createRoom error:', error);
      callback({ error: 'Failed to create qlashique room' });
    }
  });

  socket.on(
    'qlashique:joinRoom',
    (
      {
        roomCode,
        playerName,
        userId = null,
      }: {
        roomCode: string;
        playerName: string;
        userId: string | null;
      },
      callback,
    ) => {
      if (!applySocketRateLimit()) return;

      try {
        const result = joinRoom(roomCode.toUpperCase(), socket.id, playerName, userId);
        if ('error' in result) {
          callback(result);
        } else {
          const playerResult = result as PlayerInRoom;
          const roomCodeUpper = roomCode.toUpperCase();
          socketToRoom.set(socket.id, roomCodeUpper);
          const room = rooms.get(roomCodeUpper);
          if (!room) {
            return callback({ error: 'Room not found after joining' });
          }
          callback({ ok: true, player: playerResult });
        }
      } catch (error) {
        console.error('[socket] qlashique:joinRoom error:', error);
        callback({ error: 'Failed to join qlashique room' });
      }
    },
  );

  socket.on('qlashique:selectClass', ({ classId }: { classId: string }, callback) => {
    if (!applySocketRateLimit()) return;

    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) {
      return callback({ error: 'Not in a room' });
    }

    const room = rooms.get(roomCode);
    if (!room) {
      socketToRoom.delete(socket.id);
      return callback({ error: 'Room not found' });
    }

    if (!room.started) {
      return callback({ error: 'Game not started' });
    }

    // Find player index
    const player = getPlayerBySocket(room, socket.id);
    if (!player) {
      return callback({ error: 'Player not found in room' });
    }
    const playerIndex = player.index;

    // Validate class selection
    if (!['swordsman', 'archer', 'mage', 'reroll'].includes(classId)) {
      return callback({ error: 'Invalid class selection' });
    }

    // Check if player already selected a class
    if (room.classSelections?.[playerIndex] !== null) {
      return callback({ error: 'Class already selected' });
    }

    try {
      // Update room with class selection
      room.classSelections = room.classSelections || [null, null];
      room.classSelections[playerIndex] = classId;

      // Check if both players have selected classes
      if (room.classSelections[0] !== null && room.classSelections[1] !== null) {
        // Both players have selected classes, start the game
        room.state = createQlasGame();
        room.started = true;
        room.startedAt = Date.now();

        // Notify both players to start
        io.to(roomCode).emit('qlashique:gameStart', {
          state: room.state,
          classSelections: room.classSelections,
        });

        // Start first turn
        setTimeout(() => {
          const currentRoom = rooms.get(roomCode);
          if (currentRoom && currentRoom.started) {
            // Emit turn start to players
            io.to(roomCode).emit('qlashique:turnStart', {
              state: currentRoom.state,
              currentPlayerIdx: currentRoom.state.currentPlayerIdx,
              turnNumber: currentRoom.state.turnNumber,
              correctStreak: currentRoom.state.correctStreak,
              currentScore: currentRoom.state.currentScore,
              timer: calcTimer(
                currentRoom.state.turnNumber,
                currentRoom.state.players[currentRoom.state.currentPlayerIdx].classId,
              ),
            });
          }
        }, 1000);
      }

      callback({ ok: true });
    } catch (error) {
      console.error('[socket] qlashique:selectClass error:', error);
      callback({ error: 'Failed to select class' });
    }
  });

  socket.on('qlashique:processAnswer', ({ answerIndex }: { answerIndex: number }, callback) => {
    if (!applySocketRateLimit()) return;

    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) {
      return callback({ error: 'Not in a room' });
    }

    const room = rooms.get(roomCode);
    if (!room) {
      socketToRoom.delete(socket.id);
      return callback({ error: 'Room not found' });
    }

    if (!room.started) {
      return callback({ error: 'Game not started' });
    }

    if (room.state.phase !== QLAS_PHASE.GUESSING) {
      return callback({ error: 'Not answering phase' });
    }

    // Find player index
    const player = getPlayerBySocket(room, socket.id);
    if (!player) {
      return callback({ error: 'Player not found in room' });
    }
    const playerIndex = player.index;

    try {
      // Get the current question to determine correct answer
      // For now, we'll assume the question ID is stored somewhere accessible
      // This is a simplified version - in practice we'd need to track the current question
      const dummyCorrectIdx = 0; // Placeholder - needs proper implementation
      const result = processAnswer(room.state as QlashiqueState, playerIndex, dummyCorrectIdx);

      // Update room state
      if ('state' in result) {
        room.state = result.state as QlashiqueState;

        // Emit result to player
        socket.emit('qlashique:answerResult', {
          correct: (result as { state: QlashiqueState; correct: boolean }).correct,
        });
      }

      // If turn is complete, handle turn end
      if (!('turnContinues' in result && result.turnContinues)) {
        // Update stats for both players
        const p0 = room.players[0];
        const p1 = room.players[1];
        if (db && p0.userId !== null && p1.userId !== null) {
          // This would need the actual player objects - simplified for now
          // In a real implementation, we'd track player userIds properly
        }

        // End turn and potentially start next turn
        setTimeout(() => {
          const currentRoom = rooms.get(roomCode);
          if (currentRoom && currentRoom.started) {
            const gameResult = endTurn(currentRoom.state as QlashiqueState);
            if ('state' in gameResult) {
              // Update room state
              currentRoom.state = gameResult.state;

              // Check if game is over
              const winnerIdx = checkGameOver(currentRoom.state);
              if (winnerIdx !== -1) {
                // Game is over
                io.to(currentRoom.code).emit('qlashique:gameOver', {
                  state: currentRoom.state,
                  winnerId: winnerIdx,
                });

                // Save final result (only if both players have valid numeric user IDs)
                const p0 = currentRoom.players[0];
                const p1 = currentRoom.players[1];
                const durationMs = currentRoom.startedAt
                  ? Date.now() - currentRoom.startedAt
                  : null;
                const [s0, s1] = (currentRoom as any).qlasStats ?? [{}, {}];

                const p0UserIdNum = p0.userId !== null ? parseInt(p0.userId, 10) : null;
                const p1UserIdNum = p1.userId !== null ? parseInt(p1.userId, 10) : null;

                if (
                  db &&
                  p0UserIdNum !== null &&
                  p1UserIdNum !== null &&
                  !isNaN(p0UserIdNum) &&
                  !isNaN(p1UserIdNum)
                ) {
                  try {
                    insertGameResult({
                      player1Id: p0UserIdNum,
                      player2Id: p1UserIdNum,
                      winnerId: winnerIdx === 0 ? p0UserIdNum : p1UserIdNum,
                      gameMode: 'qlashique',
                      boardSize: 0, // Default board size for qlashique
                      durationMs: durationMs ?? 0,
                      player1Stats: {
                        ...s0,
                        finalHp: currentRoom.state.players[0].hp,
                        classId: currentRoom.classSelections?.[0] ?? null,
                      },
                      player2Stats: {
                        ...s1,
                        finalHp: currentRoom.state.players[1].hp,
                        classId: currentRoom.classSelections?.[1] ?? null,
                      },
                    });

                    // Update games_played and games_won
                    db.prepare(
                      'UPDATE users SET games_played = COALESCE(games_played, 0) + 1, games_won = COALESCE(games_won, 0) + ? WHERE id = ?',
                    ).run(winnerIdx === 0 ? 1 : 0, p0UserIdNum);
                    db.prepare(
                      'UPDATE users SET games_played = COALESCE(games_played, 0) + 1, games_won = COALESCE(games_won, 0) + ? WHERE id = ?',
                    ).run(winnerIdx === 1 ? 1 : 0, p1UserIdNum);
                  } catch (e) {
                    console.warn('[qlashique] Failed to save game result:', (e as Error).message);
                  }
                }
              } else {
                // Continue to next turn
                setTimeout(() => {
                  const currentRoom = rooms.get(roomCode);
                  if (currentRoom && currentRoom.started) {
                    // Emit turn start to players
                    io.to(roomCode).emit('qlashique:turnStart', {
                      state: currentRoom.state,
                      currentPlayerIdx: currentRoom.state.currentPlayerIdx,
                      turnNumber: currentRoom.state.turnNumber,
                      correctStreak: currentRoom.state.correctStreak,
                      currentScore: currentRoom.state.currentScore,
                      timer: calcTimer(
                        currentRoom.state.turnNumber,
                        currentRoom.state.players[currentRoom.state.currentPlayerIdx].classId,
                      ),
                    });
                  }
                }, 1000);
              }
            } else {
              // Handle error case
              console.error('[qlashique] endTurn error:', (gameResult as { error: string }).error);
            }
          }
        }, 1000);
      }

      callback({
        ok: true,
        correct: (result as { state: QlashiqueState; correct: boolean }).correct,
      });
    } catch (error) {
      console.error('[socket] qlashique:processAnswer error:', error as Error);
      callback({ error: 'Failed to process answer' });
    }
  });

  socket.on('qlashique:processReroll', (callback) => {
    if (!applySocketRateLimit()) return;

    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) {
      return callback({ error: 'Not in a room' });
    }

    const room = rooms.get(roomCode);
    if (!room) {
      socketToRoom.delete(socket.id);
      return callback({ error: 'Room not found' });
    }

    if (!room.started) {
      return callback({ error: 'Game not started' });
    }

    if (room.state.phase !== QLAS_PHASE.GUESSING) {
      return callback({ error: 'Not answering phase' });
    }

    // Find player index
    const player = getPlayerBySocket(room, socket.id);
    if (!player) {
      return callback({ error: 'Player not found in room' });
    }
    const playerIndex = player.index;

    // Check if reroll is available
    if (room.classSelections?.[playerIndex] !== 'reroll') {
      return callback({ error: 'Reroll not available' });
    }

    try {
      // Create a fresh game state for reroll processing
      const gameStateForReroll: QlashiqueState = createQlasGame();
      const rerollResult = processReroll(gameStateForReroll);

      // Update room state if reroll was successful
      if ('state' in rerollResult) {
        room.state = rerollResult.state;

        // Emit result to player
        socket.emit('qlashique:rerollResult', {});
      }

      callback({ ok: true });
    } catch (err) {
      console.error('[socket] qlashique:processReroll error:', err as Error);
      callback({ error: 'Failed to process reroll' });
    }
  });
});

// Cleanup intervals
setInterval(() => {
  cleanupStaleRooms();
  pruneAllModes();
}, 60000); // Every minute

// Clear test data periodically in development
if (process.env.NODE_ENV !== 'production') {
  setInterval(() => {
    clearTestEntries('leaderboard');
    clearTestUsers();
    clearTestHistory();
  }, 300000); // Every 5 minutes in development
}

httpServer.listen(PORT, () => console.log(`Weeqlash server :${PORT}`));

export { app };
