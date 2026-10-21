const { prepareDatabase } = require('./database.cjs');
const path = require('node:path');
async function main() {
  await prepareDatabase();
  process.env.WEB_ORIGIN = 'http://127.0.0.1:15173';
  const { createApplication } = require(path.resolve(__dirname, '../../apps/api/dist/application'));
  const app = await createApplication();
  await app.listen(13001, '127.0.0.1');
  console.log('[e2e-api] ready');
}
main().catch(() => { console.error('E2E API requires a migrated local PostgreSQL 16 test database'); process.exitCode = 1; });
