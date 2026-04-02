import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

import {
  createRoom,
  joinRoom,
  getRoom,
  removePlayerFromRoom,
  reattachSocket,
} from './game/rooms.js';
import {
  createGame,
  selectPeg,
  planTurnQuestions,
  applyTurn,
  getValidMoves,
  PHASE,
  COORD_BASE,
} from './game/engine.js';
import { loadQuestions } from './game/questions.js';
import { initDb, getTop10, insertScore, checkQualifiesTop10 } from './game/leaderboard.js';

const app = express();
const httpServer = createServer(app);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://sraz.nbastables.com';
const io = new Server(httpServer, {
  cors: { origin: CORS_ORIGIN },
});
const PORT = process.env.PORT || 3000;

// Minimum delay before accepting answers to ensure other players see the question
const MIN_ANSWER_DELAY_MS = 300;

// Rate limiting: throttle answer submissions per socket
const answerTimestamps = new Map(); // socketId -> lastAnswerTime
const RATE_LIMIT_MS = 500;

// Quiz session tracking
const quizRuns = new Map(); // socketId -> { startedAt, questionIds[], answers: 0 }

// Periodic cleanup of stale rate limit entries (every 30s)
setInterval(() => {
  const now = Date.now();
  for (const [socketId, time] of answerTimestamps) {
    if (now - time > 60_000) {
      answerTimestamps.delete(socketId);
    }
  }
}, 30_000);

// Load questions once at startup
const questionsDb = loadQuestions();
initDb();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  // --- Lobby ---

  socket.on(
    'room:create',
    (
      { playerName, playerCount, boardSize, timer, enabledCats, maxRankStart },
      cb,
    ) => {
      const room = createRoom({
        playerCount,
        boardSize,
        timer,
        enabledCats,
        maxRankStart,
      });
      const player = joinRoom(room.code, socket.id, playerName);
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
    },
  );

  socket.on('room:join', ({ code, playerName }, cb) => {
    const result = joinRoom(code, socket.id, playerName);
    if (result.error) {
      return cb(result);
    }
    const room = getRoom(code);
    socket.join(code);
    socket.to(code).emit('room:player_joined', { players: room.players.map(publicPlayer) });
    const token = room.players.find((p) => p.id === socket.id)?.token;
    cb({
      ok: true,
      playerId: socket.id,
      players: room.players.map(publicPlayer),
      settings: room.settings,
      token,
    });
    if (room.players.length === room.settings.playerCount) {
      io.to(code).emit('room:full', { players: room.players.map(publicPlayer) });
    }
  });

  socket.on('room:start', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room) {
      return cb({ error: 'Room not found' });
    }
    if (room.players[0].id !== socket.id) {
      return cb({ error: 'Only host can start' });
    }
    if (room.players.length < 2) {
      return cb({ error: 'Need at least 2 players' });
    }
    if (room.started) {
      return cb({ error: 'Already started' });
    }

    room.started = true;
    room.state = createGame(room.players, room.settings);
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
    const room = getRoom(code);
    if (!room || !room.started) {
      return cb({ error: 'Room not found or not started' });
    }
    const player = room.players.find((p) => p.token === token);
    if (!player) {
      return cb({ error: 'Invalid session token' });
    }

    const oldSocketId = player.id;
    player.id = socket.id; // re-attach new socket id
    reattachSocket(oldSocketId, socket.id, code);
    socket.join(code);
    console.log(`[reconnect] ${player.name} re-joined ${code}`);
    cb({
      ok: true,
      playerId: socket.id,
      state: publicState(room.state),
      players: room.players,
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

    const result = selectPeg(room.state, player.index, pegId);
    if (result.error) {
      return cb(result);
    }

    cb({ ok: true, validMoves: result.validMoves });
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

    // Validate it's the current player's turn and they own the selected peg
    if (room.state.currentPlayerIdx !== player.index) {
      return cb({ error: 'Not your turn' });
    }
    if (pegId !== room.state.selectedPegId) {
      return cb({ error: 'Peg not selected' });
    }

    // Validate it's a legal move before planning questions
    const validMoves = getValidMoves(room.state, pegId).map(
      (m) => m.r * COORD_BASE + m.c,
    );
    if (!validMoves.includes(r * COORD_BASE + c)) {
      return cb({ error: 'Invalid move target' });
    }

    const { moveType, questionIds } = planTurnQuestions(
      room.state,
      pegId,
      r,
      c,
      questionsDb,
    );
    const questions = questionIds
      .map((id) => {
        const q = questionsDb._byId?.[id];
        return q
          ? {
              id: q.id,
              q: q.q,
              opts: q.opts,
              category: q.category,
              correctIdx: q.a,
            }
          : null;
      })
      .filter(Boolean);

    // Broadcast question to other players (without correct answers)
    const questionsPublic = questions.map(({ correctIdx, ...q }) => q);
    const gamePlayer = room.state.players[player.index];
    const defPegId = room.state.board[r]?.[c]?.pegId;
    const defenderPlayerIdx =
      moveType === 'combat' && defPegId !== null && defPegId !== undefined
        ? (room.state.pegs[defPegId]?.playerId ?? null)
        : null;
    socket.to(code).emit('game:question_start', {
      playerIdx: player.index,
      playerColor: gamePlayer?.color,
      moveType,
      questions: questionsPublic,
      defenderPlayerIdx,
    });

    // Store timestamp for answer delay enforcement
    room.lastQuestionStart = Date.now();

    cb({ ok: true, moveType, questionIds, questions, defenderPlayerIdx });
  });

  socket.on('turn:answer_preview', ({ code, questionIdx, answerIdx }) => {
    const room = getRoom(code);
    if (!room?.state) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || room.state.currentPlayerIdx !== player.index) return;
    if (typeof answerIdx !== 'number' || answerIdx < 0 || answerIdx > 3) return;
    const pending = room.state.pendingTurn;
    const qId = pending?.questionIds?.[questionIdx];
    const correct = qId ? (questionsDb._byId?.[qId]?.a === answerIdx) : null;
    socket.to(code).emit('game:answer_preview', { questionIdx, answerIdx, correct });
  });

  socket.on('turn:submit', ({ code, submission }, cb) => {
    const room = getRoom(code);
    if (!room?.state) {
      return cb({ error: 'No active game' });
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      return cb({ error: 'Not in this room' });
    }

    // Enforce minimum delay to ensure other players see the question
    const timeSinceQuestionStart = Date.now() - (room.lastQuestionStart || 0);
    if (timeSinceQuestionStart < MIN_ANSWER_DELAY_MS) {
      return cb({
        error:
          'Answering too quickly. Wait for other players to see the question.',
      });
    }

    // Rate limiting: prevent answer spam
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
    if (submission.pegId !== pending.pegId) {
      return cb({ error: 'Peg mismatch' });
    }

    const numSubmitted = (submission.answers || []).length;

    // Validate answer indices: 0-3 are valid choices, -1 means timeout (treated as wrong)
    const answers = submission.answers || [];
    for (const ans of answers) {
      if (ans.answerIdx < -1 || ans.answerIdx > 3) {
        return cb({ error: 'Invalid answer index' });
      }
    }

    // Check if the latest answer is wrong
    let latestWrong = false;
    if (numSubmitted > 0) {
      const latestAns = answers[numSubmitted - 1];
      const q = questionsDb._byId?.[pending.questionIds[numSubmitted - 1]];
      if (q && latestAns.answerIdx !== q.a) {
        latestWrong = true;
      }
    }

    const hasMoreQuestions = numSubmitted < pending.questionIds.length;
    const shouldApplyTurn = !hasMoreQuestions || latestWrong;

    let result = { events: [], gameOver: false };
    if (shouldApplyTurn) {
      result = applyTurn(room.state, player.index, submission, questionsDb);
      if (result.error) {
        return cb(result);
      }
    }

    // Build per-question results for spectating players (no correct answer revealed when wrong)
    // For combat: if Q1 is wrong, battle ends immediately - include Q1 result for display
    const isCombat = pending?.moveType === 'combat';
    let hasWrongAnswer = false;
    const results = [];
    if (pending) {
      for (let i = 0; i < answers.length; i++) {
        const q = questionsDb._byId?.[pending.questionIds[i]];
        if (!q) {
          continue;
        }
        const correct = q.a === answers[i].answerIdx;
        if (isCombat && i === 0 && !correct) {
          hasWrongAnswer = true;
        }
        // Include this result only if: no wrong answer yet OR it's the first result (Q1)
        if (!hasWrongAnswer || i === 0) {
          results.push({ chosenIdx: answers[i].answerIdx, correct });
        }
        // For combat: if Q1 wrong, stop processing further answers
        if (isCombat && hasWrongAnswer) {
          break;
        }
      }
    }

    // Only sequential if: partial answers AND no wrong answers (battle not ended)
    const isSequential = pending && !hasWrongAnswer && numSubmitted < pending.questionIds.length;

    // If same peg stays selected (movesRemaining > 0), send valid moves
    const nextValidMoves =
      room.state.phase === PHASE.SELECT_TILE && room.state.selectedPegId
        ? getValidMoves(room.state, room.state.selectedPegId).map(
            (m) => m.r * COORD_BASE + m.c,
          )
        : null;

    // Check if there are more questions to answer (sequential mode)
    const moreQuestionsInProgress = isSequential && !result.gameOver;

    // Include next question in response to attacker if more questions in progress
    let nextQuestion = null;
    if (moreQuestionsInProgress && pending) {
      const nextQIdx = numSubmitted;
      const nextQId = pending.questionIds[nextQIdx];
      const q = questionsDb._byId?.[nextQId];
      if (q) {
        nextQuestion = { id: q.id };
      }
    }

    const payload = {
      events: result.events,
      state: publicState(room.state),
      gameOver: result.gameOver,
      winner: result.winner ?? null,
      results,
      validMoves: nextValidMoves,
      moreQuestionsInProgress,
      nextQuestion,
    };

    // Broadcast updated state to all players
    io.to(code).emit('state:update', payload);
    cb({ ok: true });

    if (result.gameOver) {
      console.log(`[game] ${code} over — winner player ${result.winner}`);
    }
  });

  // --- Quiz ---

  socket.on('quiz:start', (cb) => {
    const allQuestions = Object.values(questionsDb)
      .filter(Array.isArray)
      .flat()
      .filter(q => q.id);

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
    if (!run) return cb({ error: 'Quiz not started' });

    const qId = run.questionIds[run.answers];
    const q = questionsDb._byId[qId];
    if (!q) return cb({ error: 'Question not found' });

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
    if (!run) return cb({ error: 'Quiz not started' });

    const allQuestions = Object.values(questionsDb)
      .filter(Array.isArray)
      .flat()
      .filter(q => q.id);

    const randomQ = allQuestions[Math.floor(Math.random() * allQuestions.length)];
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
    if (!run) return cb({ error: 'No completed run' });

    const timeMs = Date.now() - run.startedAt;
    const top10 = insertScore(name, run.answers, timeMs);
    quizRuns.delete(socket.id);

    cb({ ok: true, top10 });
  });

  socket.on('quiz:leaderboard', (cb) => {
    cb({ ok: true, top10: getTop10() });
  });

  // --- Disconnect ---

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id}`);
    quizRuns.delete(socket.id);
    const { room, player } = removePlayerFromRoom(socket.id);
    if (room && player) {
      io.to(room.code).emit('room:player_left', {
        playerId: socket.id,
        playerName: player.name,
        players: room.players,
      });
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
    pegsToMove: [...state.pegsToMove],
    movesRemaining: state.movesRemaining,
  };
}

httpServer.listen(PORT, () => console.log(`Sraz server :${PORT}`));
