const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// 必须先检查目标，再加载 Client 或执行迁移。测试不清库，只删除本次创建的记录。
const targetError = 'DATABASE_TEST_URL must target a local weavefield_test_* database in schema public';
let target;
try {
  target = new URL(process.env.DATABASE_TEST_URL || '');
} catch {
  // URL 解析错误会携带原始输入，不能将可能包含密码的输入写入日志。
  throw new Error(targetError);
}
if (!['postgresql:', 'postgres:'].includes(target.protocol)
  || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
  || !/^\/weavefield_test_[a-z0-9_]+$/.test(target.pathname)
  || [...target.searchParams.keys()].some(key => key !== 'schema')
  || target.searchParams.getAll('schema').length > 1
  || (target.searchParams.has('schema') && target.searchParams.get('schema') !== 'public')) {
  throw new Error(targetError);
}
process.env.DATABASE_URL = target.href;
const { prisma, WorkspaceRole } = require('@weavefield/database');
const packageRoot = path.resolve(__dirname, '..');
const id = `m11-${randomUUID()}`;
const workspaceIds = [`${id}-workspace`, `${id}-other`];

function runPrisma(args) {
  const result = spawnSync(process.execPath, [
    require.resolve('prisma/build/index.js'), ...args,
  ], { cwd: packageRoot, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Prisma ${args[0]} ${args[1]} must succeed`);
}

function deploy() {
  runPrisma(['migrate', 'deploy', '--schema', 'prisma/schema.prisma']);
}

async function main() {
  // 先只读核对实际数据库身份和版本，再允许执行迁移。
  await prisma.$connect();
  const [server] = await prisma.$queryRaw`SELECT current_database() AS name, current_setting('server_version_num')::int AS version`;
  assert.equal(server.name, target.pathname.slice(1));
  assert.ok(server.version >= 160000 && server.version < 170000, 'Database acceptance requires PostgreSQL 16');
  deploy();
  runPrisma(['migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma',
    '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code']);
  console.log('PASS PostgreSQL 16 connection, initial migration and no schema drift');

  try {
    // 模拟创建空间与其 owner 的原子操作，不添加注册或工作空间业务 API。
    await prisma.$transaction(async tx => {
      await tx.user.create({ data: { id, email: `${id}@example.invalid`, displayName: 'M1.1 probe' } });
      for (const workspaceId of workspaceIds) {
        await tx.workspace.create({ data: {
          id: workspaceId, slug: workspaceId, name: 'M1.1 test workspace',
          memberships: { create: { userId: id, role: WorkspaceRole.OWNER } },
        } });
      }
      await tx.document.create({ data: {
        id, workspaceId: workspaceIds[0], title: 'Before update', ydocRoomName: `doc:${id}`,
        snapshots: { create: { id, revision: 1, binaryState: Buffer.from([0, 1, 127, 255]) } },
      } });
    });
    const updated = await prisma.document.update({ where: { id }, data: { title: 'After update' } });
    assert.equal(updated.title, 'After update');
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceIds[0] }, include: { memberships: true, documents: true },
    });
    assert.equal(workspace.memberships[0].role, WorkspaceRole.OWNER);
    assert.equal(workspace.documents[0].title, 'After update');
    assert.equal(await prisma.document.count({ where: { workspaceId: workspaceIds[1] } }), 0);
    const snapshot = await prisma.documentSnapshot.findUniqueOrThrow({ where: { id } });
    assert.deepEqual(Buffer.from(snapshot.binaryState), Buffer.from([0, 1, 127, 255]));
    console.log('PASS transactional create, relational query, update, workspace filter and Bytes round trip');

    await assert.rejects(prisma.user.create({ data: {
      email: `${id}@example.invalid`, displayName: 'Duplicate',
    } }), { code: 'P2002' });
    await assert.rejects(prisma.workspace.create({ data: {
      slug: workspaceIds[0], name: 'Duplicate',
    } }), { code: 'P2002' });
    await assert.rejects(prisma.membership.create({ data: {
      workspaceId: workspaceIds[0], userId: id,
    } }), { code: 'P2002' });
    await assert.rejects(prisma.document.create({ data: {
      workspaceId: workspaceIds[1], title: 'Duplicate room', ydocRoomName: `doc:${id}`,
    } }), { code: 'P2002' });
    await assert.rejects(prisma.document.create({ data: {
      workspaceId: `${id}-missing`, title: 'Invalid FK', ydocRoomName: `doc:${id}-invalid`,
    } }), { code: 'P2003' });
    console.log('PASS unique email, slug, membership, room and foreign key rejection');

    await assert.rejects(prisma.$transaction(async tx => {
      await tx.user.create({ data: { id: `${id}-rollback`, email: `${id}-rollback@example.invalid`, displayName: 'Rollback' } });
      await tx.workspace.create({ data: { id: `${id}-rollback`, slug: `${id}-rollback`, name: 'Rollback' } });
      throw new Error('intentional rollback');
    }), /intentional rollback/);
    assert.equal(await prisma.user.findUnique({ where: { id: `${id}-rollback` } }), null);
    assert.equal(await prisma.workspace.findUnique({ where: { id: `${id}-rollback` } }), null);
    console.log('PASS multi-table transaction rollback');

    const history = await prisma.$queryRaw`SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" ORDER BY id`;
    deploy();
    assert.deepEqual(await prisma.$queryRaw`SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" ORDER BY id`, history);
    assert.deepEqual(await prisma.document.findUniqueOrThrow({ where: { id } }), updated);
    assert.deepEqual(await prisma.documentSnapshot.findUniqueOrThrow({ where: { id } }), snapshot);
    assert.equal(await prisma.membership.count({ where: { userId: id } }), 2);
    console.log('PASS repeated migrate deploy preserves migration history and committed records');

    await prisma.workspace.delete({ where: { id: workspaceIds[0] } });
    assert.equal(await prisma.membership.count({ where: { workspaceId: workspaceIds[0] } }), 0);
    assert.equal(await prisma.document.findUnique({ where: { id } }), null);
    assert.equal(await prisma.documentSnapshot.findUnique({ where: { id } }), null);
    await prisma.user.findUniqueOrThrow({ where: { id } });
    await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceIds[1] } });
    assert.equal(await prisma.membership.count({ where: { workspaceId: workspaceIds[1], userId: id } }), 1);
    await prisma.user.delete({ where: { id } });
    assert.equal(await prisma.membership.count({ where: { userId: id } }), 0);
    await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceIds[1] } });
    console.log('PASS workspace cascade, user cascade and preservation of unrelated workspace');
  } finally {
    // 只按本次随机 ID 清理，保留迁移和其他数据，禁止 reset / truncate。
    await prisma.workspace.deleteMany({ where: { id: { in: [...workspaceIds, `${id}-rollback`] } } });
    await prisma.user.deleteMany({ where: { id: { in: [id, `${id}-rollback`] } } });
  }
}

main().finally(() => prisma.$disconnect()).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
