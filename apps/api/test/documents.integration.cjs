require('reflect-metadata');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { before, after, test } = require('node:test');
const { prepareDatabase } = require('../../../tests/helpers/database.cjs');
const run = `docs-${crypto.randomUUID()}`;
const origin = 'http://127.0.0.1:15173';
const users = {};
let app, prisma, base, space, otherSpace, document;
const route = (id = space.id, documentId = '') => `/workspaces/${id}/documents${documentId ? `/${documentId}` : ''}`;
async function request(url, { actor = 'owner', method = 'GET', body, headers = {} } = {}) {
  return fetch(`${base}${url}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Weavefield-Request': '1',
    ...(actor && users[actor] ? { Cookie: users[actor].cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function json(url, options, status = 200) {
  const response = await request(url, options); assert.equal(response.status, status); return response.json();
}
async function create(title = '真实文档', actor = 'owner', workspace = space) {
  return json(route(workspace.id), { actor, method: 'POST', body: { title } }, 201);
}
before(async () => {
  prisma = await prepareDatabase(); process.env.WEB_ORIGIN = origin;
  app = await require('../dist/application').createApplication();
  await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  for (const actor of ['owner', 'editor', 'viewer', 'outsider', 'expired', 'logout']) {
    const response = await request('/auth/register', { actor: null, method: 'POST', body: {
      email: `${run}-${actor}@example.invalid`, displayName: actor, password: 'Documents test password 42!',
    } });
    assert.equal(response.status, 201);
    users[actor] = { ...(await response.json()).user, cookie: response.headers.get('set-cookie').split(';')[0] };
  }
  space = await json('/workspaces', { method: 'POST', body: { name: '文档空间', slug: `${run}-a` } }, 201);
  otherSpace = await json('/workspaces', { method: 'POST', body: { name: '另一个空间', slug: `${run}-b` } }, 201);
  for (const [actor, role] of [['editor', 'EDITOR'], ['viewer', 'VIEWER'], ['expired', 'EDITOR'], ['logout', 'EDITOR']]) {
    await json(`/workspaces/${space.id}/members`, { method: 'POST', body: { email: users[actor].email, role } }, 201);
  }
});
after(async () => {
  if (prisma) {
    await prisma.workspace.deleteMany({ where: { slug: { startsWith: run } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: run } } });
  }
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
});

test('all document routes reject anonymous sessions', async () => {
  for (const [url, method, body] of [[route(), 'GET'], [route(), 'POST', { title: 'X' }],
    [route(space.id, 'missing'), 'GET'], [route(space.id, 'missing'), 'PATCH', { title: 'X' }],
    [`${route(space.id, 'missing')}/archive`, 'POST', {}]]) {
    assert.equal((await request(url, { actor: null, method, body })).status, 401);
  }
});
test('OWNER creates a trimmed title with a safe metadata DTO and a private random room', async () => {
  document = await create('  第一份文档  ');
  assert.deepEqual(Object.keys(document).sort(), ['archivedAt', 'createdAt', 'id', 'title', 'updatedAt', 'workspaceId']);
  assert.equal(document.title, '第一份文档'); assert.equal(document.workspaceId, space.id); assert.equal(document.archivedAt, null);
  const stored = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
  assert.match(stored.ydocRoomName, /^doc:[0-9a-f-]{36}$/);
  assert.notEqual(stored.ydocRoomName, `doc:${stored.id}`);
});
test('EDITOR creates documents and rooms are unique', async () => {
  const created = await create('编辑者文档', 'editor');
  const rooms = await prisma.document.findMany({ where: { id: { in: [created.id, document.id] } }, select: { ydocRoomName: true } });
  assert.equal(new Set(rooms.map(row => row.ydocRoomName)).size, 2);
});
test('VIEWER can list and read exact safe metadata, but cannot create, rename or archive', async () => {
  assert.ok((await json(route(), { actor: 'viewer' })).some(row => row.id === document.id));
  assert.deepEqual(await json(route(space.id, document.id), { actor: 'viewer' }), document);
  for (const [url, method, body] of [[route(), 'POST', { title: '拒绝' }],
    [route(space.id, document.id), 'PATCH', { title: '拒绝' }], [`${route(space.id, document.id)}/archive`, 'POST', {}]]) {
    assert.equal((await request(url, { actor: 'viewer', method, body })).status, 403);
  }
});
test('lists are workspace-scoped and nonmembers cannot enumerate existing or missing spaces', async () => {
  const second = await create('第二空间文档', 'owner', otherSpace);
  assert.deepEqual((await json(route(otherSpace.id))).map(row => row.id), [second.id]);
  assert.ok(!(await json(route())).some(row => row.id === second.id));
  for (const actor of ['outsider', 'editor']) {
    const existing = await request(route(otherSpace.id), { actor });
    const missing = await request(route('missing'), { actor });
    assert.equal(existing.status, 404); assert.equal(missing.status, 404);
    assert.deepEqual(await existing.json(), await missing.json());
  }
  assert.equal((await request(route(), { actor: 'outsider', method: 'POST', body: { title: '拒绝' } })).status, 404);
});
test('a document ID in the wrong workspace is denied for every document route', async () => {
  for (const actor of ['owner', 'viewer', 'outsider']) for (const [suffix, method, body] of [
    ['', 'GET'], ['', 'PATCH', { title: '跨空间' }], ['/archive', 'POST', {}],
  ]) assert.equal((await request(`${route(otherSpace.id, document.id)}${suffix}`, { actor, method, body })).status, 404);
});
test('OWNER and EDITOR rename; updatedAt advances and private room identity is stable', async () => {
  const room = (await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).ydocRoomName;
  for (const actor of ['owner', 'editor']) {
    await prisma.document.update({ where: { id: document.id }, data: { updatedAt: new Date('2000-01-01') } });
    const changed = await json(route(space.id, document.id), { actor, method: 'PATCH', body: { title: `由${actor}修改` } });
    assert.equal(changed.title, `由${actor}修改`); assert.ok(Date.parse(changed.updatedAt) > Date.parse('2000-01-01'));
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).ydocRoomName, room);
  }
});
test('lists use updatedAt descending and id ascending for equal timestamps', async () => {
  const a = await create('稳定排序一'); const b = await create('稳定排序二'); const c = await create('最近更新');
  await prisma.document.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { updatedAt: new Date('2099-01-01') } });
  await prisma.document.update({ where: { id: c.id }, data: { updatedAt: new Date('2099-01-02') } });
  assert.deepEqual((await json(route())).slice(0, 3).map(row => row.id), [c.id, ...[a.id, b.id].sort()]);
});
test('invalid titles, forged fields and malformed IDs are rejected at runtime', async () => {
  for (const title of ['', '  ', '\n标题', 'x'.repeat(201), null, 42, {}]) {
    for (const [url, method] of [[route(), 'POST'], [route(space.id, document.id), 'PATCH']]) {
      assert.equal((await request(url, { method, body: { title } })).status, 400);
    }
  }
  for (const key of ['workspaceId', 'ownerId', 'userId', 'role', 'ydocRoomName', 'archivedAt']) {
    assert.equal((await request(route(), { method: 'POST', body: { title: '伪造', [key]: 'forged' } })).status, 400);
    assert.equal((await request(route(space.id, document.id), { method: 'PATCH', body: { title: '伪造', [key]: 'forged' } })).status, 400);
  }
  assert.equal((await request(`${route(space.id, document.id)}/archive`, { method: 'POST', body: { archivedAt: null } })).status, 400);
  for (const url of [route('bad%20id'), route(space.id, 'bad%20id')]) assert.equal((await request(url)).status, 400);
  assert.equal((await request(route(), { method: 'POST', body: [] })).status, 400);
  await create('织'.repeat(200));
});
test('Origin, CSRF, fetch-site and content-type checks protect document writes', async () => {
  for (const headers of [{ Origin: 'https://evil.invalid' }, { 'X-Weavefield-Request': '' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Content-Type': 'text/plain' }]) {
    for (const [url, method, body] of [[route(), 'POST', { title: '拒绝' }], [route(space.id, document.id), 'PATCH', { title: '拒绝' }],
      [`${route(space.id, document.id)}/archive`, 'POST', {}]]) assert.equal((await request(url, { method, body, headers })).status, 403);
  }
});
test('OWNER and EDITOR soft archive; repeat archive, detail and rename return 404', async () => {
  for (const actor of ['owner', 'editor']) {
    const item = await create('待归档');
    const archived = await json(`${route(space.id, item.id)}/archive`, { actor, method: 'POST', body: {} });
    assert.ok(archived.archivedAt); assert.ok(!(await json(route())).some(row => row.id === item.id));
    assert.ok(await prisma.document.findUnique({ where: { id: item.id } }));
    for (const [suffix, method, body] of [['', 'GET'], ['', 'PATCH', { title: '不能恢复' }], ['/archive', 'POST', {}]]) {
      assert.equal((await request(`${route(space.id, item.id)}${suffix}`, { actor, method, body })).status, 404);
    }
  }
});
test('archiving preserves binary snapshots, workspace, memberships and unrelated documents', async () => {
  const item = await create('带快照的元数据');
  const snapshot = await prisma.documentSnapshot.create({ data: { documentId: item.id, revision: 1, binaryState: Buffer.from([0, 255, 1, 9]) } });
  const workspaceBefore = await prisma.workspace.findUnique({ where: { id: space.id } });
  const membersBefore = await prisma.membership.findMany({ where: { workspaceId: space.id }, orderBy: { userId: 'asc' } });
  const otherBefore = await prisma.document.findUnique({ where: { id: document.id } });
  await json(`${route(space.id, item.id)}/archive`, { method: 'POST', body: {} });
  assert.deepEqual(await prisma.documentSnapshot.findUnique({ where: { id: snapshot.id } }), snapshot);
  assert.deepEqual(await prisma.workspace.findUnique({ where: { id: space.id } }), workspaceBefore);
  assert.deepEqual(await prisma.membership.findMany({ where: { workspaceId: space.id }, orderBy: { userId: 'asc' } }), membersBefore);
  assert.deepEqual(await prisma.document.findUnique({ where: { id: document.id } }), otherBefore);
});
test('database room uniqueness is enforced and a collision retries in a fresh transaction', async () => {
  const stored = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
  await assert.rejects(prisma.document.create({ data: { workspaceId: space.id, title: '重复房间', ydocRoomName: stored.ydocRoomName } }), { code: 'P2002' });
  const original = crypto.randomUUID; let calls = 0;
  crypto.randomUUID = () => ++calls === 1 ? stored.ydocRoomName.slice(4) : original();
  try { await create('冲突后成功'); assert.equal(calls, 2); } finally { crypto.randomUUID = original; }
});
test('exhausted uniqueness retries roll back without new documents or membership changes', async () => {
  const stored = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
  const beforeCount = await prisma.document.count({ where: { workspaceId: space.id } });
  const original = crypto.randomUUID; let calls = 0;
  crypto.randomUUID = () => { calls++; return stored.ydocRoomName.slice(4); };
  try { assert.equal((await request(route(), { method: 'POST', body: { title: '应回滚' } })).status, 409); assert.equal(calls, 3); }
  finally { crypto.randomUUID = original; }
  assert.equal(await prisma.document.count({ where: { workspaceId: space.id } }), beforeCount);
  assert.equal(await prisma.membership.count({ where: { workspaceId: space.id } }), 5);
});

async function waitForLocks(count) {
  const deadline = Date.now() + 7000;
  while (true) {
    const [state] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%Workspace%'`;
    if (state.count >= count) return;
    assert.ok(Date.now() < deadline, 'Concurrent requests must reach the workspace lock');
  }
}
test('queued rename and archive in both orders cannot make an archived document available again', async () => {
  for (const first of ['archive', 'rename']) {
    const item = await create('并发归档'); let ready, release;
    const locked = new Promise(resolve => { ready = resolve; }); const released = new Promise(resolve => { release = resolve; });
    const gate = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${space.id} FOR UPDATE`; ready(); await released; }, { timeout: 15000 });
    await locked;
    const send = action => request(`${route(space.id, item.id)}${action === 'archive' ? '/archive' : ''}`, {
      actor: 'editor', method: action === 'archive' ? 'POST' : 'PATCH', body: action === 'archive' ? {} : { title: '并发重命名' },
    });
    let firstRequest, secondRequest;
    try { firstRequest = send(first); await waitForLocks(1); secondRequest = send(first === 'archive' ? 'rename' : 'archive'); await waitForLocks(2); }
    finally { release(); await gate; }
    const responses = await Promise.all([firstRequest, secondRequest]);
    assert.deepEqual(responses.map(row => row.status), first === 'archive' ? [200, 404] : [200, 200]);
    assert.ok((await prisma.document.findUniqueOrThrow({ where: { id: item.id } })).archivedAt);
    assert.equal((await request(route(space.id, item.id))).status, 404);
    assert.ok(!(await json(route())).some(row => row.id === item.id));
  }
});
test('queued document creation rechecks the role after a concurrent membership downgrade', async () => {
  let ready, release;
  const locked = new Promise(resolve => { ready = resolve; }); const released = new Promise(resolve => { release = resolve; });
  const gate = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${space.id} FOR UPDATE`;
    await tx.membership.update({ where: { workspaceId_userId: { workspaceId: space.id, userId: users.editor.id } }, data: { role: 'VIEWER' } });
    ready(); await released;
  }, { timeout: 15000 });
  await locked;
  const pending = request(route(), { actor: 'editor', method: 'POST', body: { title: '撤权后不能写' } });
  try { await waitForLocks(1); } finally { release(); await gate; }
  assert.equal((await pending).status, 403);
  assert.equal(await prisma.document.count({ where: { workspaceId: space.id, title: '撤权后不能写' } }), 0);
});
test('expired and logged-out sessions cannot read or mutate metadata', async () => {
  await prisma.session.updateMany({ where: { userId: users.expired.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await request('/auth/logout', { actor: 'logout', method: 'POST', body: {} })).status, 204);
  for (const actor of ['expired', 'logout']) for (const [url, method, body] of [[route(), 'GET'], [route(), 'POST', { title: '拒绝' }],
    [route(space.id, document.id), 'GET'], [route(space.id, document.id), 'PATCH', { title: '拒绝' }],
    [`${route(space.id, document.id)}/archive`, 'POST', {}]]) assert.equal((await request(url, { actor, method, body })).status, 401);
});
