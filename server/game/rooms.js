import { randomUUID } from 'crypto';

// In-memory room store. Each room holds settings, player list, and game state.
const rooms = new Map(); // code -> room
const socketToRoom = new Map(); // socketId -> roomCode

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function createRoom({ playerCount = 2, boardSize = 7, timer = 30 } = {}) {
  let code;
  do { code = generateCode(); } while (rooms.has(code));

  const room = {
    code,
    settings: { playerCount, boardSize, timer },
    players: [],
    started: false,
    state: null
  };
  rooms.set(code, room);
  return room;
}

export function joinRoom(code, socketId, playerName) {
  const room = rooms.get(code?.toUpperCase());
  if (!room) return { error: 'Room not found' };
  if (room.started) return { error: 'Game already started' };
  if (room.players.length >= room.settings.playerCount) return { error: 'Room is full' };
  if (room.players.find(p => p.name === playerName)) return { error: 'Name already taken' };

  const COLORS = ['#e94560', '#0f3460', '#533483', '#05c46b'];
  const player = {
    id:     socketId,
    name:   playerName,
    color:  COLORS[room.players.length],
    index:  room.players.length,
    isHost: room.players.length === 0,
    token:  randomUUID(),   // reconnect token, sent only to this player
  };
  room.players.push(player);
  socketToRoom.set(socketId, code.toUpperCase());
  return player;
}

export function getRoom(code) {
  return rooms.get(code?.toUpperCase()) ?? null;
}

export function getRoomBySocket(socketId) {
  const code = socketToRoom.get(socketId);
  return code ? rooms.get(code) : null;
}

export function removePlayerFromRoom(socketId) {
  const code = socketToRoom.get(socketId);
  if (!code) return {};
  const room = rooms.get(code);
  if (!room) return {};

  const player = room.players.find(p => p.id === socketId);
  room.players = room.players.filter(p => p.id !== socketId);
  socketToRoom.delete(socketId);

  // Clean up empty rooms
  if (room.players.length === 0) {
    rooms.delete(code);
  }

  return { room, player };
}
