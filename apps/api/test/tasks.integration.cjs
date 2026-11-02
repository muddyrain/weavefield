require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { before, after, test } = require('node:test');
const { prepareDatabase } = require('../../../tests/helpers/database.cjs');
const run = `tasks-${randomUUID()}`, origin = 'http://127.0.0.1:15173', users = {};
let prisma, app, base, space, otherSpace, task;
const route = (workspaceId = space.id, taskId = '') => `/workspaces/${workspaceId}/tasks${taskId ? `/${taskId}` : ''}`;
async function request(url, { actor = 'owner', method = 'GET', body, headers = {} } = {}) {
  return fetch(base + url, { method, headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Weavefield-Request': '1',
    ...(actor && users[actor] ? { Cookie: users[actor].cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function json(url, options, status = 200) { const r = await request(url, options); assert.equal(r.status, status); return r.json(); }
const create = (title = '真实任务', actor = 'owner', description) => json(route(), { actor, method: 'POST', body: { title, ...(description === undefined ? {} : { description }) } }, 201);
before(async () => {
  prisma = await prepareDatabase(); process.env.WEB_ORIGIN = origin; process.env.ENABLE_OPENAPI_DOCS = '1';
  app = await require('../dist/application').createApplication(); await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  for (const actor of ['owner', 'editor', 'viewer', 'outsider', 'expired', 'logout']) {
    const r = await request('/auth/register', { actor: null, method: 'POST', body: { email: `${run}-${actor}@example.invalid`, displayName: actor, password: 'Task integration password 42!' } });
    assert.equal(r.status, 201); users[actor] = { ...(await r.json()).user, cookie: r.headers.get('set-cookie').split(';')[0] };
  }
  space = await json('/workspaces', { method: 'POST', body: { name: '任务空间', slug: `${run}-a` } }, 201);
  otherSpace = await json('/workspaces', { method: 'POST', body: { name: '另一空间', slug: `${run}-b` } }, 201);
  for (const [actor, role] of [['editor', 'EDITOR'], ['viewer', 'VIEWER'], ['expired', 'EDITOR'], ['logout', 'EDITOR']]) await json(`/workspaces/${space.id}/members`, { method: 'POST', body: { email: users[actor].email, role } }, 201);
});
after(async () => {
  if (prisma) { await prisma.workspace.deleteMany({ where: { slug: { startsWith: run } } }); await prisma.user.deleteMany({ where: { email: { startsWith: run } } }); }
  if (app) await app.close(); if (prisma) await prisma.$disconnect();
});
test('OWNER creates a real task with a safe DTO, TODO and version 1', async () => {
  task = await create('  第一项任务  ', 'owner', '  第一行\n第二行  ');
  assert.deepEqual(Object.keys(task).sort(), ['description', 'id', 'status', 'title', 'version', 'workspaceId']);
  assert.equal(task.title, '第一项任务'); assert.equal(task.description, '第一行\n第二行'); assert.equal(task.status, 'TODO'); assert.equal(task.version, 1);
  const stored = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(stored.title, task.title); assert.equal(stored.assigneeId, null); assert.equal(stored.dueAt, null);
});
test('EDITOR creates and updates all task fields with a new version', async () => {
  const item = await create('编辑任务', 'editor'); assert.equal(item.description, null);
  const changed = await json(route(space.id, item.id), { actor: 'editor', method: 'PATCH', body: { version: 1, title: '修改标题', description: '验收说明', status: 'IN_PROGRESS' } });
  assert.equal(changed.version, 2); assert.equal(changed.status, 'IN_PROGRESS');
  const saved = await prisma.task.findUniqueOrThrow({ where: { id: item.id } }); assert.equal(saved.description, '验收说明'); assert.equal(saved.title, '修改标题'); assert.equal(saved.version, 2);
  const done = await json(route(space.id, item.id), { method: 'PATCH', body: { version: 2, status: 'DONE', description: null } }); assert.equal(done.version, 3); assert.equal(done.description, null);
});
test('same titles are allowed and each create has a distinct identity', async () => { const a = await create('允许同名'); const b = await create('允许同名'); assert.notEqual(a.id, b.id); });
test('all task endpoints require a valid Session', async () => {
  for (const [url, method, body] of [[route(), 'GET'], [route(), 'POST', { title: '拒绝' }], [route(space.id, task.id), 'GET'], [route(space.id, task.id), 'PATCH', { version: 1, title: '拒绝' }]]) assert.equal((await request(url, { actor: null, method, body })).status, 401);
});
test('VIEWER reads safe tasks but cannot create or update', async () => {
  const list = await json(route(), { actor: 'viewer' }); assert(list.some(x => x.id === task.id));
  assert.deepEqual(await json(route(space.id, task.id), { actor: 'viewer' }), task);
  for (const [url, method, body] of [[route(), 'POST', { title: '拒绝' }], [route(space.id, task.id), 'PATCH', { version: 1, status: 'DONE' }]]) assert.equal((await request(url, { actor: 'viewer', method, body })).status, 403);
});
test('nonmembers and cross-workspace IDs do not leak task content', async () => {
  for (const actor of ['owner', 'viewer', 'outsider']) for (const method of ['GET', 'PATCH']) assert.equal((await request(route(otherSpace.id, task.id), { actor, method, ...(method === 'PATCH' ? { body: { version: 1, title: '拒绝' } } : {}) })).status, 404);
  for (const url of [route(), route('missing'), route(space.id, task.id)]) assert.equal((await request(url, { actor: 'outsider' })).status, 404);
  assert.deepEqual(await json(route(otherSpace.id)), []);
});
test('stale versions never overwrite current data and conflicts have a recovery path', async () => {
  const a = await create('并发任务');
  const responses = await Promise.all(['owner', 'editor'].map(actor => request(route(space.id, a.id), { actor, method: 'PATCH', body: { version: 1, title: actor } })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const winner = await responses.find(r => r.status === 200).json(); const stored = await json(route(space.id, a.id)); assert.deepEqual(stored, winner); assert.equal(stored.version, 2);
  assert.equal((await request(route(space.id, a.id), { method: 'PATCH', body: { version: 1, description: '旧值' } })).status, 409);
  const fresh = await json(route(space.id, a.id), { method: 'PATCH', body: { version: 2, description: '基于最新版本编辑' } }); assert.equal(fresh.version, 3);
});
test('invalid input, unsupported fields, empty patches and invalid IDs are rejected', async () => {
  for (const title of ['', ' ', '\n非法', null, 7, 'x'.repeat(201)]) assert.equal((await request(route(), { method: 'POST', body: { title } })).status, 400);
  for (const description of [7, {}, 'x'.repeat(1001), '\u0000']) assert.equal((await request(route(), { method: 'POST', body: { title: '任务', description } })).status, 400);
  for (const version of [undefined, null, '1', 0, -1, 1.5, 2147483647]) assert.equal((await request(route(space.id, task.id), { method: 'PATCH', body: { version, status: 'DONE' } })).status, 400);
  for (const body of [{ version: 1 }, { version: 1, status: 'BOGUS' }, { version: 1, title: null }, { version: 1, description: 7 }]) assert.equal((await request(route(space.id, task.id), { method: 'PATCH', body })).status, 400);
  for (const field of ['workspaceId', 'userId', 'assigneeId', 'dueAt', 'role', 'id']) for (const method of ['POST', 'PATCH']) assert.equal((await request(method === 'POST' ? route() : route(space.id, task.id), { method, body: { title: '伪造', ...(method === 'PATCH' ? { version: 1 } : {}), [field]: 'forged' } })).status, 400);
  for (const url of [route('bad%20id'), route(space.id, 'bad%20id')]) assert.equal((await request(url)).status, 400);
  assert.equal((await request(route(), { method: 'POST', body: [] })).status, 400);
  await create('织'.repeat(200), 'owner', '描述'.repeat(500));
});
test('CSRF and the existing JSON body limit remain enforced', async () => {
  for (const headers of [{ Origin: 'https://evil.invalid' }, { 'X-Weavefield-Request': '' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Content-Type': 'text/plain' }]) for (const [url, method, body] of [[route(), 'POST', { title: '拒绝' }], [route(space.id, task.id), 'PATCH', { version: 1, status: 'DONE' }]]) assert.equal((await request(url, { method, body, headers })).status, 403);
  assert.equal((await request(route(), { method: 'POST', body: { title: '任务', description: 'x'.repeat(5000) } })).status, 413);
});
async function waitForLock() {
  const deadline = Date.now() + 7000;
  while (true) { const [s] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%Workspace%'`; if (s.count) return; assert(Date.now() < deadline, 'Task write must reach Workspace lock'); }
}
for (const change of ['downgrade', 'remove']) for (const operation of ['create', 'update']) test(`queued ${operation} rechecks membership after ${change}`, async () => {
  await prisma.membership.upsert({ where: { workspaceId_userId: { workspaceId: space.id, userId: users.editor.id } }, create: { workspaceId: space.id, userId: users.editor.id, role: 'EDITOR' }, update: { role: 'EDITOR' } });
  const target = await create('等待权限检查'); let ready, release;
  const locked = new Promise(r => { ready = r; }), done = new Promise(r => { release = r; });
  const gate = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${space.id} FOR UPDATE`; if (change === 'remove') await tx.membership.delete({ where: { workspaceId_userId: { workspaceId: space.id, userId: users.editor.id } } }); else await tx.membership.update({ where: { workspaceId_userId: { workspaceId: space.id, userId: users.editor.id } }, data: { role: 'VIEWER' } }); ready(); await done; }, { timeout: 15000 });
  await locked; const pending = request(operation === 'create' ? route() : route(space.id, target.id), { actor: 'editor', method: operation === 'create' ? 'POST' : 'PATCH', body: { title: `不能写入-${change}-${operation}`, ...(operation === 'update' ? { version: 1 } : {}) } });
  try { await waitForLock(); } finally { release(); await gate; }
  assert.equal((await pending).status, change === 'remove' ? 404 : 403); assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: target.id } })).version, 1); assert.equal(await prisma.task.count({ where: { workspaceId: space.id, title: `不能写入-${change}-${operation}` } }), 0);
});
test('expired, revoked and logged-out Sessions cannot read or write tasks', async () => {
  await prisma.session.updateMany({ where: { userId: users.expired.id }, data: { expiresAt: new Date(0) } });
  await prisma.session.updateMany({ where: { userId: users.viewer.id }, data: { revokedAt: new Date() } });
  assert.equal((await request('/auth/logout', { actor: 'logout', method: 'POST', body: {} })).status, 204);
  for (const actor of ['expired', 'viewer', 'logout']) for (const [url, method, body] of [[route(), 'GET'], [route(), 'POST', { title: '拒绝' }], [route(space.id, task.id), 'GET'], [route(space.id, task.id), 'PATCH', { version: 1, status: 'DONE' }]]) assert.equal((await request(url, { actor, method, body })).status, 401);
});
test('Task OpenAPI describes safe DTOs, validation and version conflicts', async () => {
  const document = await (await fetch(base + '/openapi.json')).json(), template = '/workspaces/{workspaceId}/tasks/{taskId}';
  assert(document.paths[template].patch.responses[409]); assert.equal(document.components.schemas.Task.additionalProperties, false);
  assert.deepEqual(document.components.schemas.UpdateTaskInput.required, ['version']); assert.equal(document.components.schemas.UpdateTaskInput.anyOf.length, 3);
  assert.deepEqual(Object.keys(document.components.schemas.Task.properties).sort(), Object.keys(task).sort());
});
