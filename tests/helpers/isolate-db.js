// Import FIRST (before server/index.js) so each worker gets its own DB file.
import path from 'path';
import os from 'os';

process.env.DB_PATH = path.join(
  os.tmpdir(),
  `weeqlash-test-${process.pid}-${process.hrtime.bigint()}.db`,
);
