import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getClientIp,
  isLocalhostIp,
  checkAuthRateLimit,
  applyAuthRateLimit,
} from '../server/game/auth-routes.js';

describe('auth-routes.js helpers', () => {
  describe('getClientIp', () => {
    it('returns direct IP', () => {
      const req = { ip: '192.168.1.1' };
      expect(getClientIp(req)).toBe('192.168.1.1');
    });

    it('strips IPv6-mapped IPv4 prefix', () => {
      const req = { ip: '::ffff:192.168.1.1' };
      expect(getClientIp(req)).toBe('192.168.1.1');
    });

    it('falls back to socket remoteAddress', () => {
      const req = { socket: { remoteAddress: '10.0.0.1' } };
      expect(getClientIp(req)).toBe('10.0.0.1');
    });

    it('returns unknown when no IP available', () => {
      const req = {};
      expect(getClientIp(req)).toBe('unknown');
    });
  });

  describe('isLocalhostIp', () => {
    it('returns true for ::1', () => {
      expect(isLocalhostIp('::1')).toBe(true);
    });

    it('returns true for 127.x.x.x', () => {
      expect(isLocalhostIp('127.0.0.1')).toBe(true);
      expect(isLocalhostIp('127.0.0.2')).toBe(true);
      expect(isLocalhostIp('127.0.1')).toBe(true);
    });

    it('returns false for non-localhost', () => {
      expect(isLocalhostIp('192.168.1.1')).toBe(false);
      expect(isLocalhostIp('10.0.0.1')).toBe(false);
    });
  });

  describe('checkAuthRateLimit', () => {
    it('allows first request', () => {
      // Use random IP to avoid any previous test state
      const result = checkAuthRateLimit('10.' + Math.floor(Math.random() * 255) + '.0.1');
      expect(result).toBe(true);
    });

it('blocks after 5 requests from same IP', () => {
      // Use a unique IP for this test to avoid state pollution from other tests
      const uniqueIp = '192.168.99.' + Math.floor(Math.random() * 255);
      let results = [];
      for (let i = 0; i < 6; i++) {
        results.push(checkAuthRateLimit(uniqueIp));
      }
      // First 5 should be allowed, 6th should be blocked
      expect(results.filter((r) => r === true)).toHaveLength(5);
      expect(results.filter((r) => r === false)).toHaveLength(1);
    });

    it('blocks after rate limit exceeded', () => {
      const ip = '192.168.1.102';
      // Use up the limit
      for (let i = 0; i < 5; i++) {
        checkAuthRateLimit(ip);
      }
      // 6th request should be blocked
      expect(checkAuthRateLimit(ip)).toBe(false);
    });

    it('different IPs are tracked independently', () => {
      // Test that different IPs don't affect each other's limits
      const ip1 = '172.16.' + Math.floor(Math.random() * 255) + '.1';
      const ip2 = '172.16.' + Math.floor(Math.random() * 255) + '.2';

      // Exhaust ip1
      for (let i = 0; i < 5; i++) {
        checkAuthRateLimit(ip1);
      }
      expect(checkAuthRateLimit(ip1)).toBe(false);
      // ip2 should still be allowed
      expect(checkAuthRateLimit(ip2)).toBe(true);
    });

    it('tracks different IPs independently', () => {
      const ip1 = '192.168.1.200';
      const ip2 = '192.168.1.201';

      // Use up ip1
      for (let i = 0; i < 5; i++) {
        checkAuthRateLimit(ip1);
      }
      expect(checkAuthRateLimit(ip1)).toBe(false);
      // ip2 should still be allowed
      expect(checkAuthRateLimit(ip2)).toBe(true);
    });
  });

  describe('applyAuthRateLimit', () => {
    it('allows localhost without rate limit', () => {
      const req = { ip: '::1' };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      const result = applyAuthRateLimit(req, res);
      expect(result).toBe(true);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('allows non-localhost IP', () => {
      const req = { ip: '192.168.50.' + Math.floor(Math.random() * 255) };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      const result = applyAuthRateLimit(req, res);
      expect(result).toBe(true);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('blocks when rate limit exceeded', () => {
      const uniqueIp = '192.168.51.' + Math.floor(Math.random() * 255);
      // Exhaust the limit for this IP
      for (let i = 0; i < 5; i++) {
        checkAuthRateLimit(uniqueIp);
      }

      const req = { ip: uniqueIp };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      const result = applyAuthRateLimit(req, res);
      expect(result).toBe(false);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({ error: 'Too many requests. Please try again later.' });
    });
  });
});