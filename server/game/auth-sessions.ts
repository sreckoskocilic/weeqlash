import { getRedisClient, SESSION_PREFIX } from './redis.ts';

// Active-session index (userId → sid) enforcing single-session-per-user: login destroys the previous sid.

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

// Delete a session record by sid (RedisStore.destroy() equivalent, callable anywhere).
export async function destroySession(sid: string): Promise<void> {
  const client = getRedisClient();
  await client.del(sessionKey(sid));
}
