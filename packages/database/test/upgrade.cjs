const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, copyFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { prepareDatabase } = require('../../../tests/helpers/database.cjs');
const packageRoot = path.resolve(__dirname, '..');
const initial = '20261021000000_init';
function deploy(schema) {
  return spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema],
    { cwd: packageRoot, env: process.env, encoding: 'utf8' });
}
async function probe() {
  const prisma = await prepareDatabase({ migrate: false });
  const folder = mkdtempSync(path.join(tmpdir(), 'weavefield-upgrade-'));
  try {
    const [state] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`;
    assert.equal(state.count, 0, 'Upgrade probes must start with an empty newly created database');
    const migrations = path.join(folder, 'migrations');
    mkdirSync(path.join(migrations, initial), { recursive: true });
    copyFileSync(path.join(packageRoot, 'prisma/schema.prisma'), path.join(folder, 'schema.prisma'));
    copyFileSync(path.join(packageRoot, 'prisma/migrations/migration_lock.toml'), path.join(migrations, 'migration_lock.toml'));
    copyFileSync(path.join(packageRoot, 'prisma/migrations', initial, 'migration.sql'), path.join(migrations, initial, 'migration.sql'));
    const first = deploy(path.join(folder, 'schema.prisma'));
    assert.equal(first.status, 0, 'Initial migration must apply to the fresh probe');
    const originalEmail = ' Legacy.User@Example.invalid ';
    await prisma.$executeRaw`INSERT INTO "User" (id, email, "displayName") VALUES ('legacy-probe', ${originalEmail}, 'Existing user')`;
    if (process.env.UPGRADE_PROBE === 'conflict') {
      await prisma.$executeRaw`INSERT INTO "User" (id, email, "displayName") VALUES ('legacy-conflict', 'legacy.user@example.invalid', 'Conflicting user')`;
    }
    const before = await prisma.$queryRaw`SELECT id, email, "displayName", "createdAt" FROM "User" ORDER BY id`;
    const upgrade = deploy('prisma/schema.prisma');
    if (process.env.UPGRADE_PROBE === 'conflict') {
      assert.notEqual(upgrade.status, 0);
      assert.match(upgrade.stdout + upgrade.stderr, /Existing user emails conflict after normalization/);
      const [columns] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'passwordHash'`;
      assert.equal(columns.count, 0, 'Failed migration must roll back added fields');
      assert.deepEqual(await prisma.$queryRaw`SELECT id, email, "displayName", "createdAt" FROM "User" ORDER BY id`, before);
      console.log('PASS conflicting legacy emails block migration atomically; both existing records unchanged');
    } else {
      assert.equal(upgrade.status, 0, upgrade.stdout + upgrade.stderr);
      assert.deepEqual(await prisma.$queryRaw`SELECT id, email, "displayName", "createdAt" FROM "User" ORDER BY id`, before);
      const legacy = await prisma.user.findUniqueOrThrow({ where: { id: 'legacy-probe' } });
      assert.equal(legacy.emailCanonical, 'legacy.user@example.invalid');
      assert.equal(legacy.passwordHash, null);
      assert.equal(await prisma.session.count(), 0);
      assert.equal(deploy('prisma/schema.prisma').status, 0);
      console.log('PASS initial-to-auth upgrade preserves old data, backfills normalized email, adds no default password and redeploys safely');
    }
  } finally { await prisma.$disconnect(); rmSync(folder, { recursive: true, force: true }); }
}
async function main() {
  if (process.env.UPGRADE_PROBE) return probe();
  const prisma = await prepareDatabase();
  try {
    for (const mode of ['success', 'conflict']) {
      const name = `weavefield_test_upgrade_${mode}_${randomBytes(6).toString('hex')}`;
      // 名称只由常量与随机十六进制组成；仅在已核对的本地测试服务器新建专用库。
      await prisma.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      const url = new URL(process.env.DATABASE_TEST_URL); url.pathname = `/${name}`;
      const result = spawnSync(process.execPath, [__filename], {
        cwd: packageRoot, env: { ...process.env, DATABASE_TEST_URL: url.href, UPGRADE_PROBE: mode }, stdio: 'inherit',
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, `${mode} upgrade probe must pass`);
      console.log(`Retained isolated upgrade database: ${name}`);
    }
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { if (error?.name === 'AssertionError') console.error(error.message); else console.error('Upgrade probe error code:', error?.code ?? 'unknown'); console.error('Upgrade verification failed; no database has been deleted'); process.exitCode = 1; });
