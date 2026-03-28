import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

import { createRoom, joinRoom, getRoom, removePlayerFromRoom } from './game/rooms.js';
import { createGame, selectPeg, planTurnQuestions, applyTurn, getValidMoves, PHASE } from './game/engine.js';
import { loadQuestions } from './game/questions.js';

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, { cors: { origin: 'https://sraz.nbastables.com' } });
const PORT       = process.env.PORT || 3000;

// Load questions once at startup
const questionsDb = loadQuestions();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roomOf(socketId) {
  const code = [...io.sockets.adapter.rooms.keys()]
    .find(k => {
      const room = getRoom(k);
      return room?.players.some(p => p.id === socketId);
    });
  return code ? getRoom(code) : null;
}

function currentPlayerId(room) {
  return room.state?.players[room.state.currentPlayerIdx]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  // --- Lobby ---

  socket.on('room:create', ({ playerName, playerCount, boardSize, timer }, cb) => {
    const room   = createRoom({ playerCount, boardSize, timer });
    const player = joinRoom(room.code, socket.id, playerName);
    if (!player) return cb({ error: 'Failed to create room' });
    socket.join(room.code);
    console.log(`[room] ${room.code} created by ${playerName}`);
    const token = room.players.find(p => p.id === socket.id)?.token;
    cb({ ok: true, code: room.code, playerId: socket.id, players: room.players, token });
  });

  socket.on('room:join', ({ code, playerName }, cb) => {
    const result = joinRoom(code, socket.id, playerName);
    if (result.error) return cb(result);
    const room = getRoom(code);
    socket.join(code);
    socket.to(code).emit('room:player_joined', { players: room.players });
    const token = room.players.find(p => p.id === socket.id)?.token;
    cb({ ok: true, playerId: socket.id, players: room.players, settings: room.settings, token });
    if (room.players.length === room.settings.playerCount) {
      io.to(code).emit('room:full', { players: room.players });
    }
  });

  socket.on('room:start', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room)                            return cb({ error: 'Room not found' });
    if (room.players[0].id !== socket.id) return cb({ error: 'Only host can start' });
    if (room.players.length < 2)          return cb({ error: 'Need at least 2 players' });
    if (room.started)                     return cb({ error: 'Already started' });

    room.started = true;
    room.state   = createGame(room.players, room.settings);
    console.log(`[game] ${code} started (${room.players.length}p, board ${room.settings.boardSize})`);

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
    if (!room || !room.started) return cb({ error: 'Room not found or not started' });
    const player = room.players.find(p => p.token === token);
    if (!player) return cb({ error: 'Invalid session token' });

    player.id = socket.id; // re-attach new socket id
    socket.join(code);
    console.log(`[reconnect] ${player.name} re-joined ${code}`);
    cb({ ok: true, playerId: socket.id, state: publicState(room.state), players: room.players });
  });

  // --- Game actions ---

  socket.on('action:select_peg', ({ code, pegId }, cb) => {
    const room = getRoom(code);
    if (!room?.state) return cb({ error: 'No active game' });

    const player = room.players.find(p => p.id === socket.id);
    if (!player)   return cb({ error: 'Not in this room' });

    const result = selectPeg(room.state, player.index, pegId);
    if (result.error) return cb(result);

    cb({ ok: true, validMoves: result.validMoves });
  });

  socket.on('action:select_tile', ({ code, pegId, r, c }, cb) => {
    const room = getRoom(code);
    if (!room?.state) return cb({ error: 'No active game' });

    const player = room.players.find(p => p.id === socket.id);
    if (!player)    return cb({ error: 'Not in this room' });

    // Validate it's a legal move before planning questions
    const validMoves = getValidMoves(room.state, pegId).map(m => m.r * 100 + m.c);
    if (!validMoves.includes(r * 100 + c)) return cb({ error: 'Invalid move target' });

    const { moveType, questionIds } = planTurnQuestions(room.state, pegId, r, c, questionsDb);
    cb({ ok: true, moveType, questionIds });
  });

  socket.on('turn:submit', ({ code, submission }, cb) => {
    const room = getRoom(code);
    if (!room?.state) return cb({ error: 'No active game' });

    const player = room.players.find(p => p.id === socket.id);
    if (!player)   return cb({ error: 'Not in this room' });

    const result = applyTurn(room.state, player.index, submission, questionsDb);
    if (result.error) return cb(result);

    const payload = {
      events:   result.events,
      state:    publicState(room.state),
      gameOver: result.gameOver,
      winner:   result.winner ?? null,
    };

    // Broadcast updated state to all players
    io.to(code).emit('state:update', payload);
    cb({ ok: true });

    if (result.gameOver) {
      console.log(`[game] ${code} over — winner player ${result.winner}`);
    }
  });

  // --- Disconnect ---

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id}`);
    const { room, player } = removePlayerFromRoom(socket.id);
    if (room && player) {
      io.to(room.code).emit('room:player_left', {
        playerId:   socket.id,
        playerName: player.name,
        players:    room.players,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Strip server-only fields before sending state to clients
function publicState(state) {
  return {
    boardSize:        state.boardSize,
    board:            state.board,
    pegs:             state.pegs,
    players:          state.players,
    numPlayers:       state.numPlayers,
    currentPlayerIdx: state.currentPlayerIdx,
    phase:            state.phase,
    selectedPegId:    state.selectedPegId,
    winner:           state.winner,
    // usedQ and pendingTurn stay server-side
  };
}

httpServer.listen(PORT, () => console.log(`Sraz server :${PORT}`));
