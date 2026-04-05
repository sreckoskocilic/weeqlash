import { randomUUID } from 'crypto';
import { CATS } from './engine.js';

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
  playerCount = 2,
  boardSize = 7,
  timer = 30,
  enabledCats,
  maxRankStart = false,
} = {}) {
  // Validate player count (engine supports 2-4)
  const PLAYER_COUNT = Math.max(2, Math.min(4, playerCount));

  // Validate board size - only accept valid sizes from UI
  const VALID_SIZES = [4, 5, 6, 7, 8, 10];
  if (!VALID_SIZES.includes(boardSize)) {
    boardSize = 7;
  }

  // Validate timer
  const VALID_TIMERS = [15, 30, 45];
  if (!VALID_TIMERS.includes(timer)) {
    timer = 30;
  }

  // Validate enabledCats — filter out any values not in the known category list
  if (Array.isArray(enabledCats)) {
    enabledCats = enabledCats.filter((c) => CATS.includes(c));
    if (enabledCats.length === 0) {enabledCats = undefined;}
  } else {
    enabledCats = undefined;
  }

  let code;
  do {
    code = generateCode();
  } while (rooms.has(code));

  const room = {
    code,
    settings: { playerCount: PLAYER_COUNT, boardSize, timer, enabledCats, maxRankStart },
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

  // Auto-resolve name collisions by appending a number
  let finalName = name;
  let counter = 1;
  while (room.players.find((p) => p.name === finalName)) {
    finalName = `${name} ${counter}`;
    counter++;
  }

  const COLORS = ['#FF4444', '#1E88E5', '#43A047', '#FB8C00'];
  const player = {
    id: socketId,
    name: finalName,
    color: COLORS[room.players.length % COLORS.length],
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

export function reattachSocket(oldSocketId, newSocketId, code) {
  socketToRoom.delete(oldSocketId);
  socketToRoom.set(newSocketId, code);
}

// Periodic cleanup of orphaned rooms (empty lobby rooms, abandoned games).
// Returns the number of rooms removed.
export function cleanupStaleRooms() {
  let removed = 0;
  const toDelete = [];

  for (const [code, room] of rooms) {
    // Empty rooms — always safe to remove
    if (room.players.length === 0) {
      toDelete.push(code);
      continue;
    }

    // Abandoned games: all players disconnected but room still has stale state
    const hasActiveSocket = room.players.some((p) => socketToRoom.has(p.id));
    if (room.started && !hasActiveSocket) {
      toDelete.push(code);
    }
  }

  for (const code of toDelete) {
    rooms.delete(code);
    removed++;
  }

  return removed;
}

// Check if a socket ID belongs to a player in an active (started) game.
export function isInActiveGame(socketId) {
  for (const room of rooms.values()) {
    if (room.started && room.players.some((p) => p.id === socketId)) {
      return true;
    }
  }
  return false;
}
