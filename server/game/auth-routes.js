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

function getClientIp(req) {
  const raw = req.ip || req.socket?.remoteAddress || 'unknown';
  // Normalize IPv6-mapped IPv4 (e.g. ::ffff:127.0.0.1 → 127.0.0.1)
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

function isLocalhostIp(ip) {
  return ip === '::1' || ip.startsWith('127.');
}

function checkAuthRateLimit(ip) {
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

function applyAuthRateLimit(req, res) {
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
    port: process.env.SMTP_PORT || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'noreply@weeqlash.icu',
  };
}

let transporter = null;

async function getTransporter() {
  if (transporter) {
    return transporter;
  }
  const cfg = getSmtpConfig();
  console.log('[smtp] getTransporter config:', cfg);
  if (!cfg.host) {
    console.warn('[auth] SMTP not configured — emails will be logged to console');
    return null;
  }
  const nodemailer = await import('nodemailer');
  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  return transporter;
}

async function sendEmail(to, subject, html) {
  const t = await getTransporter();
  const cfg = getSmtpConfig();
  if (!t) {
    console.log(`[auth:email] To: ${to} | Subject: ${subject} | ${html}`);
    return;
  }
  await t.sendMail({ from: cfg.from, to, subject, html });
}

export function registerAuthRoutes(app) {
  console.log('[auth-routes] SMTP_HOST at registration:', process.env.SMTP_HOST);
  console.log('[auth-routes] SMTP_USER at registration:', process.env.SMTP_USER);

  // Register
  app.post('/auth/register', async (req, res) => {
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
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
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
  app.post('/auth/login', (req, res) => {
    if (!applyAuthRateLimit(req, res)) {
      return;
    }

    const { username, password, keepLoggedIn } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = authenticateUser(username, password);
    if (result.error) {
      return res.status(result.needsConfirmation ? 403 : 401).json(result);
    }

    req.session.userId = result.user.id;
    req.session.username = result.user.username;
    req.session.isAdmin = result.user.is_admin === 1;

    // Keep logged in = 7 days, otherwise session expires when browser closes
    req.session.cookie.maxAge = keepLoggedIn ? 7 * 24 * 60 * 60 * 1000 : undefined;
    req.session.cookie.expires = keepLoggedIn
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      : undefined;

    console.log('[auth] login set session:', { userId: result.user.id, keepLoggedIn });
    req.session.save((err) => {
      if (err) {
        console.error('[auth] session save error:', err.message);
      }
      res.json({ ok: true, user: result.user });
    });
  });

  // Logout
  app.post('/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  // Get current user
  app.get('/auth/me', (req, res) => {
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
  app.get('/auth/stats/:userId', async (req, res) => {
    // Verify the logged-in user matches the requested userId (or is admin)
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const requestedId = parseInt(req.params.userId);
    if (isNaN(requestedId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Ownership check: user can only view their own stats unless admin
    const isAdmin = req.session.isAdmin === true;
    if (!isAdmin && req.session.userId !== requestedId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      console.log('[auth-routes] Fetching stats for userId:', req.params.userId);
      const stats = getUserStats(req.params.userId);

      console.log('[auth-routes] Sending stats result:', stats);
      res.json(stats);
    } catch (err) {
      console.error('[auth-routes] Error fetching user stats:', err.message);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // Confirm email
  app.get('/auth/confirm/:token', (req, res) => {
    const result = confirmEmail(req.params.token);
    if (result.error) {
      return res.status(400).json(result);
    }
    res.json({ ok: true, message: 'Email confirmed! You can now log in.' });
  });

  // Resend confirmation
  app.post('/auth/resend-confirmation', (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Not logged in' });
    }
    const result = resendConfirmation(req.session.userId);
    if (result.error) {
      return res.status(400).json(result);
    }

    const user = getUserById(req.session.userId);
    const confirmUrl = `${CLIENT_URL}?confirm=${result.confirmToken}`;
    sendEmail(
      user.email,
      'Confirm your Weeqlash account',
      `<p>Click to confirm: <a href="${confirmUrl}">${confirmUrl}</a></p>`,
    );

    res.json({ ok: true, message: 'Confirmation email sent' });
  });

  // Request password reset
  app.post('/auth/forgot-password', (req, res) => {
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
  app.get('/auth/reset-password', (_req, res) => {
    res.sendFile(path.join(__dirname, '../../client/index.html'));
  });

  // Reset password
  app.post('/auth/reset-password', (req, res) => {
    if (!applyAuthRateLimit(req, res)) {
      return;
    }

    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const result = resetPassword(token, password);
    if (result.error) {
      return res.status(400).json(result);
    }
    res.json({ ok: true, message: 'Password reset successfully' });
  });
}

export { applyAuthRateLimit, getClientIp, isLocalhostIp, checkAuthRateLimit };
