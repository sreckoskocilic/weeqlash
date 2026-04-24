import path from 'path';
import {
  createUser,
  authenticateUser,
  confirmEmail,
  createResetToken,
  resetPassword,
  resendConfirmation,
  getUserById,
  getUserStats,
} from './auth.ts';
import type { Transporter } from 'nodemailer';
import type { Request, Response, Express } from 'express';
import type { Server as IoServer } from 'socket.io';
import 'express-session';
import { setActiveSid, getActiveSid, clearActiveSid, destroySession } from './auth-sessions.ts';

// Declaration-merged fields on the session; matches the writes in /auth/login.
declare module 'express-session' {
  interface SessionData {
    userId?: number;
    username?: string;
    isAdmin?: boolean;
    visited?: number;
  }
}

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// In-memory rate limiting for auth endpoints: 5 attempts per minute per IP
const authRateLimits = new Map(); // ip -> { count, firstAttempt }
const AUTH_RATE_LIMIT = 5;
const AUTH_RATE_WINDOW_MS = 60_000;

// Sweep expired entries every 10 minutes to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of authRateLimits) {
    if (now - entry.firstAttempt > AUTH_RATE_WINDOW_MS) {
      authRateLimits.delete(ip);
    }
  }
}, 10 * 60_000).unref();

function getClientIp(req: Request): string {
  const raw = req.ip || req.socket?.remoteAddress || 'unknown';
  // Normalize IPv6-mapped IPv4 (e.g. ::ffff:127.0.0.1 → 127.0.0.1)
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

function isLocalhostIp(ip: string): boolean {
  return ip === '::1' || ip.startsWith('127.');
}

function checkAuthRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = authRateLimits.get(ip);
  if (!entry || now - entry.firstAttempt > AUTH_RATE_WINDOW_MS) {
    authRateLimits.set(ip, { count: 1, firstAttempt: now });
    return true;
  }
  if (entry.count >= AUTH_RATE_LIMIT) {
    return false;
  }
  entry.count++;
  return true;
}

function applyAuthRateLimit(req: Request, res: Response): boolean {
  const ip = getClientIp(req);
  if (!isLocalhostIp(ip) && !checkAuthRateLimit(ip)) {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return false;
  }
  return true;
}

function getSmtpConfig() {
  return {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'noreply@weeqlash.icu',
  } as const;
}

let transporter: Transporter | null = null;

async function getTransporter(): Promise<Transporter | null> {
  if (transporter) {
    return transporter;
  }
  const cfg = getSmtpConfig();
  console.log('[smtp] getTransporter config:', cfg);
  if (!cfg.host) {
    console.warn('[auth] SMTP not configured — emails will be logged to console');
    return null;
  }
  // At this point, we know cfg.host is not null/undefined, but TypeScript needs help
  const host: string = cfg.host as string;
  const port: number = cfg.port as number;
  const user: string = cfg.user as string;
  const pass: string = cfg.pass as string;
  const nodemailer = await import('nodemailer');
  transporter = nodemailer.createTransport({
    host: host,
    port: port,
    secure: port === 465,
    auth: { user: user, pass: pass },
  });
  return transporter;
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const t = await getTransporter();
  const cfg = getSmtpConfig();
  if (!t) {
    console.log(`[auth:email] To: ${to} | Subject: ${subject} | ${html}`);
    return;
  }
  await t.sendMail({ from: cfg.from, to, subject, html });
}

// Disconnect any live sockets still attached to a session we just killed.
// Emits 'auth:kicked' so the client can show feedback and redirect before the
// socket hangs up. Fire-and-forget: failures here don't affect login response.
function kickSocketsForSid(io: IoServer, sid: string): void {
  for (const [, socket] of io.of('/').sockets) {
    // socket.request.sessionID is set by express-session via io.engine.use(sessionMiddleware)
    const socketSid = (socket.request as { sessionID?: string }).sessionID;
    if (socketSid === sid) {
      socket.emit('auth:kicked', { reason: 'logged_in_elsewhere' });
      socket.disconnect(true);
    }
  }
}

export function registerAuthRoutes(app: Express, io: IoServer): void {
  console.log('[auth-routes] SMTP_HOST at registration:', process.env.SMTP_HOST);
  console.log('[auth-routes] SMTP_USER at registration:', process.env.SMTP_USER);

  // Register
  app.post('/auth/register', async (req: Request, res: Response) => {
    if (!applyAuthRateLimit(req, res)) {
      return;
    }

    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Username must be 3-20 characters' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res
        .status(400)
        .json({ error: 'Username can only contain letters, numbers, and underscores' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const result = createUser({ username, email, password });
    if (result.error) {
      return res.status(409).json({ error: result.error });
    }

    const confirmUrl = `${CLIENT_URL}?confirm=${result.confirmToken}`;
    await sendEmail(
      email,
      'Confirm your Weeqlash account',
      `<h2>Welcome to Weeqlash!</h2><p>Click the link below to confirm your email:</p><p><a href="${confirmUrl}">${confirmUrl}</a></p>`,
    );

    res.json({ ok: true, message: 'Check your email to confirm your account' });
  });

  // Login
  app.post('/auth/login', async (req: Request, res: Response) => {
    if (!applyAuthRateLimit(req, res)) {
      return;
    }

    const { username, password, keepLoggedIn } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = authenticateUser(username, password);
    if ('error' in result) {
      return res.status(result.needsConfirmation ? 403 : 401).json(result);
    }

    // Single-session-per-user: if the user is already logged in elsewhere,
    // kill the previous session server-side before issuing the new one.
    // Fail-closed: if Redis errors at any step, do NOT proceed — otherwise
    // the old session would linger and defeat the policy.
    try {
      const oldSid = await getActiveSid(result.user.id);
      if (oldSid && oldSid !== req.sessionID) {
        await destroySession(oldSid);
        kickSocketsForSid(io, oldSid);
      }

      req.session.userId = result.user.id;
      req.session.username = result.user.username;
      req.session.isAdmin = result.user.is_admin === 1;

      // Keep logged in = 7 days, otherwise session expires when browser closes
      req.session.cookie.maxAge = keepLoggedIn ? 7 * 24 * 60 * 60 * 1000 : undefined;
      req.session.cookie.expires = keepLoggedIn
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        : undefined;

      // Index TTL = 7d regardless of keepLoggedIn. For browser-session cookies
      // the stale entry is harmless — next login would just overwrite it.
      await setActiveSid(result.user.id, req.sessionID, 7 * 24 * 60 * 60);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[auth] Redis error during login:', msg);
      return res.status(503).json({ error: 'Service temporarily unavailable' });
    }

    console.log('[auth] login set session:', { userId: result.user.id, keepLoggedIn });
    req.session.save((err) => {
      if (err) {
        console.error('[auth] session save error:', err.message);
      }
      res.json({ ok: true, user: result.user });
    });
  });

  // Logout
  app.post('/auth/logout', async (req: Request, res: Response) => {
    const userId = req.session.userId;
    if (userId) {
      try {
        await clearActiveSid(userId);
      } catch (err) {
        // Stale index entries self-expire via TTL; don't block logout on Redis.
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[auth] clearActiveSid failed:', msg);
      }
    }
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  // Get current user
  app.get('/auth/me', (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.json({ user: null });
    }
    const user = getUserById(req.session.userId);
    if (!user || user.is_blocked) {
      req.session.destroy(() => {});
      return res.json({ user: null });
    }
    res.json({
      user: { id: user.id, username: user.username, email: user.email, is_admin: user.is_admin },
    });
  });

  // Get user stats
  app.get('/auth/stats/:userId', async (req: Request, res: Response) => {
    // Verify the logged-in user matches the requested userId (or is admin)
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const requestedId = parseInt(String(req.params.userId));
    if (isNaN(requestedId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Ownership check: user can only view their own stats unless admin
    const isAdmin = req.session.isAdmin === true;
    if (!isAdmin && req.session.userId !== requestedId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      console.log('[auth-routes] Fetching stats for userId:', requestedId);
      const stats = getUserStats(requestedId);

      console.log('[auth-routes] Sending stats result:', stats);
      res.json(stats);
    } catch (err) {
      console.error('[auth-routes] Error fetching user stats:', (err as Error).message);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // Confirm email
  app.get('/auth/confirm/:token', (req: Request, res: Response) => {
    const result = confirmEmail(String(req.params.token));
    if (result.error) {
      return res.status(400).json(result);
    }
    res.json({ ok: true, message: 'Email confirmed! You can now log in.' });
  });

  // Resend confirmation
  app.post('/auth/resend-confirmation', (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Not logged in' });
    }
    const result = resendConfirmation(req.session.userId);
    if (result.error) {
      return res.status(400).json(result);
    }

    const user = getUserById(req.session.userId);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }
    const confirmUrl = `${CLIENT_URL}?confirm=${result.confirmToken}`;
    sendEmail(
      user.email,
      'Confirm your Weeqlash account',
      `<p>Click to confirm: <a href="${confirmUrl}">${confirmUrl}</a></p>`,
    );

    res.json({ ok: true, message: 'Confirmation email sent' });
  });

  // Request password reset
  app.post('/auth/forgot-password', (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const result = createResetToken(email);
    if (result.resetToken) {
      const resetUrl = `${CLIENT_URL}?reset=${result.resetToken}`;
      sendEmail(
        email,
        'Reset your WEEQLASH password',
        `<p>Click to reset your password: <a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p>`,
      );
    }

    // Always return success to avoid email enumeration
    res.json({ ok: true, message: 'If that email exists, a reset link has been sent' });
  });

  // Reset password page (serve client for direct URL access)
  app.get('/auth/reset-password', (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../../client/index.html'));
  });

  // Reset password
  app.post('/auth/reset-password', (req: Request, res: Response) => {
    if (!applyAuthRateLimit(req, res)) {
      return;
    }

    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const result = resetPassword(token, password);
    if (result.error) {
      return res.status(400).json(result);
    }
    res.json({ ok: true, message: 'Password reset successfully' });
  });
}

export { applyAuthRateLimit, getClientIp, isLocalhostIp, checkAuthRateLimit };
