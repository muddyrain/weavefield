const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const databaseRequire = createRequire(path.join(root, 'packages/database/package.json'));

async function prepareDatabase({ migrate = true } = {}) {
  let target;
  try { target = new URL(process.env.DATABASE_TEST_URL || ''); }
  catch { throw new Error('A local DATABASE_TEST_URL is required'); }
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol)
    && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
    && /^\/weavefield_test_[a-z0-9_]+$/.test(target.pathname)
    && [...target.searchParams.keys()].every(key => key === 'schema')
    && target.searchParams.getAll('schema').length <= 1
    && (!target.searchParams.has('schema') || target.searchParams.get('schema') === 'public'),
  'Tests require a local weavefield_test_* database in schema public');
  process.env.DATABASE_URL = target.href;
  const { prisma } = databaseRequire('@weavefield/database');
  try {
    await prisma.$connect();
    const [server] = await prisma.$queryRaw`SELECT current_database() AS name, current_setting('server_version_num')::int AS version`;
    assert.equal(server.name, target.pathname.slice(1));
    assert.ok(server.version >= 160000 && server.version < 170000, 'Tests require PostgreSQL 16');
    if (migrate) {
      const result = spawnSync(process.execPath, [databaseRequire.resolve('prisma/build/index.js'),
        'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
        cwd: path.join(root, 'packages/database'), env: process.env, stdio: 'inherit',
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, 'Test migrations must succeed');
    }
    return prisma;
  } catch (error) { await prisma.$disconnect(); throw error; }
}
module.exports = { prepareDatabase };
