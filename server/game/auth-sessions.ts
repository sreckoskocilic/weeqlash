import { getRedisClient, SESSION_PREFIX } from './redis.ts';

// Active session index: one entry per logged-in user, mapping userId → sid.
// Existence of this key means "this user is logged in on this sid right now".
// Used to enforce single-session-per-user: on login, the previous sid (if any)
// is destroyed so the older browser loses its session.

function activeSidKey(userId: number): string {
  return `${SESSION_PREFIX}user:activesid:${userId}`;
}

function sessionKey(sid: string): string {
  return `${SESSION_PREFIX}session:${sid}`;
}

export async function setActiveSid(userId: number, sid: string, ttlSec: number): Promise<void> {
  const client = getRedisClient();
  await client.set(activeSidKey(userId), sid, { EX: ttlSec });
}

export async function getActiveSid(userId: number): Promise<string | null> {
  const client = getRedisClient();
  return (await client.get(activeSidKey(userId))) as string | null;
}

export async function clearActiveSid(userId: number): Promise<void> {
  const client = getRedisClient();
  await client.del(activeSidKey(userId));
}

// Directly delete a session record by sid. Equivalent to RedisStore.destroy()
// but callable from anywhere with Redis access.
export async function destroySession(sid: string): Promise<void> {
  const client = getRedisClient();
  await client.del(sessionKey(sid));
}
