import AdminJS from 'adminjs';
import { getDb } from './leaderboard.js';

// Simple admin setup without custom adapter
export function buildAdminOptions() {
  const db = getDb();

  // Direct SQL adapter for users
  const usersResource = {
    name: 'User',
    id: 'user',
    database: db,
    tableName: 'users',
    columns: ['id', 'username', 'email', 'is_blocked', 'is_admin', 'email_confirmed', 'created_at', 'last_login'],
  };

  const gameHistoryResource = {
    name: 'GameHistory',
    id: 'game_history',
    database: db,
    tableName: 'game_history',
    columns: ['id', 'player1_id', 'player2_id', 'winner_id', 'game_mode', 'board_size', 'duration_ms', 'created_at'],
  };

  const userStatsResource = {
    name: 'UserStats',
    id: 'user_stats',
    database: db,
    tableName: 'user_stats',
    columns: ['user_id', 'category', 'answered', 'correct'],
  };

  const admin = new AdminJS({
    rootPath: '/admin',
    logoutPath: '/auth/logout',
    loginPath: '/auth/login',
    branding: {
      companyName: 'Weeqlash Admin',
    },
    resources: [usersResource, gameHistoryResource, userStatsResource],
  });

  return admin;
}

  static isAdapterFor(raw) {
    return raw instanceof UserResource;
  }

  id() {
    return 'User';
  }

  properties() {
    return [
      new BaseProperty({ name: 'id', path: 'id', isId: true, type: 'number' }),
      new BaseProperty({ name: 'username', path: 'username', isTitle: true, type: 'string' }),
      new BaseProperty({ name: 'email', path: 'email', type: 'string' }),
      new BaseProperty({ name: 'is_blocked', path: 'is_blocked', type: 'boolean' }),
      new BaseProperty({ name: 'is_admin', path: 'is_admin', type: 'boolean' }),
      new BaseProperty({ name: 'email_confirmed', path: 'email_confirmed', type: 'boolean' }),
      new BaseProperty({ name: 'created_at', path: 'created_at', type: 'datetime' }),
      new BaseProperty({ name: 'last_login', path: 'last_login', type: 'datetime' }),
    ];
  }

  _transformProperties(props) {
    return props;
  }

  async rawFind(query) {
    let sql = 'SELECT * FROM users';
    const params = [];
    const conditions = [];

    const filters = query.filters || {};

    if (filters.username) {
      conditions.push('username LIKE ?');
      params.push(`%${filters.username}%`);
    }
    if (filters.email) {
      conditions.push('email LIKE ?');
      params.push(`%${filters.email}%`);
    }
    if (filters.is_blocked !== undefined) {
      conditions.push('is_blocked = ?');
      params.push(filters.is_blocked ? 1 : 0);
    }
    if (filters.is_admin !== undefined) {
      conditions.push('is_admin = ?');
      params.push(filters.is_admin ? 1 : 0);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(query.limit || 50, query.offset || 0);

    return this.db.prepare(sql).all(...params);
  }

  async count(_filter) {
    return this.db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  }

  async findOne(id) {
    const record = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!record) {return null;}
    return new BaseRecord(this, {
      ...record,
      is_blocked: !!record.is_blocked,
      is_admin: !!record.is_admin,
      email_confirmed: !!record.email_confirmed,
    });
  }

  async find(query) {
    const records = await this.rawFind(query);
    return records.map(r => new BaseRecord(this, {
      ...r,
      is_blocked: !!r.is_blocked,
      is_admin: !!r.is_admin,
      email_confirmed: !!r.email_confirmed,
    }));
  }

  async create(params) {
    return params;
  }

  async update(id, params) {
    const fields = [];
    const values = [];

    if (params.is_blocked !== undefined) {
      fields.push('is_blocked = ?');
      values.push(params.is_blocked ? 1 : 0);
    }
    if (params.is_admin !== undefined) {
      fields.push('is_admin = ?');
      values.push(params.is_admin ? 1 : 0);
    }

    if (fields.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
    return this.findOne(id);
  }

  async delete(id) {
    return { id };
  }

  databaseName() {
    return 'weeqlash';
  }
}

class GameHistoryResource extends BaseResource {
  constructor(db) {
    super({ name: 'GameHistory' });
    this.db = db;
  }

  static isAdapterFor(raw) {
    return raw instanceof GameHistoryResource;
  }

  id() {
    return 'GameHistory';
  }

  properties() {
    return [
      new BaseProperty({ name: 'id', path: 'id', isId: true, type: 'number' }),
      new BaseProperty({ name: 'player1_id', path: 'player1_id', type: 'number' }),
      new BaseProperty({ name: 'player2_id', path: 'player2_id', type: 'number' }),
      new BaseProperty({ name: 'winner_id', path: 'winner_id', type: 'number' }),
      new BaseProperty({ name: 'game_mode', path: 'game_mode', type: 'string' }),
      new BaseProperty({ name: 'board_size', path: 'board_size', type: 'number' }),
      new BaseProperty({ name: 'duration_ms', path: 'duration_ms', type: 'number' }),
      new BaseProperty({ name: 'created_at', path: 'created_at', type: 'datetime' }),
    ];
  }

  _transformProperties(props) {
    return props;
  }

  async count(_filter) {
    return this.db.prepare('SELECT COUNT(*) as count FROM game_history').get().count;
  }

  async findOne(id) {
    const record = this.db.prepare('SELECT * FROM game_history WHERE id = ?').get(id);
    if (!record) {return null;}
    return new BaseRecord(this, record);
  }

  async find(query) {
    let sql = 'SELECT * FROM game_history';
    const params = [];
    const conditions = [];

    const filters = query.filters || {};

    if (filters.game_mode) {
      conditions.push('game_mode = ?');
      params.push(filters.game_mode);
    }
    if (filters.board_size) {
      conditions.push('board_size = ?');
      params.push(filters.board_size);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(query.limit || 50, query.offset || 0);

    const records = this.db.prepare(sql).all(...params);
    return records.map(r => new BaseRecord(this, r));
  }

  async create(params) {
    return params;
  }

  async update(id, _params) {
    return this.findOne(id);
  }

  async delete(id) {
    return { id };
  }

  databaseName() {
    return 'weeqlash';
  }
}

class UserStatsResource extends BaseResource {
  constructor(db) {
    super({ name: 'UserStats' });
    this.db = db;
  }

  static isAdapterFor(raw) {
    return raw instanceof UserStatsResource;
  }

  id() {
    return 'UserStats';
  }

  properties() {
    return [
      new BaseProperty({ name: 'user_id', path: 'user_id', isId: true, type: 'number' }),
      new BaseProperty({ name: 'category', path: 'category', type: 'string' }),
      new BaseProperty({ name: 'answered', path: 'answered', type: 'number' }),
      new BaseProperty({ name: 'correct', path: 'correct', type: 'number' }),
      new BaseProperty({ name: 'total_answered', path: 'total_answered', type: 'number' }),
      new BaseProperty({ name: 'total_correct', path: 'total_correct', type: 'number' }),
      new BaseProperty({ name: 'accuracy', path: 'accuracy', type: 'string' }),
    ];
  }

  _transformProperties(props) {
    return props;
  }

  async count(_filter) {
    return this.db.prepare('SELECT COUNT(*) as count FROM user_stats').get().count;
  }

  async findOne(id) {
    const records = this.db.prepare('SELECT * FROM user_stats WHERE user_id = ?').all(id);
    if (!records || records.length === 0) { return null; }
    // Aggregate stats for this user since composite key can't be handled well
    const totalAnswered = records.reduce((sum, r) => sum + r.answered, 0);
    const totalCorrect = records.reduce((sum, r) => sum + r.correct, 0);
    return new BaseRecord(this, {
      user_id: parseInt(id),
      categories: records.map(r => r.category).join(', '),
      total_answered: totalAnswered,
      total_correct: totalCorrect,
      accuracy: totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) + '%' : '0%',
    });
  }

  async find(query) {
    let sql = 'SELECT * FROM user_stats';
    const params = [];

    const filters = query.filters || {};

    if (filters.user_id) {
      sql += ' WHERE user_id = ?';
      params.push(filters.user_id);
    }
    sql += ' LIMIT ? OFFSET ?';
    params.push(query.limit || 50, query.offset || 0);

    const records = this.db.prepare(sql).all(...params);
    return records.map(r => new BaseRecord(this, r));
  }

  async create(params) {
    return params;
  }

  async update(id, _params) {
    return this.findOne(id);
  }

  async delete(id) {
    return { id };
  }

  databaseName() {
    return 'weeqlash';
  }
}

export function buildAdminOptions() {
  const db = getDb();

  const admin = new AdminJS({
    rootPath: '/admin',
    logoutPath: '/auth/logout',
    loginPath: '/auth/login',
    branding: {
      companyName: 'Weeqlash Admin',
    },
    resources: [
      {
        resource: new UserResource(db),
        options: {
          listProperties: ['id', 'username', 'email', 'is_blocked', 'is_admin', 'email_confirmed', 'created_at', 'last_login'],
          showProperties: ['id', 'username', 'email', 'is_blocked', 'is_admin', 'email_confirmed', 'created_at', 'last_login'],
          editProperties: ['is_blocked', 'is_admin'],
          filterProperties: ['username', 'email', 'is_blocked', 'is_admin'],
          navigation: { name: 'User Management', icon: 'User' },
          actions: {
            makeAdmin: {
              actionType: 'record',
              icon: 'Crown',
              label: 'Make Admin',
              handler: async (request, response, context) => {
                const { record, currentAdmin } = context;
                if (!currentAdmin) {
                  return { notice: { message: 'Not authenticated', type: 'error' } };
                }
                const userId = record.params.id;
                db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(userId);
                return { record: record.toJSON(currentAdmin), notice: { message: 'User is now an admin', type: 'success' } };
              }
            },
            removeAdmin: {
              actionType: 'record',
              icon: 'User',
              label: 'Remove Admin',
              handler: async (request, response, context) => {
                const { record, currentAdmin } = context;
                if (!currentAdmin) {
                  return { notice: { message: 'Not authenticated', type: 'error' } };
                }
                const userId = record.params.id;
                db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(userId);
                return { record: record.toJSON(currentAdmin), notice: { message: 'Admin role removed', type: 'success' } };
              }
            },
            resetPassword: {
              actionType: 'record',
              icon: 'Key',
              label: 'Reset Password',
              handler: async (request, response, context) => {
                const { record, currentAdmin } = context;
                if (!currentAdmin) {
                  return { notice: { message: 'Not authenticated', type: 'error' } };
                }
                const userId = record.params.id;
                const crypto = await import('crypto');
                const resetToken = crypto.randomBytes(32).toString('hex');
                const expires = Date.now() + 3600000;
                db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(resetToken, expires, userId);
                return { record: record.toJSON(currentAdmin), notice: { message: 'Password reset token generated', type: 'success' } };
              }
            },
          },
        },
      },
      {
        resource: new GameHistoryResource(db),
        options: {
          listProperties: ['id', 'player1_id', 'player2_id', 'winner_id', 'game_mode', 'board_size', 'duration_ms', 'created_at'],
          showProperties: ['id', 'player1_id', 'player2_id', 'winner_id', 'game_mode', 'board_size', 'duration_ms', 'created_at'],
          filterProperties: ['game_mode', 'board_size'],
          navigation: { name: 'Analytics', icon: 'Chart' },
        },
      },
      {
        resource: new UserStatsResource(db),
        options: {
          listProperties: ['user_id', 'category', 'answered', 'correct'],
          showProperties: ['user_id', 'category', 'answered', 'correct'],
          filterProperties: ['user_id', 'category'],
          navigation: { name: 'Analytics', icon: 'Chart' },
        },
      },
    ],
    dashboard: {
      handler: async () => {
        const statsDb = getDb();
        const stats = {
          totalUsers: statsDb.prepare('SELECT COUNT(*) as count FROM users').get().count,
          blockedUsers: statsDb.prepare('SELECT COUNT(*) as count FROM users WHERE is_blocked = 1').get().count,
          totalGames: statsDb.prepare('SELECT COUNT(*) as count FROM game_history').get().count,
          totalAdmins: statsDb.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 1').get().count,
        };
        return { stats };
      },
      component: 'Dashboard',
    },
  });

  return admin;
}

export function getAdmin() {
  return buildAdminOptions();
}