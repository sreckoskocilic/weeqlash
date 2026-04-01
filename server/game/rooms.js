import { randomUUID } from 'crypto';

// In-memory room store. Each room holds settings, player list, and game state.
const rooms = new Map(); // code -> room
const socketToRoom = new Map(); // socketId -> roomCode

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function createRoom({
  playerCount: playerCountInput,
  boardSize = 7,
  timer = 30,
  enabledCats,
  maxRankStart = false,
} = {}) {
  // Validate and normalize player count
  const VALID_PLAYER_COUNTS = [2, 3, 4];
  let playerCount = 2; // default
  if (VALID_PLAYER_COUNTS.includes(playerCountInput)) {
    playerCount = playerCountInput;
  }

  // Validate board size - only accept valid sizes from UI
  const VALID_SIZES = [1, 2, 4, 5, 6, 7, 8, 10];
  if (!VALID_SIZES.includes(boardSize)) {
    boardSize = 7;
  }

  // For testing: use 1x2 if boardSize is 1 or 2
  if (boardSize === 1 || boardSize === 2) {
    boardSize = 2;
  }

  let code;
  do {
    code = generateCode();
  } while (rooms.has(code));

  const room = {
    code,
    settings: { playerCount, boardSize, timer, enabledCats, maxRankStart },
    players: [],
    started: false,
    state: null,
  };
  rooms.set(code, room);
  return room;
}

export function joinRoom(code, socketId, playerName) {
  const normalizedCode = code?.toUpperCase();
  // Validate room code format
  if (!normalizedCode || normalizedCode.length !== 5 || !/^[A-Z0-9]+$/.test(normalizedCode)) {
    return { error: 'Invalid room code' };
  }

  const room = rooms.get(normalizedCode);
  if (!room) {
    return { error: 'Room not found' };
  }
  if (room.started) {
    return { error: 'Game already started' };
  }
  if (room.players.length >= room.settings.playerCount) {
    return { error: 'Room is full' };
  }

  // Server-side name validation (client also has maxlength="16")
  const name = playerName?.trim();
  if (!name || name.length > 16) {
    return { error: 'Name must be 1-16 characters' };
  }
  if (room.players.find((p) => p.name === name)) {
    return { error: 'Name already taken' };
  }

  const COLORS = ['#FF4444', '#1E88E5', '#43A047', '#FB8C00'];
  const player = {
    id: socketId,
    name: name,
    color: COLORS[room.players.length],
    index: room.players.length,
    isHost: room.players.length === 0,
    token: randomUUID(), // reconnect token, sent only to this player
  };
  room.players.push(player);
  socketToRoom.set(socketId, normalizedCode);
  return player;
}

export function getRoom(code) {
  const normalizedCode = code?.toUpperCase();
  if (!normalizedCode || normalizedCode.length !== 5 || !/^[A-Z0-9]+$/.test(normalizedCode)) {
    return null;
  }
  return rooms.get(normalizedCode) ?? null;
}

export function removePlayerFromRoom(socketId) {
  const code = socketToRoom.get(socketId);
  if (!code) {
    return {};
  }
  const room = rooms.get(code);
  if (!room) {
    return {};
  }

  const player = room.players.find((p) => p.id === socketId);
  room.players = room.players.filter((p) => p.id !== socketId);
  socketToRoom.delete(socketId);

  // Clean up empty rooms after a delay to survive brief reconnects
  if (room.players.length === 0) {
    setTimeout(() => {
      if (rooms.get(code)?.players.length === 0) {
        rooms.delete(code);
      }
    }, 15_000);
  }

  return { room, player };
}
