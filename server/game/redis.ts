import { createClient, type RedisClientType } from 'redis';

// Per-environment key namespace. Prod sets SESSION_PREFIX explicitly via .env;
// dev defaults to 'dev:'; e2e sets 'test:' in playwright.config.js webServer.
// Evaluated lazily in initRedis() after dotenv has configured env vars.
export let SESSION_PREFIX = 'dev:';

let client: RedisClientType | null = null;
let ready = false;

export function initRedis(): RedisClientType {
  if (client) {return client;}

  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL environment variable is not set');
  }

  SESSION_PREFIX =
    process.env.SESSION_PREFIX || (process.env.NODE_ENV === 'production' ? 'prod:' : 'dev:');

  client = createClient({ url });

  client.on('error', (err: Error) => {
    console.error('[redis] error:', err.message);
  });

  client.on('ready', () => {
    ready = true;
    console.log(`[redis] ready (prefix=${SESSION_PREFIX})`);
  });

  client.on('end', () => {
    ready = false;
  });

  // Start the connection; connect() resolves on first 'ready'.
  client.connect().catch((err) => {
    console.error('[redis] initial connect failed:', err.message);
  });

  return client;
}

export function getRedisClient(): RedisClientType {
  if (!client) {
    throw new Error('Redis client not initialized — call initRedis() first');
  }
  return client;
}

export function isRedisReady(): boolean {
  return ready;
}

export function waitForRedisReady(timeoutMs = 10_000): Promise<void> {
  const c = getRedisClient();
  return new Promise((resolve, reject) => {
    if (ready) {return resolve();}
    const timer = setTimeout(() => {
      reject(new Error(`Redis not ready within ${timeoutMs}ms`));
    }, timeoutMs);
    c.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
