import express from 'express';
import crypto from 'crypto';
import { getDb } from '../game/leaderboard.ts';
import { resendConfirmation } from '../game/auth.ts';

const router = express.Router();

const FLASH_TTL_MS = 5 * 60_000;

function parseId(raw: unknown): number | null {
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function badRequest(res: express.Response, msg: string): void {
  res.status(400).send(renderHTML('Bad Request', `<h1>Bad Request</h1><p>${esc(msg)}</p>`));
}

function esc(v: unknown): string {
  if (v === null || v === undefined) {
    return '';
  }
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHTML(title: string, content: string, extra = ''): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Weeqlash Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Chakra Petch', 'Segoe UI', system-ui, sans-serif;
      background: #0e0e1a; color: #c8c0c0; padding: 24px;
      line-height: 1.55; font-size: 0.92rem;
    }
    h1 {
      color: #e8e4e4; font-size: 1.5rem; font-weight: 600;
      letter-spacing: 0.04em; margin-bottom: 20px;
      border-bottom: 1px solid #2a2a48; padding-bottom: 12px;
    }
    h2 {
      color: #c8c0c0; font-size: 1rem; font-weight: 600;
      letter-spacing: 0.06em; text-transform: uppercase;
      margin: 28px 0 12px; font-size: 0.78rem;
      color: #e53935;
    }
    a { color: #e53935; }
    .nav {
      margin-bottom: 24px; padding: 8px; background: rgba(14, 14, 26, 0.85);
      border-radius: 8px; border: 1px solid #2a2a48;
      display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
    }
    .nav a {
      color: #777; text-decoration: none; padding: 8px 16px;
      border-radius: 6px; font-size: 0.82rem; font-weight: 500;
      border: 1px solid transparent; transition: all 0.15s;
      letter-spacing: 0.02em;
    }
    .nav a:hover { color: #c8c0c0; border-color: #2a2a48; }
    .nav a.active { color: #e53935; border-color: #e53935; background: rgba(229,57,53,0.08); }
    .nav a[style*="float"] {
      margin-left: auto; float: none !important;
      color: #777; font-size: 0.78rem;
    }
    .nav a[style*="float"]:hover { color: #c8c0c0; }
    table {
      width: 100%; border-collapse: collapse;
      background: #161625; border-radius: 8px; overflow: hidden;
      font-size: 0.82rem; border: 1px solid #2a2a48;
    }
    th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #1e1e32; }
    th {
      background: #0e0e1a; color: #777; font-size: 0.7rem;
      text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600;
    }
    tr:hover { background: rgba(229, 57, 53, 0.03); }
    td a { color: #e53935; text-decoration: none; }
    td a:hover { text-decoration: underline; text-underline-offset: 3px; }
    .btn {
      padding: 7px 14px; border-radius: 6px; cursor: pointer;
      border: 1px solid #2a2a48; font-size: 0.76rem; font-weight: 500;
      font-family: inherit; letter-spacing: 0.02em; transition: all 0.15s;
    }
    .btn-primary {
      background: rgba(229, 57, 53, 0.12); color: #e53935;
      border-color: rgba(229, 57, 53, 0.4);
    }
    .btn-primary:hover { background: rgba(229, 57, 53, 0.22); border-color: #e53935; }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.03); color: #999;
      border-color: #2a2a48;
    }
    .btn-secondary:hover { color: #c8c0c0; border-color: #444; background: rgba(255,255,255,0.06); }
    .form-group { margin-bottom: 16px; }
    label { display: block; margin-bottom: 6px; color: #777; font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.06em; }
    input, select {
      padding: 9px 12px; width: 100%; max-width: 320px;
      background: #0e0e1a; border: 1px solid #2a2a48; color: #c8c0c0;
      border-radius: 6px; font-family: 'IBM Plex Mono', monospace;
      font-size: 0.85rem; transition: border-color 0.15s;
    }
    input:focus, select:focus { border-color: #e53935; outline: none; }
    .card {
      background: #161625; padding: 20px; border-radius: 8px;
      margin-bottom: 16px; border: 1px solid #2a2a48;
    }
    .stat { display: inline-block; margin-right: 36px; }
    .stat-value {
      font-size: 2.2em; color: #fff; font-weight: 700;
      font-family: 'IBM Plex Mono', monospace; letter-spacing: -0.02em;
    }
    .stat-label { color: #777; font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; margin-top: 2px; }
    .badge {
      padding: 3px 8px; border-radius: 4px; font-size: 0.68rem;
      font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
    }
    .badge-success { background: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34,197,94,0.3); }
    .badge-danger { background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
    .badge-warning { background: rgba(234, 179, 8, 0.15); color: #eab308; border: 1px solid rgba(234,179,8,0.3); }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
    .stat-card {
      background: #161625; padding: 20px; border-radius: 8px;
      border: 1px solid #2a2a48; transition: border-color 0.2s;
    }
    .stat-card:hover { border-color: rgba(229, 57, 53, 0.3); }
    code { background: #0e0e1a; padding: 2px 6px; border-radius: 4px; font-size: 0.82rem; }
  </style>
</head>
<body>
  <div class="nav">
    <a href="/admin/" class="${title === 'Dashboard' ? 'active' : ''}">Dashboard</a>
    <a href="/admin/users" class="${title === 'Users' || title.startsWith('User:') ? 'active' : ''}">Users</a>
    <a href="/admin/stats" class="${title === 'Statistics' ? 'active' : ''}">Statistics</a>
    <a href="/admin/export" class="${title === 'Export' ? 'active' : ''}">Export Data</a>
  </div>
  ${content}
  ${extra}
</body>
</html>`;
}

// Admin magic key — loaded once from env at startup
const ADMIN_MAGIC_KEY = process.env.ADMIN_SECRET || '';

// Rate limiting for failed admin access attempts
const adminAttempts = new Map<
  string,
  { count: number; windowStart: number; blockedUntil: number }
>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;
const BLOCK_MS = 300_000;

function recordFailedAttempt(ip: string): { blocked: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = adminAttempts.get(ip) ?? { count: 0, windowStart: now, blockedUntil: 0 };
  adminAttempts.set(ip, entry);

  if (now < entry.blockedUntil) {
    return { blocked: true, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
  }

  if (now - entry.windowStart > WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }

  entry.count++;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_MS;
    console.warn(
      `[admin] IP ${ip} blocked for ${BLOCK_MS / 1000}s after ${entry.count} failed attempts`,
    );
  } else {
    console.warn(`[admin] Failed admin access from IP ${ip} (${entry.count}/${MAX_ATTEMPTS})`);
  }

  return entry.blockedUntil > 0
    ? { blocked: true, retryAfter: Math.ceil(BLOCK_MS / 1000) }
    : { blocked: false };
}

setInterval(() => {
  const cutoff = Date.now() - (BLOCK_MS + WINDOW_MS);
  for (const [ip, entry] of adminAttempts) {
    if (entry.windowStart < cutoff && entry.blockedUntil < Date.now()) {
      adminAttempts.delete(ip);
    }
  }
}, 10 * 60_000).unref();

function getClientIp(req: express.Request): string {
  return (
    (((req.headers['x-forwarded-for'] as string) || '').split(',')[0] || '').trim() ||
    (req.headers['x-real-ip'] as string) ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

function requireAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if ((req.session as any).isAdmin) {
    return next();
  }

  const key = (req.headers['x-admin-key'] as string) || (req.query.admin_key as string);
  if (
    typeof key === 'string' &&
    ADMIN_MAGIC_KEY &&
    key.length === ADMIN_MAGIC_KEY.length &&
    crypto.timingSafeEqual(Buffer.from(key), Buffer.from(ADMIN_MAGIC_KEY))
  ) {
    req.session.regenerate((err) => {
      if (err) {
        return next(err);
      }
      (req.session as any).isAdmin = true;
      req.session.save(() => next());
    });
    return;
  }

  const ip = getClientIp(req);
  const result = recordFailedAttempt(ip);

  if (result.blocked) {
    res
      .status(429)
      .send(
        renderHTML(
          'Too Many Requests',
          `<h1>Too Many Requests</h1><p>Try again in ${result.retryAfter} seconds.</p>`,
        ),
      );
    return;
  }

  res
    .status(403)
    .send(
      renderHTML(
        'Access Denied',
        '<h1>Access Denied</h1><p>You must be an admin to access this page.</p>',
      ),
    );
}

router.use(requireAdmin);

// ========== DASHBOARD ==========
router.get('/', (_req: express.Request, res: express.Response) => {
  const db = getDb();
  if (!db) {
    res.status(500).send(renderHTML('Error', '<p>Database not available</p>'));
    return;
  }

  try {
    const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number })
      .count;
    const qlasGameCount = (
      db
        .prepare("SELECT COUNT(*) as count FROM game_history WHERE game_mode = 'qlashique'")
        .get() as { count: number }
    ).count;
    const quizCount = (
      db.prepare('SELECT COUNT(*) as count FROM leaderboard').get() as { count: number }
    ).count;

    res.send(
      renderHTML(
        'Dashboard',
        `
      <h1>Weeqlash Admin Dashboard</h1>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${userCount}</div>
          <div class="stat-label">Total Users</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${qlasGameCount}</div>
          <div class="stat-label">Qlashique Games</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${quizCount}</div>
          <div class="stat-label">Quiz Scores</div>
        </div>
      </div>
    `,
      ),
    );
  } catch (error) {
    console.error('[admin] Dashboard error:', error);
    res
      .status(500)
      .send(renderHTML('Error', `<p>Failed to load dashboard: ${(error as Error).message}</p>`));
  }
});

// ========== USERS PAGE ==========
router.get('/users', (_req: express.Request, res: express.Response) => {
  const db = getDb();
  if (!db) {
    res.status(500).send(renderHTML('Error', '<p>Database not available</p>'));
    return;
  }

  try {
    const users = db
      .prepare(
        'SELECT id, username, email, is_admin, is_blocked, email_confirmed, created_at, last_login, games_played, games_won FROM users ORDER BY id DESC',
      )
      .all() as Array<{
      id: number;
      username: string;
      email: string;
      is_admin: number;
      is_blocked: number;
      email_confirmed: number;
      created_at: number;
      last_login: number | null;
      games_played: number;
      games_won: number;
    }>;

    const userRows = users
      .map(
        (u) => `
      <tr>
        <td>${u.id}</td>
        <td><a href="/admin/users/${u.id}" style="color:#d93939">${esc(u.username)}</a></td>
        <td>${esc(u.email)}</td>
        <td>${u.is_admin ? '<span class="badge badge-success">Admin</span>' : '-'}</td>
        <td>${u.is_blocked ? '<span class="badge badge-danger">Blocked</span>' : '<span class="badge badge-success">Active</span>'}</td>
        <td>${u.email_confirmed ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-warning">No</span>'}</td>
        <td>
          <form method="post" action="/admin/users/toggle-admin" style="display:inline">
            <input type="hidden" name="id" value="${u.id}">
            <input type="hidden" name="is_admin" value="${u.is_admin ? 0 : 1}">
            <button class="btn btn-secondary">${u.is_admin ? 'Remove Admin' : 'Make Admin'}</button>
          </form>
          <form method="post" action="/admin/users/toggle-block" style="display:inline">
            <input type="hidden" name="id" value="${u.id}">
            <input type="hidden" name="is_blocked" value="${u.is_blocked ? 0 : 1}">
            <button class="btn btn-secondary">${u.is_blocked ? 'Unblock' : 'Block'}</button>
          </form>
        </td>
      </tr>
    `,
      )
      .join('');

    res.send(
      renderHTML(
        'Users',
        `
      <h1>Users</h1>
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Verified</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${userRows}</tbody>
        </table>
      </div>
    `,
      ),
    );
  } catch (error) {
    console.error('[admin] Users error:', error);
    res
      .status(500)
      .send(renderHTML('Error', `<p>Failed to load users: ${(error as Error).message}</p>`));
  }
});

router.post(
  '/users/toggle-admin',
  express.urlencoded({ extended: true, limit: '1mb' }),
  (req: express.Request, res: express.Response) => {
    const id = parseId(req.body.id);
    if (id === null) {
      return badRequest(res, 'Invalid user id.');
    }
    const flag = req.body.is_admin === '1' || req.body.is_admin === 1 ? 1 : 0;
    const db = getDb();
    if (!db) {
      return badRequest(res, 'Database unavailable.');
    }
    if (flag === 0) {
      if ((req.session as any).userId === id) {
        return badRequest(res, 'You cannot remove admin from the account you are signed in as.');
      }
      const adminCount = (
        db.prepare('SELECT COUNT(*) as c FROM users WHERE is_admin = 1').get() as { c: number }
      ).c;
      if (adminCount <= 1) {
        return badRequest(res, 'Cannot remove the last remaining admin.');
      }
    }
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(flag, id);
    res.redirect('/admin/users');
  },
);

router.post(
  '/users/toggle-block',
  express.urlencoded({ extended: true, limit: '1mb' }),
  (req: express.Request, res: express.Response) => {
    const id = parseId(req.body.id);
    if (id === null) {
      return badRequest(res, 'Invalid user id.');
    }
    const flag = req.body.is_blocked === '1' || req.body.is_blocked === 1 ? 1 : 0;
    const db = getDb();
    if (!db) {
      return badRequest(res, 'Database unavailable.');
    }
    if (flag === 1 && (req.session as any).userId === id) {
      return badRequest(res, 'You cannot block the account you are signed in as.');
    }
    db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(flag, id);
    res.redirect('/admin/users');
  },
);

// ========== USER DETAIL PAGE ==========
router.get('/users/:id', (req: express.Request, res: express.Response) => {
  const userId = parseId(req.params.id);
  if (userId === null) {
    return badRequest(res, 'Invalid user id.');
  }
  const db = getDb();
  if (!db) {
    res.status(500).send(renderHTML('Error', '<p>Database not available</p>'));
    return;
  }

  const user = db
    .prepare(
      'SELECT id, username, email, is_admin, is_blocked, email_confirmed, created_at, last_login, games_played, games_won FROM users WHERE id = ?',
    )
    .get(userId) as
    | {
        id: number;
        username: string;
        email: string;
        is_admin: number;
        is_blocked: number;
        email_confirmed: number;
        created_at: number;
        last_login: number | null;
        games_played: number;
        games_won: number;
      }
    | undefined;

  if (!user) {
    return res
      .status(404)
      .send(renderHTML('User Not Found', '<h1>User Not Found</h1><p>The user does not exist.</p>'));
  }

  const userStats = db
    .prepare(
      `
    SELECT category, SUM(answered) as answered, SUM(correct) as correct
    FROM user_stats WHERE user_id = ? GROUP BY category
  `,
    )
    .all(userId) as Array<{ category: string; answered: number; correct: number }>;

  const totalAnswered = userStats.reduce((sum, s) => sum + s.answered, 0);
  const totalCorrect = userStats.reduce((sum, s) => sum + s.correct, 0);
  const overallAccuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  const qlasRow = db
    .prepare(
      `
    SELECT COUNT(*) as played, SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) as won
    FROM game_history
    WHERE (player1_id = ? OR player2_id = ?)
      AND game_mode = 'qlashique'
      AND json_extract(player1_stats, '$.finalHp') IS NOT NULL
  `,
    )
    .get(userId, userId, userId) as { played: number; won: number };
  const totalGamesPlayed = (user.games_played || 0) + (qlasRow?.played || 0);
  const totalGamesWon = (user.games_won || 0) + (qlasRow?.won || 0);

  const recentGames = db
    .prepare(
      `
    SELECT gh.*,
           u1.username as p1_name, u2.username as p2_name,
           (SELECT username FROM users WHERE id = gh.winner_id) as winner_name
    FROM game_history gh
    LEFT JOIN users u1 ON gh.player1_id = u1.id
    LEFT JOIN users u2 ON gh.player2_id = u2.id
    WHERE gh.player1_id = ? OR gh.player2_id = ?
    ORDER BY gh.created_at DESC LIMIT 20
  `,
    )
    .all(userId, userId) as Array<{
    id: number;
    player1_id: number;
    player2_id: number;
    winner_id: number | null;
    game_mode: string;
    board_size: number | null;
    duration_ms: number | null;
    p1_name: string | null;
    p2_name: string | null;
    winner_name: string | null;
    created_at: number;
  }>;

  const statsRows = userStats
    .map((s) => {
      const acc = s.answered > 0 ? Math.round((s.correct / s.answered) * 100) : 0;
      return `<tr><td>${esc(s.category)}</td><td>${s.answered}</td><td>${s.correct}</td><td>${acc}%</td></tr>`;
    })
    .join('');

  const gameRows = recentGames
    .map((g) => {
      const isWinner = g.winner_id === userId;
      const isPlayer1 = g.player1_id === userId;
      const opponent = isPlayer1 ? g.p2_name : g.p1_name;
      return `<tr>
      <td>${esc(opponent || 'Unknown')}</td>
      <td>${g.winner_id ? (isWinner ? '<span class="badge badge-success">Won</span>' : '<span class="badge badge-danger">Lost</span>') : '-'}</td>
      <td>${esc(g.game_mode || '-')}</td>
      <td>${g.duration_ms !== null ? Math.round(g.duration_ms / 1000) + 's' : '-'}</td>
      <td>${new Date(g.created_at).toLocaleDateString()}</td>
    </tr>`;
    })
    .join('');

  const flashBanners = (
    [
      ['resetLinkFlash', 'Password reset link generated'],
      ['confirmLinkFlash', 'Email confirmation link generated'],
    ] as const
  )
    .map(([key, label]) => {
      const f = (req.session as any)[key];
      if (!f) {
        return '';
      }
      const expired = typeof f.expiresAt === 'number' && f.expiresAt < Date.now();
      if (expired || f.userId !== userId) {
        delete (req.session as any)[key];
        return '';
      }
      if (typeof f.url !== 'string') {
        return '';
      }
      delete (req.session as any)[key];
      return `<div class="card" style="border:1px solid #22c55e"><strong>${label}</strong> (expires in 1 hour). Share with user:<br><code style="word-break:break-all;color:#fff">${esc(f.url)}</code></div>`;
    })
    .join('');

  res.send(
    renderHTML(
      'User: ' + esc(user.username),
      `
    <script src="/js/admin-confirm.js"></script>
    <h1>User: ${esc(user.username)}</h1>
    <p><a href="/admin/users" style="color:#a4b2a0">← Back to Users</a></p>
    ${flashBanners}

    <div class="card">
      <h2>Account Details</h2>
      <form method="post" action="/admin/users/update">
        <input type="hidden" name="id" value="${user.id}">
        <div class="form-group">
          <label>Username</label>
          <input type="text" name="username" value="${esc(user.username)}">
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email" value="${esc(user.email)}">
        </div>
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </form>
    </div>

    <div class="card">
      <h2>Statistics</h2>
      <div class="stat"><div class="stat-value">${totalGamesWon}</div><div class="stat-label">Games Won</div></div>
      <div class="stat"><div class="stat-value">${totalGamesPlayed}</div><div class="stat-label">Games Played</div></div>
      <div class="stat"><div class="stat-value">${overallAccuracy}%</div><div class="stat-label">Overall Accuracy</div></div>
    </div>

    <h2>Category Performance</h2>
    <div class="card">
      <table>
        <thead><tr><th>Category</th><th>Answered</th><th>Correct</th><th>Accuracy</th></tr></thead>
        <tbody>${statsRows || '<tr><td colspan="4">No stats yet</td></tr>'}</tbody>
      </table>
    </div>

    <h2>Recent Games</h2>
    <div class="card">
      <table>
        <thead><tr><th>Opponent</th><th>Result</th><th>Mode</th><th>Duration</th><th>Date</th></tr></thead>
        <tbody>${gameRows || '<tr><td colspan="5">No games yet</td></tr>'}</tbody>
      </table>
    </div>

    <h2>Actions</h2>
    <div class="card">
      <form method="post" action="/admin/users/toggle-block" style="display:inline;margin-right:10px">
        <input type="hidden" name="id" value="${user.id}">
        <input type="hidden" name="is_blocked" value="${user.is_blocked ? 0 : 1}">
        <button class="btn btn-secondary">${user.is_blocked ? 'Activate User' : 'Deactivate User'}</button>
      </form>
      <form method="post" action="/admin/users/toggle-admin" style="display:inline;margin-right:10px">
        <input type="hidden" name="id" value="${user.id}">
        <input type="hidden" name="is_admin" value="${user.is_admin ? 0 : 1}">
        <button class="btn btn-secondary">${user.is_admin ? 'Remove Admin' : 'Make Admin'}</button>
      </form>
      <form method="post" action="/admin/users/reset-stats" style="display:inline;margin-right:10px">
        <input type="hidden" name="id" value="${user.id}">
        <button class="btn btn-secondary" data-confirm="Reset all statistics for this user?">Reset Statistics</button>
      </form>
      <form method="post" action="/admin/users/reset-password" style="display:inline;margin-right:10px">
        <input type="hidden" name="id" value="${user.id}">
        <button class="btn btn-secondary" data-confirm="Generate a password reset link for this user?">Send Reset Link</button>
      </form>
      ${
        user.email_confirmed
          ? ''
          : `<form method="post" action="/admin/users/resend-email" style="display:inline;margin-right:10px">
        <input type="hidden" name="id" value="${user.id}">
        <button class="btn btn-secondary" data-confirm="Generate an email confirmation link for this user?">Resend Confirmation</button>
      </form>`
      }
      <form method="get" action="/admin/users/${user.id}/export" style="display:inline;margin-right:10px">
        <button class="btn btn-secondary">Export Statistics (JSON)</button>
      </form>
      <form method="post" action="/admin/users/delete" style="display:inline"
            data-delete-confirm="${esc(user.username)}">
        <input type="hidden" name="id" value="${user.id}">
        <button class="btn btn-primary" style="background:rgba(239,68,68,0.15);color:#ef4444;border-color:rgba(239,68,68,0.4)">Delete User (Cascade)</button>
      </form>
    </div>
  `,
    ),
  );
});

router.post(
  '/users/update',
  express.urlencoded({ extended: true, limit: '1mb' }),
  (req: express.Request, res: express.Response) => {
    const id = parseId(req.body.id);
    if (id === null) {
      return badRequest(res, 'Invalid user id.');
    }
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
    if (!username || !email) {
      return badRequest(res, 'Username and email are required.');
    }
    const db = getDb();
    if (!db) {
      return badRequest(res, 'Database unavailable.');
    }
    const dupe = db
      .prepare(
        'SELECT id, username, email FROM users WHERE (username = ? OR email = ?) AND id <> ?',
      )
      .get(username, email, id) as { id: number; username: string; email: string } | undefined;
    if (dupe) {
      const field = dupe.username === username ? 'username' : 'email';
      return badRequest(res, `Another user already has that ${field}.`);
    }
    db.prepare('UPDATE users SET username = ?, email = ? WHERE id = ?').run(username, email, id);
    res.redirect(`/admin/users/${id}`);
  },
);

router.post(
  '/users/delete',
  express.urlencoded({ extended: true, limit: '1mb' }),
  (req: express.Request, res: express.Response) => {
    const userId = parseId(req.body.id);
    if (userId === null) {
      return badRequest(res, 'Invalid user id.');
    }
    if ((req.session as any).userId === userId) {
      return res
        .status(400)
        .send(
          renderHTML(
            'Forbidden',
            '<h1>Forbidden</h1><p>You cannot delete the account you are signed in as.</p>',
          ),
        );
    }
    const db = getDb();
    if (!db) {
      return badRequest(res, 'Database unavailable.');
    }
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as
      | { id: number; username: string }
      | undefined;
    if (!user) {
      return res.redirect('/admin/users');
    }
    const cascade = db.transaction((uid: number) => {
      db.prepare('DELETE FROM user_stats WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM game_history WHERE player1_id = ? OR player2_id = ?').run(uid, uid);
      db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    });
    cascade(userId);
    console.log(`[admin] Cascade-deleted user id=${userId} username=${user.username}`);
    res.redirect('/admin/users');
  },
);

router.post(
  '/users/reset-stats',
  express.urlencoded({ extended: true, limit: '1mb' }),
  (req: express.Request, res: express.Response) => {
    const id = parseId(req.body.id);
    if (id === null) {
      return badRequest(res, 'Invalid user id.');
    }
    const db = getDb();
    if (!db) {
      return badRequest(res, 'Database unavailable.');
    }
    db.transaction(() => {
      db.prepare('DELETE FROM user_stats WHERE user_id = ?').run(id);
      db.prepare('UPDATE users SET games_played = 0, games_won = 0 WHERE id = ?').run(id);
    })();
    res.redirect(`/admin/users/${id}`);
  },
);

router.post(
  '/users/reset-password',
  express.urlencoded({ extended: true, limit: '1mb' }),
  (req: express.Request, res: express.Response) => {
    const userId = parseId(req.body.id);
    if (userId === null) {
      return badRequest(res, 'Invalid user id.');
    }
    const db = getDb();
    if (!db) {
      return badRequest(res, 'Database unavailable.');
    }
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as
      | { id: number }
      | undefined;
    if (!user) {
      return res.redirect('/admin/users');
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 3600000;
    db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(
      token,
      expires,
      userId,
    );
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const resetLink = `${clientUrl}/?reset=${token}`;
    (req.session as any).resetLinkFlash = {
      userId,
      url: resetLink,
      expiresAt: Date.now() + FLASH_TTL_MS,
    };
    req.session.save(() => {
      console.log(`[admin] Generated password reset link for user id=${userId} (token redacted)`);
      res.redirect(`/admin/users/${userId}`);
    });
  },
);

router.post(
  '/users/resend-email',
  express.urlencoded({ extended: true, limit: '1mb' }),
  (req: express.Request, res: express.Response) => {
    const id = parseId(req.body.id);
    if (id === null) {
      return badRequest(res, 'Invalid user id.');
    }
    const result = resendConfirmation(id);
    if (result.error) {
      return badRequest(res, result.error);
    }
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const confirmLink = `${clientUrl}/?confirm=${result.confirmToken}`;
    (req.session as any).confirmLinkFlash = {
      userId: id,
      url: confirmLink,
      expiresAt: Date.now() + FLASH_TTL_MS,
    };
    req.session.save(() => {
      console.log(`[admin] Generated email confirmation link for user id=${id}`);
      res.redirect(`/admin/users/${id}`);
    });
  },
);

// ========== STATISTICS PAGE ==========
router.get('/stats', (_req: express.Request, res: express.Response) => {
  const db = getDb();
  if (!db) {
    res.status(500).send(renderHTML('Error', '<p>Database not available</p>'));
    return;
  }

  try {
    const totalUsers = (
      db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
    ).count;
    const activeUsers = (
      db.prepare('SELECT COUNT(*) as count FROM users WHERE is_blocked = 0').get() as {
        count: number;
      }
    ).count;
    const totalGames = (
      db.prepare('SELECT COUNT(*) as count FROM game_history').get() as { count: number }
    ).count;
    const totalAdmins = (
      db.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 1').get() as {
        count: number;
      }
    ).count;

    const recentGames = db
      .prepare(
        `
      SELECT gh.*,
             u1.username as p1_name, u2.username as p2_name,
             (SELECT username FROM users WHERE id = gh.winner_id) as winner_name
      FROM game_history gh
      LEFT JOIN users u1 ON gh.player1_id = u1.id
      LEFT JOIN users u2 ON gh.player2_id = u2.id
      ORDER BY gh.created_at DESC
      LIMIT 20
    `,
      )
      .all() as Array<{
      id: number;
      player1_id: number;
      player2_id: number;
      winner_id: number | null;
      game_mode: string;
      board_size: number | null;
      duration_ms: number | null;
      p1_name: string | null;
      p2_name: string | null;
      winner_name: string | null;
      created_at: number;
    }>;

    const categoryStats = db
      .prepare(
        `
      SELECT category, SUM(answered) as answered, SUM(correct) as correct
      FROM user_stats
      GROUP BY category
      ORDER BY answered DESC
    `,
      )
      .all() as Array<{ category: string; answered: number; correct: number }>;

    const gameRows = recentGames
      .map(
        (g) => `
      <tr>
        <td>${g.id}</td>
        <td>${esc(g.p1_name || String(g.player1_id))} vs ${esc(g.p2_name || String(g.player2_id))}</td>
        <td>${esc(g.winner_name || '-')}</td>
        <td>${esc(g.game_mode || '-')}</td>
        <td>${g.board_size !== null ? g.board_size + 'x' + g.board_size : '-'}</td>
        <td>${g.duration_ms !== null ? Math.round(g.duration_ms / 1000) + 's' : '-'}</td>
        <td>${new Date(g.created_at).toLocaleString()}</td>
      </tr>
    `,
      )
      .join('');

    const catRows = categoryStats
      .map((c) => {
        const accuracy = c.answered > 0 ? Math.round((c.correct / c.answered) * 100) : 0;
        return `
        <tr>
          <td>${esc(c.category)}</td>
          <td>${c.answered}</td>
          <td>${c.correct}</td>
          <td>${accuracy}%</td>
        </tr>
      `;
      })
      .join('');

    res.send(
      renderHTML(
        'Statistics',
        `
      <h1>Statistics</h1>

      <div class="card">
        <div class="stat">
          <div class="stat-value">${totalUsers}</div>
          <div class="stat-label">Total Users</div>
        </div>
        <div class="stat">
          <div class="stat-value">${activeUsers}</div>
          <div class="stat-label">Active Users</div>
        </div>
        <div class="stat">
          <div class="stat-value">${totalGames}</div>
          <div class="stat-label">Total Games</div>
        </div>
        <div class="stat">
          <div class="stat-value">${totalAdmins}</div>
          <div class="stat-label">Admins</div>
        </div>
      </div>

      <h2>Recent Games</h2>
      <div class="card">
        <table>
          <thead>
            <tr><th>ID</th><th>Players</th><th>Winner</th><th>Mode</th><th>Board</th><th>Duration</th><th>Date</th></tr>
          </thead>
          <tbody>${gameRows}</tbody>
        </table>
      </div>

      <h2>Category Performance</h2>
      <div class="card">
        <table>
          <thead>
            <tr><th>Category</th><th>Questions</th><th>Correct</th><th>Accuracy</th></tr>
          </thead>
          <tbody>${catRows}</tbody>
        </table>
      </div>
    `,
      ),
    );
  } catch (error) {
    console.error('[admin] Stats error:', error);
    res
      .status(500)
      .send(renderHTML('Error', `<p>Failed to load statistics: ${(error as Error).message}</p>`));
  }
});

// ========== EXPORT DATA ==========
router.get('/export', (req: express.Request, res: express.Response) => {
  const db = getDb();
  if (!db) {
    res.status(500).send(renderHTML('Error', '<p>Database not available</p>'));
    return;
  }

  const exportType = (req.query.type as string) || 'all';

  try {
    const exportData: Record<string, unknown> = { exportedAt: new Date().toISOString() };

    if (exportType === 'all' || exportType === 'users') {
      exportData.users = db
        .prepare(
          `
        SELECT id, username, email, email_confirmed, is_blocked, is_admin, created_at,
               games_played, games_won
        FROM users
        ORDER BY id
      `,
        )
        .all();
    }

    if (exportType === 'all' || exportType === 'games') {
      exportData.games = db
        .prepare(
          `
        SELECT id, player1_id, player2_id, winner_id, game_mode, board_size,
               duration_ms, player1_stats, player2_stats, created_at
        FROM game_history
        ORDER BY id
      `,
        )
        .all();
    }

    if (exportType === 'all' || exportType === 'leaderboard') {
      exportData.leaderboard = db
        .prepare(
          `
        SELECT gm.slug AS mode, l.name, l.answers, l.time_ms, l.created_at
        FROM leaderboard l
        JOIN game_modes gm ON gm.id = l.mode_id
        ORDER BY gm.slug, l.answers DESC, l.time_ms ASC
      `,
        )
        .all();
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=weeqlash-export-${exportType}-${new Date().toISOString().slice(0, 10)}.json`,
    );
    res.send(JSON.stringify(exportData, null, 2));
  } catch (error) {
    console.error('[admin] Export error:', error);
    res
      .status(500)
      .send(renderHTML('Error', `<p>Failed to export data: ${(error as Error).message}</p>`));
  }
});

// ========== PER-USER EXPORT ==========
router.get('/users/:id/export', (req: express.Request, res: express.Response) => {
  const userId = parseId(req.params.id);
  if (userId === null) {
    return badRequest(res, 'Invalid user id.');
  }
  const db = getDb();
  if (!db) {
    res.status(500).send(renderHTML('Error', '<p>Database not available</p>'));
    return;
  }

  const user = db
    .prepare(
      'SELECT id, username, email, is_admin, is_blocked, email_confirmed, created_at, last_login, games_played, games_won FROM users WHERE id = ?',
    )
    .get(userId);

  if (!user) {
    return res
      .status(404)
      .send(renderHTML('User Not Found', '<h1>User Not Found</h1><p>The user does not exist.</p>'));
  }

  const userStats = db
    .prepare('SELECT category, answered, correct FROM user_stats WHERE user_id = ?')
    .all(userId);

  const exportData = {
    user,
    statistics: userStats,
    exportedAt: new Date().toISOString(),
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=user-${userId}-stats.json`);
  res.send(JSON.stringify(exportData, null, 2));
});

export default router;
