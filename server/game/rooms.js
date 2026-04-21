import { randomUUID } from 'crypto';
import { CATS } from './engine.js';

// In-memory room store. Each room holds settings, player list, and game state.
export const rooms = new Map(); // code -> room
export const socketToRoom = new Map(); // socketId -> roomCode
// O(1) lookup for sockets in active games (avoids iterating all rooms on quiz start)
export const socketsInActiveGames = new Set();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function createRoom({ playerCount = 2, boardSize = 7, timer = 30, enabledCats } = {}) {
  // Validate player count (engine supports 2-4)
  const PLAYER_COUNT = Math.max(2, Math.min(4, playerCount));

  // Validate board size - only accept valid sizes from UI
  const VALID_SIZES = [2, 4, 5, 6, 7, 8, 10];
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
    if (enabledCats.length === 0) {
      enabledCats = undefined;
    }
  } else {
    enabledCats = undefined;
  }

  let code;
  do {
    code = generateCode();
  } while (rooms.has(code));

  const room = {
    code,
    settings: { playerCount: PLAYER_COUNT, boardSize, timer, enabledCats },
    players: [],
    playersBySocket: new Map(), // O(1) socketId -> player lookup
    started: false,
    startedAt: null,
    state: null,
  };
  rooms.set(code, room);
  return room;
}

export function joinRoom(code, socketId, playerName, userId = null) {
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
    userId, // linked user account (null for guest)
  };
  room.players.push(player);
  room.playersBySocket.set(socketId, player); // O(1) lookup
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

  // Use O(1) Map lookup instead of find
  const player = room.playersBySocket.get(socketId);
  if (player) {
    room.playersBySocket.delete(socketId);
  }
  room.players = room.players.filter((p) => p.id !== socketId);
  socketToRoom.delete(socketId);

  // Clean up empty rooms after a delay to survive brief reconnects
  // Use captured values to avoid race condition: check room exists AND is empty at execution time
  if (room.players.length === 0) {
    const codeToCheck = code;
    setTimeout(() => {
      const existingRoom = rooms.get(codeToCheck);
      if (existingRoom && existingRoom.players.length === 0) {
        console.log(`[room] cleaning up empty room ${codeToCheck}`);
        rooms.delete(codeToCheck);
      }
    }, 15_000);
  }

  return { room, player };
}

export function reattachSocket(oldSocketId, newSocketId, code) {
  socketToRoom.delete(oldSocketId);
  socketToRoom.set(newSocketId, code);
  // Also update the player lookups
  const room = rooms.get(code);
  if (room) {
    const player = room.playersBySocket.get(oldSocketId);
    if (player) {
      room.playersBySocket.delete(oldSocketId);
      player.id = newSocketId;
      room.playersBySocket.set(newSocketId, player);
    }
  }
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

export function createQlasRoom() {
  let code;
  do {
    code = generateCode();
  } while (rooms.has(code));

  const room = {
    code,
    mode: 'qlashique',
    settings: { playerCount: 2 },
    players: [],
    playersBySocket: new Map(),
    started: false,
    startedAt: null,
    state: null,
    classSelections: [null, null],
    usedQIds: new Set(),
    currentQuestion: null,
    questionIdx: 0,
  };
  rooms.set(code, room);
  return room;
}

// Check if a socket ID belongs to a player in an active (started) game.
// Uses O(1) Set lookup instead of iterating all rooms.
export function isInActiveGame(socketId) {
  return socketsInActiveGames.has(socketId);
}

// Track socket as being in an active game (called when room starts)
export function registerActiveSocket(socketId) {
  socketsInActiveGames.add(socketId);
}

// Remove socket from active game tracking (called on disconnect)
export function unregisterActiveSocket(socketId) {
  socketsInActiveGames.delete(socketId);
}

export function getPlayerBySocket(room, socketId) {
  return room.playersBySocket?.get(socketId) ?? room.players.find((p) => p.id === socketId);
}
