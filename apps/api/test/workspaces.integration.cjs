require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { before, after, test } = require('node:test');
const { prepareDatabase } = require('../../../tests/helpers/database.cjs');
const run = `ws-${randomUUID()}`;
const password = 'Workspace secure password 42!';
const origin = 'http://127.0.0.1:15173';
let app, prisma, base;
const users = {};
async function request(route, { method = 'GET', actor, body, headers = {} } = {}) {
  return fetch(`${base}${route}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json',
    'X-Weavefield-Request': '1', ...(actor ? { Cookie: users[actor].cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
before(async () => {
  prisma = await prepareDatabase(); process.env.WEB_ORIGIN = origin;
  app = await require('../dist/application').createApplication();
  await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  for (const name of ['owner', 'editor', 'viewer', 'other', 'coowner']) {
    const response = await request('/auth/register', { method: 'POST', body: { email: `${run}-${name}@example.invalid`, password, displayName: name } });
    assert.equal(response.status, 201);
    users[name] = { ...(await response.json()).user, cookie: response.headers.get('set-cookie').split(';')[0] };
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
let workspace;
test('creating a workspace atomically makes the authenticated user its OWNER', async () => {
  const response = await request('/workspaces', { method: 'POST', actor: 'owner', body: { name: '真实空间', slug: `${run}-first` } });
  assert.equal(response.status, 201);
  workspace = await response.json();
  assert.equal(workspace.role, 'OWNER');
  const members = await request(`/workspaces/${workspace.id}/members`, { actor: 'owner' });
  assert.equal(members.status, 200);
  const data = await members.json();
  assert.equal(data.length, 1); assert.equal(data[0].user.id, users.owner.id); assert.equal(data[0].role, 'OWNER');
});

test('workspace lists are scoped to the session; duplicate slugs roll back without extra memberships', async () => {
  const response = await request('/workspaces', { method: 'POST', actor: 'owner', body: { name: '第二空间', slug: `${run}-second` } });
  assert.equal(response.status, 201);
  const duplicate = await request('/workspaces', { method: 'POST', actor: 'other', body: { name: '重复', slug: workspace.slug } });
  assert.equal(duplicate.status, 409);
  assert.equal((await (await request('/workspaces', { actor: 'owner' })).json()).length, 2);
  assert.deepEqual(await (await request(`/workspaces?userId=${users.owner.id}`, { actor: 'other' })).json(), []);
});

test('members can read safe DTOs; only OWNER may rename or manage memberships', async () => {
  for (const [actor, role] of [['editor', 'EDITOR'], ['viewer', 'VIEWER']]) {
    const response = await request(`/workspaces/${workspace.id}/members`, { method: 'POST', actor: 'owner', body: { email: ` ${users[actor].email.toUpperCase()} `, role } });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).role, role);
    assert.equal((await request(`/workspaces/${workspace.id}`, { actor })).status, 200);
    const members = await (await request(`/workspaces/${workspace.id}/members`, { actor })).json();
    assert.equal(members.length, 3 - (actor === 'editor' ? 1 : 0));
    for (const member of members) assert.deepEqual(Object.keys(member.user).sort(), ['displayName', 'email', 'id']);
    for (const [route, method, body] of [
      [`/workspaces/${workspace.id}`, 'PATCH', { name: '越权修改' }],
      [`/workspaces/${workspace.id}/members`, 'POST', { email: users.other.email, role: 'OWNER' }],
      [`/workspaces/${workspace.id}/members/${users.owner.id}`, 'PATCH', { role: 'VIEWER' }],
      [`/workspaces/${workspace.id}/members/${users.owner.id}`, 'DELETE', {}],
    ]) assert.equal((await request(route, { actor, method, body })).status, 403);
  }
  const changed = await request(`/workspaces/${workspace.id}`, { actor: 'owner', method: 'PATCH', body: { name: '新空间名称' } });
  assert.equal(changed.status, 200); assert.equal((await changed.json()).name, '新空间名称');
});

test('outsiders and missing workspaces have indistinguishable denial; member references are scoped', async () => {
  for (const suffix of ['', '/members']) {
    const existing = await request(`/workspaces/${workspace.id}${suffix}`, { actor: 'other' });
    const missing = await request(`/workspaces/missing${suffix}`, { actor: 'other' });
    assert.equal(existing.status, 404); assert.equal(missing.status, 404);
    assert.deepEqual(await existing.json(), await missing.json());
  }
  const own = await request('/workspaces', { actor: 'other', method: 'POST', body: { name: '另一个租户', slug: `${run}-other` } });
  const otherSpace = await own.json();
  for (const [method, body] of [['PATCH', { role: 'OWNER' }], ['DELETE', {}]]) {
    assert.equal((await request(`/workspaces/${workspace.id}/members/${users.other.id}`, { actor: 'owner', method, body })).status, 404);
    assert.equal((await request(`/workspaces/${otherSpace.id}/members/${users.owner.id}`, { actor: 'owner', method, body })).status, 404);
  }
  assert.equal((await request(`/workspaces/${workspace.id}/members`, { actor: 'other', method: 'POST', body: { email: users.other.email } })).status, 404);
});

test('duplicate members, unknown accounts, forged fields and invalid input are rejected', async () => {
  const memberPath = `/workspaces/${workspace.id}/members`;
  assert.equal((await request(memberPath, { actor: 'owner', method: 'POST', body: { email: users.editor.email } })).status, 409);
  assert.equal((await request(memberPath, { actor: 'owner', method: 'POST', body: { email: `${run}-missing@example.invalid` } })).status, 404);
  for (const body of [{ name: 'X', slug: `${run}-forged`, ownerId: users.other.id }, { name: '', slug: 'abc' },
    { name: 'X', slug: 'AB' }, { name: 'X', slug: 'a'.repeat(65) }, { name: 'x'.repeat(81), slug: 'abc' },
    { name: 'X', slug: 'abc', memberships: [] }]) {
    assert.equal((await request('/workspaces', { actor: 'owner', method: 'POST', body })).status, 400);
  }
  for (const body of [{ email: users.other.email, role: null }, { email: users.other.email, role: 'ADMIN' }, { email: 'broken' }, { email: users.other.email, userId: users.owner.id }]) {
    assert.equal((await request(memberPath, { actor: 'owner', method: 'POST', body })).status, 400);
  }
  assert.equal((await request(`${memberPath}/${users.editor.id}`, { actor: 'owner', method: 'PATCH', body: { role: 'ADMIN' } })).status, 400);
  assert.equal((await request(`/workspaces/${workspace.id}`, { actor: 'owner', method: 'PATCH', body: { slug: 'overwrite' } })).status, 400);
  assert.equal((await request(`/workspaces/${workspace.id}`, { actor: 'owner', method: 'DELETE', body: {} })).status, 404);
});

test('last OWNER cannot be removed or demoted; ownership can be shared and self-demotion is supported', async () => {
  const memberPath = `/workspaces/${workspace.id}/members`;
  for (const [method, body] of [['PATCH', { role: 'VIEWER' }], ['DELETE', {}]]) {
    assert.equal((await request(`${memberPath}/${users.owner.id}`, { actor: 'owner', method, body })).status, 409);
  }
  assert.equal((await request(`${memberPath}/${users.owner.id}`, { actor: 'owner', method: 'PATCH', body: { role: 'OWNER' } })).status, 200);
  assert.equal((await request(memberPath, { actor: 'owner', method: 'POST', body: { email: users.coowner.email, role: 'OWNER' } })).status, 201);
  assert.equal((await request(`${memberPath}/${users.owner.id}`, { actor: 'owner', method: 'PATCH', body: { role: 'EDITOR' } })).status, 200);
  assert.equal((await request(`${memberPath}/${users.owner.id}`, { actor: 'owner', method: 'PATCH', body: { role: 'OWNER' } })).status, 403);
  assert.equal((await request(`${memberPath}/${users.owner.id}`, { actor: 'coowner', method: 'PATCH', body: { role: 'OWNER' } })).status, 200);
  assert.equal((await request(`${memberPath}/${users.coowner.id}`, { actor: 'coowner', method: 'DELETE', body: {} })).status, 204);
  assert.equal((await request(`/workspaces/${workspace.id}`, { actor: 'coowner' })).status, 404);
  assert.equal((await request(`${memberPath}/${users.viewer.id}`, { actor: 'owner', method: 'DELETE', body: {} })).status, 204);
  assert.equal((await request(`/workspaces/${workspace.id}`, { actor: 'viewer' })).status, 404);
});

async function createPair(suffix) {
  const response = await request('/workspaces', { actor: 'owner', method: 'POST', body: { name: '并发空间', slug: `${run}-${suffix}` } });
  assert.equal(response.status, 201);
  const pair = await response.json();
  assert.equal((await request(`/workspaces/${pair.id}/members`, { actor: 'owner', method: 'POST', body: { email: users.coowner.email, role: 'OWNER' } })).status, 201);
  return pair;
}
async function concurrentChanges(pair, operation) {
  let locked, release;
  const ready = new Promise(resolve => { locked = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  // 锁住测试成员记录：无父行锁的错误实现会在两个旧计数检查后同时等待更新。
  const gate = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "userId" FROM "Membership" WHERE "workspaceId" = ${pair.id} FOR UPDATE`;
    locked(); await released;
  }, { timeout: 15000 });
  await ready;
  const pending = Promise.all(['owner', 'coowner'].map(actor => operation(actor)));
  let responses;
  try {
    const deadline = Date.now() + 8000;
    while (true) {
      const [state] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND (query LIKE '%Membership%' OR query LIKE '%Workspace%')`;
      if (state.count >= 2) break;
      assert.ok(Date.now() < deadline, 'Both concurrent requests must reach a database lock before release');
    }
  } finally { release(); await gate; responses = await pending; }
  return responses;
}
for (const operation of ['demote', 'leave']) {
  test(`concurrent ${operation} cannot remove the last OWNER, including when both requests read old memberships`, async () => {
    for (let iteration = 0; iteration < 3; iteration++) {
      const pair = await createPair(`${operation}-${iteration}`);
      const responses = await concurrentChanges(pair, actor => request(`/workspaces/${pair.id}/members/${users[actor].id}`, {
        actor, method: operation === 'leave' ? 'DELETE' : 'PATCH', body: operation === 'leave' ? {} : { role: 'EDITOR' },
      }));
      assert.equal(await prisma.membership.count({ where: { workspaceId: pair.id, role: 'OWNER' } }), 1, 'Concurrent changes must retain exactly one OWNER');
      assert.deepEqual(responses.map(r => r.status).sort(), operation === 'leave' ? [204, 409] : [200, 409]);
      const remaining = responses[0].status === 409 ? 'owner' : 'coowner';
      const members = await (await request(`/workspaces/${pair.id}/members`, { actor: remaining })).json();
      assert.equal(members.filter(m => m.role === 'OWNER').length, 1);
    }
  });
}

test('a queued owner write rechecks permissions after another owner removes the actor', async () => {
  const pair = await createPair('mutual-removal');
  const responses = await concurrentChanges(pair, actor => request(`/workspaces/${pair.id}/members/${users[actor === 'owner' ? 'coowner' : 'owner'].id}`, { actor, method: 'DELETE', body: {} }));
  assert.deepEqual(responses.map(r => r.status).sort(), [204, 404]);
});

test('protected routes reject missing, expired, forged and logged-out sessions, and untrusted writes', async () => {
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const route = method === 'POST' ? '/workspaces' : method === 'PATCH' ? `/workspaces/${workspace.id}` : `/workspaces/${workspace.id}/members/${users.editor.id}`;
    assert.equal((await request(route, { method, body: {} })).status, 401);
  }
  assert.equal((await request('/workspaces')).status, 401);
  assert.equal((await request('/workspaces', { headers: { Cookie: `weavefield_session=${'z'.repeat(43)}` } })).status, 401);
  for (const headers of [{ Origin: 'https://evil.invalid' }, { 'X-Weavefield-Request': '' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Content-Type': 'text/plain' }]) {
    assert.equal((await request(`/workspaces/${workspace.id}`, { actor: 'owner', method: 'PATCH', body: { name: '拒绝' }, headers })).status, 403);
  }
  const options = await request('/workspaces', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'PATCH' } });
  assert.match(options.headers.get('access-control-allow-methods'), /PATCH/);
  assert.match(options.headers.get('access-control-allow-methods'), /DELETE/);
  await prisma.session.updateMany({ where: { userId: users.editor.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await request('/workspaces', { actor: 'editor' })).status, 401);
  assert.equal((await request(`/workspaces/${workspace.id}`, { actor: 'editor', method: 'PATCH', body: { name: 'Expired' } })).status, 401);
  assert.equal((await request('/auth/logout', { actor: 'owner', method: 'POST', body: {} })).status, 204);
  assert.equal((await request('/workspaces', { actor: 'owner' })).status, 401);
});
