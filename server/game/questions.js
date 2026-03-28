// Loads questions.enc from srazique public repo (or local path via env),
// decrypts them, and builds a _byId index for O(1) lookup.

import fs from 'fs';
import path from 'path';

const KEY = Buffer.from('SraziqueQuestions2024', 'utf8');

function decrypt(base64) {
  const enc = Buffer.from(base64, 'base64');
  const dec = Buffer.alloc(enc.length);
  for (let i = 0; i < enc.length; i++) dec[i] = enc[i] ^ KEY[i % KEY.length];
  return dec.toString('utf8');
}

export function loadQuestions(encPath) {
  const resolved = encPath || process.env.QUESTIONS_PATH ||
    path.resolve(import.meta.dirname, '../questions.enc');

  if (!fs.existsSync(resolved)) {
    throw new Error(`questions.enc not found at ${resolved}`);
  }

  const raw  = fs.readFileSync(resolved, 'utf8');
  const data = JSON.parse(decrypt(raw));

  // Build O(1) id lookup (include category for client display)
  data._byId = {};
  for (const [cat, qs] of Object.entries(data)) {
    if (!Array.isArray(qs)) continue;
    for (const q of qs) {
      if (q.id) data._byId[q.id] = { ...q, category: cat };
    }
  }

  const total = Object.values(data)
    .filter(Array.isArray)
    .reduce((n, qs) => n + qs.length, 0);

  console.log(`[questions] loaded ${total} questions`);
  return data;
}
