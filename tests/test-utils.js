// Shared test utilities for weeqlash tests

import { CATS } from '../server/game/engine.js';

/**
 * Create a mock questions database for testing
 * @returns {Object} Mock questions database with _byId lookup
 */
export function createQuestionsDb() {
  const q = {};
  for (const cat of CATS) {
    q[cat] = [
      {
        id: `${cat}_1`,
        a: 0,
        q: 'Test?',
        opts: ['A', 'B', 'C', 'D'],
        category: cat,
      },
      {
        id: `${cat}_2`,
        a: 1,
        q: 'Test2?',
        opts: ['A', 'B', 'C', 'D'],
        category: cat,
      },
      {
        id: `${cat}_3`,
        a: 2,
        q: 'Test3?',
        opts: ['A', 'B', 'C', 'D'],
        category: cat,
      },
    ];
  }
  q._byId = {};
  for (const cat of CATS) {
    for (const qq of q[cat]) {
      q._byId[qq.id] = qq;
    }
  }
  return q;
}

/**
 * Create a sparse questions database for testing specific overrides
 * @param {Object} overrides - Category to questions mapping
 * @returns {Object} Mock questions database with _byId lookup
 */
export function createSparseQuestionsDb(overrides = {}) {
  const q = Object.fromEntries(CATS.map((cat) => [cat, []]));
  for (const [cat, questions] of Object.entries(overrides)) {
    q[cat] = questions;
  }
  q._byId = {};
  for (const cat of CATS) {
    for (const qq of q[cat]) {
      q._byId[qq.id] = qq;
    }
  }
  return q;
}

export { createQuestionsDb as createMockQuestionsDb };
