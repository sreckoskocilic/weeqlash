import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import './helpers/isolate-db.js';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import { app, httpServer } from '../server/index.js';
import { createUser } from '../server/game/auth.ts';
import { getRedisClient, waitForRedisReady } from '../server/game/redis.ts';
import { loadQuestions } from '../server/game/questions.ts';
import { COORD_BASE } from '../server/game/engine.ts';
import * as skipnot from '../server/game/skipnot.ts';

// Drives the real socket handlers end to end: answer secrecy, the board answer lock,
// leaving a 3-player board, server-side timing in solo modes, and Redis outages.

const PASSWORD = 'testpass123';
const PREFIX = `sock_${process.pid}_`;
const ANSWER_KEYS = ['a', 'correctIdx', 'answer'];

let port;
let qdb;
const clients = [];
let userSeq = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (sock, event, payload) =>
  payload === undefined
    ? sock.timeout(3000).emitWithAck(event)
    : sock.timeout(3000).emitWithAck(event, payload);
const next = (sock, event) =>
  new Promise((resolve) => {
    sock.once(event, resolve);
  });

function expectNoAnswer(value) {
  if (Array.isArray(value)) {
    value.forEach(expectNoAnswer);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      expect(ANSWER_KEYS, `answer field "${k}" sent to client`).not.toContain(k);
      expectNoAnswer(v);
    }
  }
}

async function player() {
  const username = `${PREFIX}${userSeq++}`;
  const created = await createUser({
    username,
    email: `${username}@test.invalid`,
    password: PASSWORD,
    autoConfirm: true,
  });
  expect(created.ok).toBe(true);
  const res = await request(app).post('/auth/login').send({ username, password: PASSWORD });
  expect(res.status).toBe(200);
  const cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  const sock = connect(`http://127.0.0.1:${port}`, { extraHeaders: { cookie }, forceNew: true });
  clients.push(sock);
  await new Promise((resolve, reject) => {
    sock.once('connect', resolve);
    sock.once('connect_error', reject);
  });
  sock.username = username;
  return sock;
}

// Room create → join(s) → start; resolves with the room code and the initial game state.
async function startBoard(host, guests) {
  const created = await call(host, 'room:create', {
    playerName: host.username,
    playerCount: guests.length + 1,
    boardSize: 4,
    timer: 30,
  });
  expect(created.ok).toBe(true);
  for (const g of guests) {
    expect((await call(g, 'room:join', { code: created.code, playerName: g.username })).ok).toBe(
      true,
    );
  }
  await sleep(1100); // lobby rate limit between room:create and room:start
  const started = next(guests[0], 'game:start');
  expect((await call(host, 'room:start', { code: created.code })).ok).toBe(true);
  const { state } = await started;
  return { code: created.code, state };
}

// Current player (index 0) picks a peg and a tile; returns the question ack.
async function openQuestion(sock, code, state) {
  const pegId = state.players[0].pegIds[0];
  const sel = await call(sock, 'action:select_peg', { code, pegId });
  expect(sel.ok).toBe(true);
  const target = sel.validMoves[0];
  const r = Math.floor(target / COORD_BASE);
  const c = target % COORD_BASE;
  const tile = await call(sock, 'action:select_tile', { code, pegId, r, c });
  expect(tile.ok).toBe(true);
  return { pegId, r, c, tile };
}

beforeAll(async () => {
  await waitForRedisReady(10_000);
  qdb = loadQuestions();
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  port = httpServer.address().port;
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  for (const sock of clients) {
    sock.disconnect();
  }
  await new Promise((resolve) => httpServer.close(resolve));
});

describe('board: answers are graded on the server', () => {
  it('never sends the answer, and the first answer per question is final', async () => {
    const a = await player();
    const b = await player();
    const { code, state } = await startBoard(a, [b]);

    const spectatorQ = next(b, 'game:question_start');
    const { pegId, r, c, tile } = await openQuestion(a, code, state);
    expectNoAnswer(tile.question);
    expectNoAnswer((await spectatorQ).question);

    const right = qdb._byId[tile.question.id].a;
    const wrong = (right + 1) % 4;

    expect(
      await call(b, 'turn:answer_preview', { code, questionIdx: 0, answerIdx: wrong }),
    ).toEqual({ error: 'Not your turn' });

    const seen = next(b, 'game:answer_preview');
    expect(
      await call(a, 'turn:answer_preview', { code, questionIdx: 0, answerIdx: wrong }),
    ).toEqual({ ok: true, correct: false });
    expect(await seen).toEqual({ questionIdx: 0, answerIdx: wrong, correct: false });

    await sleep(250); // preview rate limit
    expect(
      await call(a, 'turn:answer_preview', { code, questionIdx: 0, answerIdx: right }),
    ).toEqual({ error: 'Already answered' });
    expect(await call(a, 'action:select_peg', { code, pegId })).toEqual({
      error: 'Already answered',
    });

    const submit = (answerIdx) =>
      call(a, 'turn:submit', { code, submission: { pegId, targetR: r, targetC: c, answerIdx } });
    expect(await submit(right)).toEqual({ error: 'Already answered' });
    await sleep(550); // submit rate limit
    const update = next(b, 'state:update');
    expect(await submit(wrong)).toEqual({ ok: true });
    const { events } = await update;
    expect(events.find((e) => e.type === 'answer')?.correct).toBe(false);
  });
});

describe('board: a player who leaves is out', () => {
  it('drops the leaver and passes the turn on in a 3-player game', async () => {
    const a = await player();
    const b = await player();
    const c = await player();
    const { state } = await startBoard(a, [b, c]);
    expect(state.currentPlayerIdx).toBe(0);

    const notice = next(b, 'game:player_disconnected');
    a.emit('room:leave');
    const { state: after, interrupted } = await notice;

    expect(interrupted).toBe(true);
    expect(after.phase).not.toBe('gameOver');
    expect(after.currentPlayerIdx).toBe(1);
    expect(after.players[0].pegIds).toEqual([]);
    expect(Object.values(after.pegs).some((p) => p.playerId === 0)).toBe(false);
  });
});

describe('SkipNoT: one question at a time, timed by the server', () => {
  it('serves questions without answers, counts late answers as timeouts, and ranks on server time', async () => {
    const s = await player();
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.now();

    const start = await call(s, 'skipnot:start');
    expect(start.ok).toBe(true);
    expect(start.question.index).toBe(0);
    expect(start.questions).toBeUndefined();
    expectNoAnswer(start);

    vi.setSystemTime(t0 + 1000);
    const first = await call(s, 'skipnot:answer', { id: start.question.id, optionIdx: 0 });
    expect(typeof first.correct).toBe('boolean');

    const q2 = await call(s, 'skipnot:next');
    expect(q2.question.index).toBe(1);
    expectNoAnswer(q2);

    vi.setSystemTime(t0 + 1000 + skipnot.TIMER_MS + 2500);
    expect(await call(s, 'skipnot:answer', { id: q2.question.id, optionIdx: 0 })).toEqual({
      ok: true,
      timedOut: true,
    });
    expect(await call(s, 'skipnot:answer', { id: q2.question.id, optionIdx: 0 })).toEqual({
      error: 'Out of sequence',
    });

    const done = await call(s, 'skipnot:finish');
    // 1s + one capped timer + 18 never-served questions at a full timer each.
    expect(done.timeMs).toBe(1000 + skipnot.TIMER_MS + 18 * skipnot.TIMER_MS);
  });
});

describe('HowHigh: bonus decision comes before the next question', () => {
  it('refuses the next question while the bonus offer is open', async () => {
    const h = await player();
    let res = await call(h, 'howhigh:start');
    expect(res.ok).toBe(true);
    expect(res.questions).toBeUndefined();
    expectNoAnswer(res);

    let q = res.question;
    for (let i = 0; i < 3; i++) {
      res = await call(h, 'howhigh:answer', { id: q.id, optionIdx: 0 });
      expect(res.ok).toBe(true);
      if (i < 2) {
        const n = await call(h, 'howhigh:next');
        expectNoAnswer(n);
        q = n.question;
      }
    }
    expect(['dice_offer', 'don_offer']).toContain(res.nextEvent);
    expect(await call(h, 'howhigh:next')).toEqual({ error: 'Decide the bonus first' });

    const respond = res.nextEvent === 'dice_offer' ? 'howhigh:dice_respond' : 'howhigh:don_respond';
    expect((await call(h, respond, { accept: false })).ok).toBe(true);
    const after = await call(h, 'howhigh:next');
    expect(after.question.index).toBe(3);
    expectNoAnswer(after);
  });
});

describe('Redis outage', () => {
  it('answers 503 straight away instead of hanging, then recovers', async () => {
    const redis = getRedisClient();
    redis.emit('reconnecting');
    try {
      const health = await request(app).get('/healthz').timeout(2000);
      expect(health.status).toBe(503);
      expect(health.body.redis).toBe(false);
      const me = await request(app).get('/auth/me').timeout(2000);
      expect(me.status).toBe(503);
    } finally {
      redis.emit('ready');
    }
    expect((await request(app).get('/healthz')).status).toBe(200);
  });
});
