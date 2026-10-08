import { describe, it, expect, beforeAll } from 'vitest';
import './helpers/isolate-db.js';
import { initDb, getDb } from '../server/game/leaderboard.ts';
import { initAuthDb } from '../server/game/auth.ts';
import { createRoom, createQlasRoom } from '../server/game/rooms.ts';
import { createChallenge, finishP1 } from '../server/game/howhigh-store.ts';
import { findInvite, withInviteMeta } from '../server/game/invite.ts';

const host = (name) => ({
  id: 's1',
  name,
  color: '#fff',
  index: 0,
  isHost: true,
  userId: null,
});

beforeAll(() => {
  initDb();
  initAuthDb();
});

describe('findInvite', () => {
  it('names the host and game of an open room', () => {
    const room = createQlasRoom();
    room.players.push(host('skocho'));
    expect(findInvite(room.code.toLowerCase())).toMatchObject({
      game: 'qlashique',
      host: 'skocho',
      title: 'skocho invites you to Qlashique',
    });
  });

  it('treats rooms without a mode as Brawl', () => {
    const room = createRoom({ playerCount: 3 });
    room.players.push(host('mira'));
    expect(findInvite(room.code).game).toBe('brawl');
  });

  it('returns null once the room is full or started', () => {
    const full = createQlasRoom();
    full.players.push(host('a'), { ...host('b'), index: 1 });
    const started = createRoom();
    started.players.push(host('c'));
    started.started = true;
    expect(findInvite(full.code)).toBeNull();
    expect(findInvite(started.code)).toBeNull();
  });

  it('shows the score to beat for a waiting HowHigh challenge', () => {
    const p1 = Number(
      getDb()
        .prepare(
          `INSERT INTO users (username, email, password_hash, email_confirmed, created_at, games_played, games_won)
           VALUES ('inv_p1', 'inv_p1@test.invalid', 'hash', 1, ?, 0, 0)`,
        )
        .run(Date.now()).lastInsertRowid,
    );
    const code = createChallenge(p1, ['q1'], ['e1'], { die1: 1, die2: 2 }, 'dice', 'go_wild');
    expect(findInvite(code)).toBeNull();
    finishP1(code, 18, ['correct'], false, false, 1000);
    expect(findInvite(code)).toMatchObject({ game: 'howhigh', host: 'inv_p1' });
    expect(findInvite(code).description).toContain('Score to beat: 18');
  });

  it('returns null for unknown or malformed codes', () => {
    expect(findInvite('ZZZZZ')).toBeNull();
    expect(findInvite('<script>')).toBeNull();
  });
});

describe('withInviteMeta', () => {
  const html = `<head>
    <meta property="og:title" content="wQ$x — trivia games" />
    <meta
      property="og:description"
      content="default"
    />
    <meta name="twitter:title" content="wQ$x — trivia games" />
  </head>`;

  it('rewrites the preview tags and escapes the host name', () => {
    const out = withInviteMeta(html, {
      game: 'brawl',
      host: '<b>"x"</b>',
      title: '<b>"x"</b> invites you to Weeqlash Brawl',
      description: 'Room ABCDE is waiting',
    });
    expect(out).toContain(
      'content="&lt;b&gt;&quot;x&quot;&lt;/b&gt; invites you to Weeqlash Brawl"',
    );
    expect(out).toContain('content="Room ABCDE is waiting"');
    expect(out).toContain('<meta name="wq-invite-game" content="brawl" />');
    expect(out).toContain(
      '<meta name="wq-invite-host" content="&lt;b&gt;&quot;x&quot;&lt;/b&gt;" />',
    );
    expect(out).not.toContain('<b>');
  });

  it('keeps `$` in a host name literal instead of a replacement pattern', () => {
    const out = withInviteMeta(html, {
      game: 'brawl',
      host: "$'$`$&",
      title: "$'$`$& invites you to Weeqlash Brawl",
      description: 'Room ABCDE is waiting',
    });
    expect(out).toContain('content="$&#39;$`$&amp; invites you to Weeqlash Brawl"');
    expect(out).toContain('<meta name="wq-invite-host" content="$&#39;$`$&amp;" />');
  });
});
