import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadQuestions, getAllQuestions, getQuestionsForCategories } from '../server/game/questions.js';

// Helper to XOR-encrypt data (matches questions.js decrypt logic)
function encrypt(data) {
  const KEY = Buffer.from(process.env.QUESTIONS_KEY, 'utf8');
  const json = JSON.stringify(data);
  const buf = Buffer.from(json, 'utf8');
  const enc = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    enc[i] = buf[i] ^ KEY[i % KEY.length];
  }
  return enc.toString('base64');
}

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'questions-test-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('questions.js', () => {
  describe('loadQuestions', () => {
    it('loads and decrypts questions from file', () => {
      const data = {
        History: [
          { id: 'H1', q: 'Who was first US president?', a: 0, opts: ['Washington', 'Lincoln', 'Adams', 'Jefferson'] },
          { id: 'H2', q: 'Year of US independence?', a: 2, opts: ['1776', '1789', '1783', '1775'] },
        ],
        Science: [
          { id: 'S1', q: 'H2O is?', a: 1, opts: ['Gold', 'Water', 'Air', 'Salt'] },
        ],
      };
      const encPath = path.join(tempDir, 'questions.enc');
      fs.writeFileSync(encPath, encrypt(data));

      const db = loadQuestions(encPath);

      expect(db._byId).toBeDefined();
      expect(db._byId.H1).toEqual({
        id: 'H1',
        q: 'Who was first US president?',
        a: 0,
        opts: ['Washington', 'Lincoln', 'Adams', 'Jefferson'],
        category: 'History',
      });
      expect(db._byId.S1).toEqual({
        id: 'S1',
        q: 'H2O is?',
        a: 1,
        opts: ['Gold', 'Water', 'Air', 'Salt'],
        category: 'Science',
      });
    });

    it('throws when file not found', () => {
      expect(() => loadQuestions('/nonexistent/path')).toThrow('questions.enc not found');
    });

    it('throws when encrypted data is invalid JSON', () => {
      const encPath = path.join(tempDir, 'questions.enc');
      // Write base64 of "not valid json" (will fail XOR decryption to valid JSON)
      fs.writeFileSync(encPath, Buffer.from('not valid json').toString('base64'));
      expect(() => loadQuestions(encPath)).toThrow();
    });
  });

  describe('getAllQuestions', () => {
    it('returns flat array of all questions', () => {
      const data = {
        History: [
          { id: 'H1', q: 'Q1', a: 0, opts: ['A', 'B', 'C', 'D'] },
          { id: 'H2', q: 'Q2', a: 1, opts: ['A', 'B', 'C', 'D'] },
        ],
        Science: [
          { id: 'S1', q: 'Q3', a: 2, opts: ['A', 'B', 'C', 'D'] },
        ],
      };
      const dataWithId = { ...data, _byId: {} };
      for (const cat of Object.keys(data)) {
        for (const q of data[cat]) {
          dataWithId._byId[q.id] = { ...q, category: cat };
        }
      }

      const all = getAllQuestions(dataWithId);
      expect(all).toHaveLength(3);
      expect(all.map((q) => q.id)).toEqual(['H1', 'H2', 'S1']);
    });

    it('returns empty array when no questions', () => {
      const empty = { _byId: {} };
      expect(getAllQuestions(empty)).toHaveLength(0);
    });

    it('caches result per db object', () => {
      const data = {
        History: [{ id: 'H1', q: 'Q1', a: 0, opts: ['A', 'B', 'C', 'D'] }],
        _byId: { H1: { id: 'H1', category: 'History' } },
      };

      const all1 = getAllQuestions(data);
      const all2 = getAllQuestions(data);
      expect(all1).toBe(all2); // Same object (cached)
    });
  });

  describe('getQuestionsForCategories', () => {
    it('returns questions filtered by category', () => {
      const data = {
        History: [
          { id: 'H1', q: 'Q1', a: 0, opts: ['A', 'B', 'C', 'D'] },
          { id: 'H2', q: 'Q2', a: 1, opts: ['A', 'B', 'C', 'D'] },
        ],
        Science: [
          { id: 'S1', q: 'Q3', a: 2, opts: ['A', 'B', 'C', 'D'] },
        ],
        _byId: {},
      };
      for (const cat of ['History', 'Science']) {
        for (const q of data[cat]) {
          data._byId[q.id] = { ...q, category: cat };
        }
      }

      const history = getQuestionsForCategories(data, ['History']);
      expect(history).toHaveLength(2);

      const science = getQuestionsForCategories(data, ['Science']);
      expect(science).toHaveLength(1);
    });

    it('handles multiple categories', () => {
      const data = {
        History: [{ id: 'H1', q: 'Q1', a: 0, opts: ['A', 'B', 'C', 'D'] }],
        Science: [{ id: 'S1', q: 'Q2', a: 1, opts: ['A', 'B', 'C', 'D'] }],
        Sports: [{ id: 'SP1', q: 'Q3', a: 2, opts: ['A', 'B', 'C', 'D'] }],
        _byId: {},
      };
      for (const cat of ['History', 'Science', 'Sports']) {
        for (const q of data[cat]) {
          data._byId[q.id] = { ...q, category: cat };
        }
      }

      const both = getQuestionsForCategories(data, ['History', 'Science']);
      expect(both).toHaveLength(2);
    });

    it('returns empty for unknown category', () => {
      const data = {
        History: [{ id: 'H1', q: 'Q1', a: 0, opts: ['A', 'B', 'C', 'D'] }],
        _byId: { H1: { id: 'H1', category: 'History' } },
      };

      const unknown = getQuestionsForCategories(data, ['Unknown']);
      expect(unknown).toHaveLength(0);
    });

    it('caches results per category key', () => {
      const data = {
        History: [{ id: 'H1', q: 'Q1', a: 0, opts: ['A', 'B', 'C', 'D'] }],
        _byId: { H1: { id: 'H1', category: 'History' } },
      };

      const r1 = getQuestionsForCategories(data, ['History']);
      const r2 = getQuestionsForCategories(data, ['History']);
      expect(r1).toBe(r2); // Same object (cached)
    });
  });
});
