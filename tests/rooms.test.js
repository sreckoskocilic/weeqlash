import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  createRoom,
  joinRoom,
  getRoom,
  removePlayerFromRoom,
  reattachSocket,
} from '../server/game/rooms.ts';

describe('Rooms: createRoom', () => {
  afterEach(() => {
    // Clear rooms after each test
    vi.resetModules();
  });

  it('creates room with default settings', () => {
    const room = createRoom({});
    expect(room.code).toHaveLength(5);
    expect(room.settings.boardSize).toBe(7);
    expect(room.settings.timer).toBe(30);
    expect(room.settings.playerCount).toBe(2);
    expect(room.players).toHaveLength(0);
    expect(room.started).toBe(false);
  });

  it('creates room with custom board size', () => {
    const room = createRoom({ boardSize: 8 });
    expect(room.settings.boardSize).toBe(8);
  });

  it('creates room with custom timer', () => {
    const room = createRoom({ timer: 45 });
    expect(room.settings.timer).toBe(45);
  });

  it('validates board size - defaults to 7 for invalid', () => {
    const room = createRoom({ boardSize: 99 });
    expect(room.settings.boardSize).toBe(7);
  });

  it('accepts valid 2x2 board size', () => {
    const room = createRoom({ boardSize: 2 });
    expect(room.settings.boardSize).toBe(2);
  });

  it('validates timer - defaults to 30 for invalid', () => {
    const room = createRoom({ timer: 99 });
    expect(room.settings.timer).toBe(30);
  });

  it('filters enabledCats to valid categories only', () => {
    const room = createRoom({ enabledCats: ['history', 'invalid_cat', 'geography'] });
    expect(room.settings.enabledCats).toEqual(['history', 'geography']);
  });

  it('sets enabledCats to undefined for empty array', () => {
    const room = createRoom({ enabledCats: [] });
    expect(room.settings.enabledCats).toBeUndefined();
  });

  it('generates unique 5-char codes', () => {
    const room1 = createRoom({});
    const room2 = createRoom({});
    expect(room1.code).not.toBe(room2.code);
  });
});

describe('Rooms: joinRoom', () => {
  it('joins empty room successfully', () => {
    const room = createRoom({});
    const player = joinRoom(room.code, 'socket-1', 'Alice');
    expect(player.name).toBe('Alice');
    expect(player.color).toBe('#FF4444');
    expect(player.isHost).toBe(true);
    expect(player.token).toBeDefined();
  });

  it('assigns different colors to consecutive players', () => {
    const room = createRoom({});
    const p1 = joinRoom(room.code, 'socket-1', 'Alice');
    const p2 = joinRoom(room.code, 'socket-2', 'Bob');
    expect(p1.color).not.toBe(p2.color);
  });

  it('marks second player as non-host', () => {
    const room = createRoom({});
    joinRoom(room.code, 'socket-1', 'Alice');
    const p2 = joinRoom(room.code, 'socket-2', 'Bob');
    expect(p2.isHost).toBe(false);
  });

  it('returns error for invalid room code', () => {
    const result = joinRoom('ABC', 'socket-1', 'Alice');
    expect(result.error).toBe('Invalid room code');
  });

  it('returns error for non-existent room', () => {
    const result = joinRoom('XXXXX', 'socket-1', 'Alice');
    expect(result.error).toBe('Room not found');
  });

  it('returns error if game already started', () => {
    const room = createRoom({});
    joinRoom(room.code, 'socket-1', 'Alice');
    joinRoom(room.code, 'socket-2', 'Bob');
    room.started = true;
    const result = joinRoom(room.code, 'socket-3', 'Charlie');
    expect(result.error).toBe('Game already started');
  });

  it('returns error if room is full', () => {
    const room = createRoom({});
    joinRoom(room.code, 'socket-1', 'Alice');
    joinRoom(room.code, 'socket-2', 'Bob');
    const result = joinRoom(room.code, 'socket-3', 'Charlie');
    expect(result.error).toBe('Room is full');
  });

  it('returns error for empty name', () => {
    const room = createRoom({});
    const result = joinRoom(room.code, 'socket-1', '');
    expect(result.error).toBe('Name must be 1-16 characters');
  });

  it('returns error for name > 16 chars', () => {
    const room = createRoom({});
    const result = joinRoom(room.code, 'socket-1', 'a'.repeat(20));
    expect(result.error).toBe('Name must be 1-16 characters');
  });

  it('handles name collision edge cases', () => {
    const room = createRoom({});
    const p1 = joinRoom(room.code, 'socket-1', 'Alice');
    const p2 = joinRoom(room.code, 'socket-2', 'Alice');
    // Second Alice should get a unique suffix
    expect(p1.name).toBe('Alice');
    expect(p2.name).not.toBe('Alice');
  });

  it('accepts valid room codes case-insensitively', () => {
    const room = createRoom({});
    const player = joinRoom(room.code.toLowerCase(), 'socket-1', 'Alice');
    expect(player.name).toBe('Alice');
  });
});

describe('Rooms: getRoom', () => {
  it('returns room for valid code', () => {
    const room = createRoom({});
    const result = getRoom(room.code);
    expect(result).toBe(room);
  });

  it('returns null for invalid code format', () => {
    expect(getRoom('ABC')).toBeNull();
    expect(getRoom('')).toBeNull();
  });

  it('returns null for non-existent room', () => {
    expect(getRoom('XXXXX')).toBeNull();
  });

  it('handles case-insensitive lookup', () => {
    const room = createRoom({});
    expect(getRoom(room.code.toLowerCase())).toBe(room);
  });
});

describe('Rooms: removePlayerFromRoom', () => {
  it('removes player from room', () => {
    const room = createRoom({});
    joinRoom(room.code, 'socket-1', 'Alice');
    joinRoom(room.code, 'socket-2', 'Bob');
    const result = removePlayerFromRoom('socket-1');
    expect(result.room.players).toHaveLength(1);
    expect(result.player.name).toBe('Alice');
  });

  it('returns empty for non-existent socket', () => {
    const result = removePlayerFromRoom('unknown');
    expect(result.room).toBeUndefined();
    expect(result.player).toBeUndefined();
  });
});

describe('Rooms: reattachSocket', () => {
  it('updates socket to room mapping', () => {
    const room = createRoom({});
    const player = joinRoom(room.code, 'socket-1', 'Alice');
    // Simulate how server/index.js handles reconnection: update player.id first
    player.id = 'new-socket-id';
    reattachSocket('socket-1', 'new-socket-id', room.code);
    const result = removePlayerFromRoom('new-socket-id');
    expect(result.player.name).toBe('Alice');
  });
});
