// Import FIRST (before server/index.js) so each worker gets its own DB file and Redis namespace.
import path from 'path';
import os from 'os';

const workerTag = `${process.pid}-${process.hrtime.bigint()}`;

process.env.DB_PATH = path.join(os.tmpdir(), `weeqlash-test-${workerTag}.db`);
// User ids restart at 1 in every worker DB, so shared Redis keys like user:activesid:1 would collide.
process.env.SESSION_PREFIX = `test-${workerTag}:`;
