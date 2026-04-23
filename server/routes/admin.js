import express from 'express';
import crypto from 'crypto';
import { getDb } from '../game/leaderboard.ts';

const router = express.Router();

// Helper to render simple HTML
function renderHTML(title, content, extra = '') {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Weeqlash Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Montserrat', 'Segoe UI', sans-serif; background: #1a1a2e; color: #bdb5b5; padding: 20px; }
    h1 { color: #d93939; margin-bottom: 20px; }
    h2 { color: #fff; margin: 20px 0 10px; }
    .nav { margin-bottom: 20px; padding: 10px; background: #16213e; border-radius: 8px; }
    .nav a { color: #a4b2a0; text-decoration: none; margin-right: 20px; padding: 8px 16px; border-radius: 4px; }
    .nav a:hover, .nav a.active { background: #d93939; color: #fff; }
    table { width: 100%; border-collapse: collapse; background: #16213e; border-radius: 8px; overflow: hidden; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #2f3741; }
    th { background: #0d1525; color: #fff; }
    tr:hover { background: #1a2744; }
    .btn { padding: 8px 16px; border-radius: 4px; cursor: pointer; border: none; font-size: 14px; }
    .btn-primary { background: #d93939; color: #fff; }
    .btn-secondary { background: #2f3741; color: #bdb5b5; }
    .form-group { margin-bottom: 15px; }
    label { display: block; margin-bottom: 5px; color: #a4b2a0; }
    input, select { padding: 10px; width: 100%; max-width: 300px; background: #1a1a2e; border: 1px solid #2f3741; color: #bdb5b5; border-radius: 4px; }
    .card { background: #16213e; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .stat { display: inline-block; margin-right: 30px; }
    .stat-value { font-size: 2em; color: #fff; font-weight: bold; }
    .stat-label { color: #a4b2a0; font-size: 0.9em; }
    .badge { padding: 4px 8px; border-radius: 4px; font-size: 0.8em; }
    .badge-success { background: #22c55e; color: #fff; }
    .badge-danger { background: #ef4444; color: #fff; }
    .badge-warning { background: #eab308; color: #fff; }
  </style>
</head>
<body>
  <div class="nav">
    <a href="/admin/users" class="${title === 'Users' ? 'active' : ''}">Users</a>
    <a href="/admin/stats" class="${title === 'Statistics' ? 'active' : ''}">Statistics</a>
    <a href="/admin/admin" class="${title === 'Administration' ? 'active' : ''}">Administration</a>
    <a href="/" style="float:right">← Back to Game</a>
  </div>
  ${content}
  ${extra}
</body>
</html>`;
}

// Admin magic key — loaded once from env at startup
const ADMIN_MAGIC_KEY = process.env.ADMIN_SECRET || '';

// Rate limiting for failed admin access attempts: IP -> { count, windowStart, blockedUntil }
const adminAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000; // 1 minute window
const BLOCK_MS = 300_000; // 5 minute block after exceeding limit

function recordFailedAttempt(ip) {
  const now = Date.now();
  const entry = adminAttempts.get(ip) ?? { count: 0, windowStart: now, blockedUntil: 0 };

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

  adminAttempts.set(ip, entry);
  return entry.blockedUntil > 0
    ? { blocked: true, retryAfter: Math.ceil(BLOCK_MS / 1000) }
    : { blocked: false };
}

// Prune stale entries every 10 minutes to prevent unbounded growth
setInterval(() => {
  const cutoff = Date.now() - (BLOCK_MS + WINDOW_MS);
  for (const [ip, entry] of adminAttempts) {
    if (entry.windowStart < cutoff && entry.blockedUntil < Date.now()) {
      adminAttempts.delete(ip);
    }
  }
}, 10 * 60_000).unref();

function getClientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

function requireAdmin(req, res, next) {
  // Authenticated admin via session — fast path, no rate limiting
  if (req.session.isAdmin) {
    return next();
  }

  // Check for magic key in header or query string
  const key = req.headers['x-admin-key'] || req.query.admin_key;
  if (key && ADMIN_MAGIC_KEY && key === ADMIN_MAGIC_KEY) {
    req.session.isAdmin = true;
    req.session.save(() => next());
    return;
  }

  // All other attempts are failures — record and possibly block
  const ip = getClientIp(req);
  const result = recordFailedAttempt(ip);

  if (result.blocked) {
    return res
      .status(429)
      .send(
        renderHTML(
          'Too Many Requests',
          `<h1>Too Many Requests</h1><p>Try again in ${result.retryAfter} seconds.</p>`,
        ),
      );
  }

  return res
    .status(403)
    .send(
      renderHTML(
        'Access Denied',
        '<h1>Access Denied</h1><p>You must be an admin to access this page.</p>',
      ),
    );
}

router.use(requireAdmin);

// ========== USERS PAGE ==========
router.get('/users', (_req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT * FROM users ORDER BY id DESC').all();

  const userRows = users
    .map(
      (u) => `
    <tr>
      <td>${u.id}</td>
      <td><a href="/admin/users/${u.id}" style="color:#d93939">${u.username}</a></td>
      <td>${u.email}</td>
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

  const content = `
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
  `;

  res.send(renderHTML('Users', content));
});

router.post('/users/toggle-admin', express.urlencoded({ extended: true }), (req, res) => {
  const db = getDb();
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(req.body.is_admin, req.body.id);
  res.redirect('/admin/users');
});

router.post('/users/toggle-block', express.urlencoded({ extended: true }), (req, res) => {
  const db = getDb();
  db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(req.body.is_blocked, req.body.id);
  res.redirect('/admin/users');
});

// ========== USER DETAIL PAGE ==========
router.get('/users/:id', (req, res) => {
  const db = getDb();
  const userId = parseInt(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  if (!user) {
    return res.send(
      renderHTML('User Not Found', '<h1>User Not Found</h1><p>The user does not exist.</p>'),
    );
  }

  // Get user stats
  const userStats = db
    .prepare(
      `
    SELECT category, SUM(answered) as answered, SUM(correct) as correct
    FROM user_stats WHERE user_id = ? GROUP BY category
  `,
    )
    .all(userId);

  const totalAnswered = userStats.reduce((sum, s) => sum + s.answered, 0);
  const totalCorrect = userStats.reduce((sum, s) => sum + s.correct, 0);
  const overallAccuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  // Get games won/lost
  const weeqlashRow = db
    .prepare('SELECT games_played, games_won FROM users WHERE id = ?')
    .get(userId);
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
    .get(userId, userId, userId);
  const totalGamesPlayed = (weeqlashRow?.games_played || 0) + (qlasRow?.played || 0);
  const totalGamesWon = (weeqlashRow?.games_won || 0) + (qlasRow?.won || 0);

  // Get recent games
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
    .all(userId, userId);

  // Stats rows
  const statsRows = userStats
    .map((s) => {
      const acc = s.answered > 0 ? Math.round((s.correct / s.answered) * 100) : 0;
      return `<tr><td>${s.category}</td><td>${s.answered}</td><td>${s.correct}</td><td>${acc}%</td></tr>`;
    })
    .join('');

  // Recent games rows
  const gameRows = recentGames
    .map((g) => {
      const isWinner = g.winner_id === userId;
      const isPlayer1 = g.player1_id === userId;
      const opponent = isPlayer1 ? g.p2_name : g.p1_name;
      return `<tr>
      <td>${opponent || 'Unknown'}</td>
      <td>${g.winner_id ? (isWinner ? '<span class="badge badge-success">Won</span>' : '<span class="badge badge-danger">Lost</span>') : '-'}</td>
      <td>${g.game_mode || '-'}</td>
      <td>${Math.round(g.duration_ms / 1000)}s</td>
      <td>${new Date(g.created_at).toLocaleDateString()}</td>
    </tr>`;
    })
    .join('');

  const resetLink = typeof req.query.reset_link === 'string' ? req.query.reset_link : '';
  const resetBanner = resetLink
    ? `<div class="card" style="border:1px solid #22c55e"><strong>Password reset link generated</strong> (expires in 1 hour). Share with user:<br><code style="word-break:break-all;color:#fff">${resetLink}</code></div>`
    : '';

  const content = `
    <h1>User: ${user.username}</h1>
    <p><a href="/admin/users" style="color:#a4b2a0">← Back to Users</a></p>
    ${resetBanner}

    <div class="card">
      <h2>Account Details</h2>
      <form method="post" action="/admin/users/update">
        <input type="hidden" name="id" value="${user.id}">
        <div class="form-group">
          <label>Username</label>
          <input type="text" name="username" value="${user.username}">
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email" value="${user.email}">
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
        <button class="btn btn-secondary" onclick="return confirm('Reset all statistics for this user?')">Reset Statistics</button>
      </form>
      <form method="post" action="/admin/users/reset-password" style="display:inline;margin-right:10px">
        <input type="hidden" name="id" value="${user.id}">
        <button class="btn btn-secondary" onclick="return confirm('Generate a password reset link for this user?')">Send Reset Link</button>
      </form>
      <form method="get" action="/admin/users/${user.id}/export" style="display:inline;margin-right:10px">
        <button class="btn btn-secondary">Export Statistics (JSON)</button>
      </form>
      <form method="post" action="/admin/users/delete" style="display:inline"
            onsubmit="return (prompt('Type the username &quot;${user.username}&quot; to confirm permanent deletion of this user and all their stats/game history:') === '${user.username}')">
        <input type="hidden" name="id" value="${user.id}">
        <button class="btn btn-primary" style="background:#ef4444">Delete User (Cascade)</button>
      </form>
    </div>
  `;

  res.send(renderHTML('User: ' + user.username, content));
});

router.post('/users/update', express.urlencoded({ extended: true }), (req, res) => {
  const db = getDb();
  db.prepare('UPDATE users SET username = ?, email = ? WHERE id = ?').run(
    req.body.username,
    req.body.email,
    req.body.id,
  );
  res.redirect(`/admin/users/${req.body.id}`);
});

router.post('/users/delete', express.urlencoded({ extended: true }), (req, res) => {
  const db = getDb();
  const userId = parseInt(req.body.id, 10);
  if (!Number.isFinite(userId)) {
    return res
      .status(400)
      .send(renderHTML('Bad Request', '<h1>Bad Request</h1><p>Invalid user id.</p>'));
  }
  if (req.session.userId === userId) {
    return res
      .status(400)
      .send(
        renderHTML(
          'Forbidden',
          '<h1>Forbidden</h1><p>You cannot delete the account you are signed in as.</p>',
        ),
      );
  }
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.redirect('/admin/users');
  }
  const cascade = db.transaction((uid) => {
    db.prepare('DELETE FROM user_stats WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM game_history WHERE player1_id = ? OR player2_id = ?').run(uid, uid);
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  });
  cascade(userId);
  console.log(`[admin] Cascade-deleted user id=${userId} username=${user.username}`);
  res.redirect('/admin/users');
});

router.post('/users/reset-stats', express.urlencoded({ extended: true }), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM user_stats WHERE user_id = ?').run(req.body.id);
  res.redirect(`/admin/users/${req.body.id}`);
});

router.post('/users/reset-password', express.urlencoded({ extended: true }), (req, res) => {
  const db = getDb();
  const userId = parseInt(req.body.id, 10);
  if (!Number.isFinite(userId)) {
    return res
      .status(400)
      .send(renderHTML('Bad Request', '<h1>Bad Request</h1><p>Invalid user id.</p>'));
  }
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.redirect('/admin/users');
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 3600000; // 1 hour
  db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(
    token,
    expires,
    userId,
  );
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const resetLink = `${clientUrl}/?reset=${token}`;
  console.log(`[admin] Generated password reset link for user id=${userId}`);
  res.redirect(`/admin/users/${userId}?reset_link=${encodeURIComponent(resetLink)}`);
});

router.post('/users/resend-email', express.urlencoded({ extended: true }), (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.body.id);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('UPDATE users SET confirmation_token = ? WHERE id = ?').run(token, req.body.id);
  }
  res.redirect(`/admin/users/${req.body.id}`);
});

// ========== STATISTICS PAGE ==========
router.get('/stats', (_req, res) => {
  const db = getDb();

  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const activeUsers = db
    .prepare('SELECT COUNT(*) as count FROM users WHERE is_blocked = 0')
    .get().count;
  const totalGames = db.prepare('SELECT COUNT(*) as count FROM game_history').get().count;
  const totalAdmins = db
    .prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 1')
    .get().count;

  // Recent games
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
    .all();

  // Category stats
  const categoryStats = db
    .prepare(
      `
    SELECT category, SUM(answered) as answered, SUM(correct) as correct
    FROM user_stats
    GROUP BY category
    ORDER BY answered DESC
  `,
    )
    .all();

  const gameRows = recentGames
    .map(
      (g) => `
    <tr>
      <td>${g.id}</td>
      <td>${g.p1_name || g.player1_id} vs ${g.p2_name || g.player2_id}</td>
      <td>${g.winner_name || '-'}</td>
      <td>${g.game_mode || '-'}</td>
      <td>${g.board_size}x${g.board_size}</td>
      <td>${Math.round(g.duration_ms / 1000)}s</td>
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
        <td>${c.category}</td>
        <td>${c.answered}</td>
        <td>${c.correct}</td>
        <td>${accuracy}%</td>
      </tr>
    `;
    })
    .join('');

  const content = `
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
  `;

  res.send(renderHTML('Statistics', content));
});

// ========== ADMIN PAGE ==========
router.get('/admin', (_req, res) => {
  // Game settings from database or defaults
  const content = `
    <h1>Administration</h1>
    
    <h2>Quick Actions</h2>
    <div class="card">
      <p>Welcome to the admin panel. Use the navigation above to manage:</p>
      <ul style="margin: 10px 0 10px 20px;">
        <li><strong>Users</strong> - View, promote, or block users</li>
        <li><strong>Statistics</strong> - View game analytics and category performance</li>
        <li><strong>Administration</strong> - This page</li>
      </ul>
    </div>

    <h2>System Info</h2>
    <div class="card">
      <p><strong>Database:</strong> SQLite (weeqlash)</p>
      <p><strong>Server Time:</strong> ${new Date().toLocaleString()}</p>
    </div>
  `;

  res.send(renderHTML('Administration', content));
});

// ========== EXPORT STATISTICS ==========
router.get('/users/:id/export', (req, res) => {
  const db = getDb();
  const userId = parseInt(req.params.id);
  const user = db
    .prepare(
      'SELECT id, username, email, is_admin, is_blocked, email_confirmed, created_at, last_login, games_played, games_won FROM users WHERE id = ?',
    )
    .get(userId);

  if (!user) {
    return res.send('User does not exist');
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
