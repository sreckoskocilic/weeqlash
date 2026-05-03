import express from 'express';
import { getDb } from '../game/leaderboard.ts';

const router = express.Router();

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

// Helper to render simple HTML
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
    .form-label { display: block; margin-bottom: 5px; font-weight: bold; }
    .form-input { width: 100%; padding: 8px; border: 1px solid #2f3741; border-radius: 4px; background: #0d1525; color: #fff; }
    .form-textarea { width: 100%; height: 100px; padding: 8px; border: 1px solid #2f3741; border-radius: 4px; background: #0d1525; color: #fff; }
    .alert { padding: 12px; margin-bottom: 15px; border-radius: 4px; }
    .alert-success { background: #2f3741; color: #4ade80; border: 1px solid #16213e; }
    .alert-error { background: #2f3741; color: #f87171; border: 1px solid #16213e; }
    .alert-info { background: #2f3741; color: #60a5fa; border: 1px solid #16213e; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 15px; }
    .stat-card { background: #16213e; padding: 15px; border-radius: 8px; border: 1px solid #2f3741; }
    .stat-value { font-size: 2rem; font-weight: bold; color: #60a5fa; }
    .stat-label { font-size: 0.9rem; color: #bdb5b5; text-transform: uppercase; letter-spacing: 0.5px; }
  </style>
</head>
<body>
  <div class="nav">
    <a href="/admin/">Dashboard</a>
    <a href="/admin/users">Users</a>
    <a href="/admin/stats">Statistics</a>
    <a href="/admin/export">Export Data</a>
  </div>
  ${content}
  ${extra}
</body>
</html>`;
}

// Admin magic key — loaded once from env at startup
const ADMIN_MAGIC_KEY = process.env.ADMIN_SECRET || '';

// Rate limiting for failed admin access attempts: IP -> { count, windowStart, blockedUntil }
const adminAttempts = new Map<
  string,
  { count: number; windowStart: number; blockedUntil: number }
>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000; // 1 minute window
const BLOCK_MS = 300_000; // 5 minute block after exceeding limit

function recordFailedAttempt(ip: string): { blocked: boolean; retryAfter?: number } {
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
    return { blocked: true };
  }

  return { blocked: false };
}

// Middleware to check admin magic key
function checkAdminKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const providedKey =
    (Array.isArray(req.headers['x-admin-key'])
      ? req.headers['x-admin-key'][0]
      : (req.headers['x-admin-key'] ?? '')) ||
    req.query.key ||
    '';
  if (providedKey === ADMIN_MAGIC_KEY && ADMIN_MAGIC_KEY !== '') {
    next();
  } else {
    res.status(401).send(renderHTML('Unauthorized', '<p>Invalid or missing admin key</p>'));
  }
}

// Apply admin key check to all routes
router.use(checkAdminKey);

// Middleware to track failed attempts by IP
function trackFailedAttempts(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const ip =
    (Array.isArray(req.headers['x-forwarded-for'])
      ? req.headers['x-forwarded-for'][0]
      : req.headers['x-forwarded-for']) ||
    (req.socket.remoteAddress ?? 'unknown');
  const result = recordFailedAttempt(ip);

  if (result.blocked) {
    const retryAfter = result.retryAfter || 300;
    res
      .status(429)
      .send(
        renderHTML(
          'Too Many Requests',
          `<p>Too many failed attempts. Please try again after ${retryAfter} seconds.</p>`,
        ),
      );
  } else {
    next();
  }
}

// Apply rate limiting middleware
router.use(trackFailedAttempts);

// Dashboard route
router.get('/', (req: express.Request, res: express.Response) => {
  const db = getDb();
  if (!db) {
    res.status(500).send(renderHTML('Error', '<p>Database not available</p>'));
    return;
  }

  try {
    // Get basic stats
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    const qlasGameCount = db
      .prepare("SELECT COUNT(*) as count FROM game_history WHERE game_mode = 'qlashique'")
      .get() as { count: number };
    const quizCount = db.prepare('SELECT COUNT(*) as count FROM leaderboard').get() as {
      count: number;
    };

    const html = renderHTML(
      'Dashboard',
      `
      <h1>Weeqlash Admin Dashboard</h1>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${userCount.count}</div>
          <div class="stat-label">Total Users</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${qlasGameCount.count}</div>
          <div class="stat-label">Qlashique Games</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${quizCount.count}</div>
          <div class="stat-label">Quiz Scores</div>
        </div>
      </div>
      <p><a href="/admin/users" class="btn btn-primary">Manage Users</a></p>
      <p><a href="/admin/stats" class="btn btn-primary">View Statistics</a></p>
      <p><a href="/admin/export" class="btn btn-primary">Export Data</a></p>
    `,
    );
    res.send(html);
  } catch (error) {
    console.error('[admin] Dashboard error:', error as Error);
    res
      .status(500)
      .send(renderHTML('Error', `<p>Failed to load dashboard: ${(error as Error).message}</p>`));
  }
});

// Users list route
router.get('/users', (req: express.Request, res: express.Response) => {
  const db = getDb();
  if (!db) {
    res.status(500).send(renderHTML('Error', '<p>Database not available</p>'));
    return;
  }

  try {
    const users = db
      .prepare(
        'SELECT id, username, email, email_confirmed, is_blocked, is_admin, created_at FROM users ORDER BY created_at DESC',
      )
      .all() as Array<{
      id: number;
      username: string;
      email: string;
      email_confirmed: number;
      is_blocked: number;
      is_admin: number;
      created_at: number;
    }>;

    const usersHtml =
      users.length > 0
        ? `
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Username</th>
            <th>Email</th>
            <th>Confirmed</th>
            <th>Blocked</th>
            <th>Admin</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          ${users
            .map(
              (user) => `
            <tr>
              <td>${user.id}</td>
              <td>${esc(user.username)}</td>
              <td>${esc(user.email)}</td>
              <td>${user.email_confirmed === 1 ? 'Yes' : 'No'}</td>
              <td>${user.is_blocked === 1 ? 'Yes' : 'No'}</td>
              <td>${user.is_admin === 1 ? 'Yes' : 'No'}</td>
              <td>${new Date(user.created_at).toLocaleString()}</td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>
      `
        : '<p>No users found</p>';

    const html = renderHTML(
      'Users',
      `
      <h1>User Management</h1>
      ${usersHtml}
      <p><a href="/admin/" class="btn btn-secondary">← Back to Dashboard</a></p>
    `,
    );
    res.send(html);
  } catch (error) {
    console.error('[admin] Users error:', error as Error);
    res
      .status(500)
      .send(renderHTML('Error', `<p>Failed to load users: ${(error as Error).message}</p>`));
  }
});

// Stats route
router.get('/stats', (req: express.Request, res: express.Response) => {
  const db = getDb();
  if (!db) {
    res.status(500).send(renderHTML('Error', '<p>Database not available</p>'));
    return;
  }

  try {
    // Get game statistics
    const gameStats = db
      .prepare(
        `
      SELECT
        game_mode,
        COUNT(*) as total_games,
        SUM(CASE WHEN winner_id = 1 THEN 1 ELSE 0 END) as player1_wins,
        SUM(CASE WHEN winner_id = 2 THEN 1 ELSE 0 END) as player2_wins
      FROM game_history
      GROUP BY game_mode
    `,
      )
      .all() as Array<{
      game_mode: string;
      total_games: number;
      player1_wins: number;
      player2_wins: number;
    }>;

    // Get top players
    const topPlayers = db
      .prepare(
        `
      SELECT username, games_played, games_won
      FROM users
      WHERE games_played > 0
      ORDER BY (games_won * 1.0 / games_played) DESC, games_won DESC
      LIMIT 10
    `,
      )
      .all() as Array<{
      username: string;
      games_played: number;
      games_won: number;
    }>;

    const statsHtml = `
      <h2>Game Statistics</h2>
      <table>
        <thead>
          <tr>
            <th>Game Mode</th>
            <th>Total Games</th>
            <th>Player 1 Wins</th>
            <th>Player 2 Wins</th>
          </tr>
        </thead>
        <tbody>
          ${gameStats
            .map(
              (stat) => `
            <tr>
              <td>${esc(stat.game_mode)}</td>
              <td>${stat.total_games}</td>
              <td>${stat.player1_wins}</td>
              <td>${stat.player2_wins}</td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>

      <h2>Top Players (Win Rate)</h2>
      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Games Played</th>
            <th>Games Won</th>
            <th>Win Rate</th>
          </tr>
        </thead>
        <tbody>
          ${topPlayers
            .map(
              (player) => `
            <tr>
              <td>${esc(player.username)}</td>
              <td>${player.games_played}</td>
              <td>${player.games_won}</td>
              <td>${((player.games_won / player.games_played) * 100).toFixed(1)}%</td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>
    `;

    const html = renderHTML(
      'Statistics',
      `
      <h1>Weeqlash Statistics</h1>
      ${statsHtml}
      <p><a href="/admin/" class="btn btn-secondary">← Back to Dashboard</a></p>
    `,
    );
    res.send(html);
  } catch (error) {
    console.error('[admin] Stats error:', error as Error);
    res
      .status(500)
      .send(renderHTML('Error', `<p>Failed to load statistics: ${(error as Error).message}</p>`));
  }
});

// Export data route
router.get('/export', (req: express.Request, res: express.Response) => {
  const db = getDb();
  if (!db) {
    res.status(500).send(renderHTML('Error', '<p>Database not available</p>'));
    return;
  }

  const exportType = (req.query.type as string) || 'all';

  try {
    const exportData: any = { exportedAt: new Date().toISOString() };

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
        .all() as Array<{
        id: number;
        username: string;
        email: string;
        email_confirmed: number;
        is_blocked: number;
        is_admin: number;
        created_at: number;
        games_played: number;
        games_won: number;
      }>;
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
        .all() as Array<{
        id: number;
        player1_id: number;
        player2_id: number;
        winner_id: number | null;
        game_mode: string;
        board_size: number | null;
        duration_ms: number | null;
        player1_stats: string;
        player2_stats: string;
        created_at: number;
      }>;
    }

    if (exportType === 'all' || exportType === 'leaderboard') {
      exportData.leaderboard = db
        .prepare(
          `
        SELECT mode, name, answers, time_ms, created_at
        FROM leaderboard
        ORDER BY mode, answers DESC, time_ms ASC
      `,
        )
        .all() as Array<{
        mode: string;
        name: string;
        answers: number;
        time_ms: number;
        created_at: number;
      }>;
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=weeqlash-export-${exportType}-${new Date().toISOString().slice(0, 10)}.json`,
    );
    res.send(JSON.stringify(exportData, null, 2));
  } catch (error) {
    console.error('[admin] Export error:', error as Error);
    res
      .status(500)
      .send(renderHTML('Error', `<p>Failed to export data: ${(error as Error).message}</p>`));
  }
});

// Individual user stats route
router.get('/user/:id', (req: express.Request, res: express.Response) => {
  const db = getDb();
  if (!db) {
    res.status(500).send(renderHTML('Error', '<p>Database not available</p>'));
    return;
  }

  const userId = parseInt(String(req.params.id));
  if (isNaN(userId)) {
    res.status(400).send(renderHTML('Error', '<p>Invalid user ID</p>'));
    return;
  }

  try {
    const user = db
      .prepare(
        `
      SELECT id, username, email, email_confirmed, is_blocked, is_admin, created_at,
             games_played, games_won
      FROM users
      WHERE id = ?
    `,
      )
      .get(userId) as
      | {
          id: number;
          username: string;
          email: string;
          email_confirmed: number;
          is_blocked: number;
          is_admin: number;
          created_at: number;
          games_played: number;
          games_won: number;
        }
      | undefined;

    if (!user) {
      res.status(404).send(renderHTML('Error', `<p>User with ID ${userId} not found</p>`));
      return;
    }

    const userStats = db
      .prepare(
        `
      SELECT category, answered, correct
      FROM user_stats
      WHERE user_id = ?
      ORDER BY category
    `,
      )
      .all(userId) as Array<{
      category: string;
      answered: number;
      correct: number;
    }>;

    const html = renderHTML(
      `User ${esc(user.username)}`,
      `
      <h1>User Details</h1>
      <div class="stat-card">
        <div class="stat-value">${esc(user.username)}</div>
        <div class="stat-label">Username</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${esc(user.email)}</div>
        <div class="stat-label">Email</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${user.email_confirmed === 1 ? 'Yes' : 'No'}</div>
        <div class="stat-label">Email Confirmed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${user.is_blocked === 1 ? 'Yes' : 'No'}</div>
        <div class="stat-label">Blocked</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${user.is_admin === 1 ? 'Yes' : 'No'}</div>
        <div class="stat-label">Admin</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${user.games_played}</div>
        <div class="stat-label">Games Played</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${user.games_won}</div>
        <div class="stat-label">Games Won</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${new Date(user.created_at).toLocaleString()}</div>
        <div class="stat-label">Created At</div>
      </div>

      <h2>Statistics by Category</h2>
      ${
        userStats.length > 0
          ? `
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Questions Answered</th>
              <th>Correct Answers</th>
              <th>Accuracy</th>
            </tr>
          </thead>
          <tbody>
            ${userStats
              .map(
                (stat) => `
              <tr>
                <td>${esc(stat.category)}</td>
                <td>${stat.answered}</td>
                <td>${stat.correct}</td>
                <td>${stat.answered > 0 ? ((stat.correct / stat.answered) * 100).toFixed(1) + '%' : '0%'}</td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
        `
          : '<p>No statistics available</p>'
      }

      <p><a href="/admin/users" class="btn btn-secondary">← Back to Users</a></p>
    `,
    );
    res.send(html);
  } catch (error) {
    console.error('[admin] User stats error:', error as Error);
    res
      .status(500)
      .send(renderHTML('Error', `<p>Failed to load user stats: ${(error as Error).message}</p>`));
  }
});

export default router;
