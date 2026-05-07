import { request } from '@playwright/test';

const BASE = 'http://localhost:3000';

export default async function globalTeardown() {
  const api = await request.newContext({ baseURL: BASE });
  await api.post('/test/clear-all').catch(() => {});
  await api.post('/test/setup-users').catch(() => {});
  await api.dispose();
}
