require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { before, after, test } = require('node:test');
const { prepareDatabase } = require('../../../tests/helpers/database.cjs');
const run = `auth-${randomUUID()}`;
const email = `${run}@example.invalid`;
const password = 'Correct horse battery 42!';
const origin = 'http://127.0.0.1:15173';
let app, prisma, base, aliceCookie;

before(async () => {
  prisma = await prepareDatabase();
  process.env.WEB_ORIGIN = origin;
  const { createApplication } = require('../dist/application');
  app = await createApplication();
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
after(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: run } } });
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
});

async function request(route, { method = 'GET', cookie, body, headers = {} } = {}) {
  return fetch(`${base}/auth/${route}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Weavefield-Request': '1',
      ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('register creates a real user and an HttpOnly session without exposing credentials', async () => {
  const response = await request('register', { method: 'POST', body: { email, password, displayName: '织域测试用户' } });
  assert.equal(response.status, 201);
  aliceCookie = response.headers.get('set-cookie').split(';')[0];
  const data = await response.json();
  assert.equal(data.user.email, email);
  assert.equal(data.user.displayName, '织域测试用户');
  assert.deepEqual(Object.keys(data.user).sort(), ['displayName', 'email', 'id']);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Path=\//);
  assert.doesNotMatch(cookie, /; Secure|Domain=/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(data).sort(), ['sessionExpiresAt', 'user']);
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: data.user.id } });
  assert.notEqual(stored.passwordHash, password);
  assert.match(stored.passwordHash, /^scrypt\$32768\$8\$3\$/);
  const session = await prisma.session.findFirstOrThrow({ where: { userId: data.user.id } });
  assert.match(session.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(session.tokenHash, aliceCookie.split('=')[1]);
});

test('anonymous, forged and nonexistent sessions return 401', async () => {
  for (const cookie of [undefined, 'weavefield_session=invalid', `weavefield_session=${'z'.repeat(43)}`]) {
    assert.equal((await request('me', { cookie })).status, 401);
  }
});

test('email normalization rejects duplicate registrations without changing the original account', async () => {
  const response = await request('register', { method: 'POST', body: { email: ` ${email.toUpperCase()} `, password, displayName: 'Duplicate' } });
  assert.equal(response.status, 409);
  assert.equal(await prisma.user.count({ where: { emailCanonical: email } }), 1);
});

test('bad credentials use the same rejection; valid login rotates and revokes the prior token', async () => {
  const wrong = await request('login', { method: 'POST', body: { email, password: 'Wrong password 42!' } });
  const missing = await request('login', { method: 'POST', body: { email: `${run}-missing@example.invalid`, password } });
  assert.equal(wrong.status, 401); assert.equal(missing.status, 401);
  assert.deepEqual(await wrong.json(), await missing.json());
  const old = aliceCookie;
  const response = await request('login', { method: 'POST', cookie: old, body: { email: email.toUpperCase(), password } });
  assert.equal(response.status, 200);
  aliceCookie = response.headers.get('set-cookie').split(';')[0];
  assert.notEqual(aliceCookie, old);
  assert.equal((await request('me', { cookie: old })).status, 401);
  const me = await request('me', { cookie: aliceCookie });
  assert.equal(me.status, 200);
  const body = await me.json();
  assert.equal(body.user.email, email);
  assert.deepEqual(Object.keys(body.user).sort(), ['displayName', 'email', 'id']);
  assert.doesNotMatch(JSON.stringify(body), /passwordHash|tokenHash|scrypt|Correct horse/);
});

test('sessions survive an API lifecycle restart and logout invalidates the stored token', async () => {
  await app.close();
  const { createApplication } = require('../dist/application');
  app = await createApplication();
  await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  assert.equal((await request('me', { cookie: aliceCookie })).status, 200);
  const response = await request('logout', { method: 'POST', cookie: aliceCookie, body: {} });
  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await request('me', { cookie: aliceCookie })).status, 401);
  assert.equal((await request('logout', { method: 'POST', body: {} })).status, 204);
});

test('two users keep separate identities; client user IDs cannot select another account', async () => {
  const create = async (suffix, name, secret) => {
    const response = await request('register', { method: 'POST', body: { email: `${run}-${suffix}@example.invalid`, displayName: name, password: secret } });
    assert.equal(response.status, 201);
    return { cookie: response.headers.get('set-cookie').split(';')[0], data: await response.json() };
  };
  const bob = await create('bob', 'Bob', 'Bob secure password 42!');
  const carol = await create('carol', 'Carol', 'Carol secure password 42!');
  const bobResponse = await request(`me?userId=${carol.data.user.id}`, { cookie: bob.cookie });
  assert.equal((await bobResponse.json()).user.id, bob.data.user.id);
  assert.equal((await (await request('me', { cookie: carol.cookie })).json()).user.id, carol.data.user.id);
  const rejected = await request('login', { method: 'POST', cookie: bob.cookie,
    body: { email: `${run}-carol@example.invalid`, password: 'Bob secure password 42!' } });
  assert.equal(rejected.status, 401);
  assert.equal((await (await request('me', { cookie: bob.cookie })).json()).user.id, bob.data.user.id);
  const record = await prisma.session.findFirstOrThrow({ where: { userId: bob.data.user.id } });
  await prisma.session.update({ where: { id: record.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await request('me', { cookie: bob.cookie })).status, 401);
  await prisma.session.update({ where: { id: record.id }, data: { expiresAt: new Date(Date.now() + 60000), revokedAt: new Date() } });
  assert.equal((await request('me', { cookie: bob.cookie })).status, 401);
});

test('malformed bodies, excessive input and untrusted writes are rejected without echoing secrets', async () => {
  const login = { email, password };
  for (const headers of [{ Origin: 'https://evil.invalid' }, { Origin: '' }, { 'X-Weavefield-Request': '' },
    { 'Content-Type': 'text/plain' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await request('login', { method: 'POST', body: login, headers })).status, 403);
    assert.equal((await request('logout', { method: 'POST', cookie: aliceCookie, body: {}, headers })).status, 403);
  }
  for (const body of [null, [], {}, { email: 'invalid', password }, { email, password: 'short' },
    { email, password: 'x'.repeat(129) }, { email, password, userId: 'another-user' }]) {
    assert.equal((await request('login', { method: 'POST', body })).status, 400);
  }
  const bad = await fetch(`${base}/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{"password":"DO_NOT_ECHO_SECRET",' });
  assert.equal(bad.status, 400); assert.ok(!(await bad.text()).includes('DO_NOT_ECHO_SECRET'));
  const large = await request('register', { method: 'POST', body: { email, password, displayName: 'x'.repeat(5000) } });
  assert.equal(large.status, 413);
  const options = await fetch(`${base}/auth/login`, { method: 'OPTIONS', headers: { Origin: origin,
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-weavefield-request' } });
  assert.equal(options.headers.get('access-control-allow-origin'), origin);
  assert.equal(options.headers.get('access-control-allow-credentials'), 'true');
});

test('legacy users have no default password and cannot authenticate', async () => {
  await prisma.user.create({ data: { email: `${run}-legacy@example.invalid`, emailCanonical: `${run}-legacy@example.invalid`, displayName: 'Legacy' } });
  assert.equal((await request('login', { method: 'POST', body: { email: `${run}-legacy@example.invalid`, password } })).status, 401);
});

test('deleting a user cascades sessions and invalidates the browser token', async () => {
  const response = await request('register', { method: 'POST', body: { email: `${run}-delete@example.invalid`, password, displayName: 'Delete probe' } });
  assert.equal(response.status, 201);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const { user } = await response.json();
  assert.equal(await prisma.session.count({ where: { userId: user.id } }), 1);
  await prisma.user.delete({ where: { id: user.id } });
  assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);
  assert.equal((await request('me', { cookie })).status, 401);
});

test('transient password saturation returns 503 without a long Retry-After and recovers', async t => {
  const { PasswordService } = require('../dist/auth/password.service');
  const passwords = app.get(PasswordService);
  const pending = [];
  const crypto = require('node:crypto');
  const scrypt = crypto.scrypt;
  // 在密码计算的外部边界控制完成事件，避免依赖机器速度或固定延时。
  t.mock.method(crypto, 'scrypt', (...args) => {
    if (pending.length < 2) pending.push(args.at(-1));
    else scrypt(...args); // 并发保护失效时让请求正常完成，使断言失败而非挂起。
  });
  const running = [passwords.hash(password), passwords.hash(password)];
  try {
    const response = await request('login', { method: 'POST', body: { email, password } });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), null);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { statusCode: 503, message: '密码计算暂时繁忙，请稍后重试' });
  } finally {
    for (const complete of pending) complete(null, Buffer.alloc(64));
    await Promise.all(running);
    t.mock.restoreAll();
  }
  assert.equal((await request('login', { method: 'POST', body: { email, password } })).status, 200);
});

test('login attempts are bounded and spoofing X-Forwarded-For does not bypass the limit', async () => {
  let limited = false;
  for (let index = 0; index < 22; index++) {
    const response = await request('login', { method: 'POST', body: { email: `${run}-limit-${index}@example.invalid`, password },
      headers: { 'X-Forwarded-For': `203.0.113.${index}` } });
    if (response.status === 429) { limited = true; assert.equal(response.headers.get('retry-after'), '900'); break; }
    assert.equal(response.status, 401);
  }
  assert.ok(limited, 'Login IP limit must be enforced');
});


test('production sessions use Secure __Host cookies and the configured HTTPS origin', async () => {
  await app.close();
  process.env.NODE_ENV = 'production';
  process.env.WEB_ORIGIN = 'https://weavefield.example';
  try {
    const { createApplication } = require('../dist/application');
    app = await createApplication(); await app.listen(0, '127.0.0.1'); base = await app.getUrl();
    const response = await request('login', { method: 'POST', headers: { Origin: 'https://weavefield.example' }, body: { email, password } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /^__Host-weavefield_session=/);
    assert.match(response.headers.get('set-cookie'), /; Secure/);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    assert.match(response.headers.get('set-cookie'), /Path=\//);
    assert.doesNotMatch(response.headers.get('set-cookie'), /Domain=/);
  } finally { delete process.env.NODE_ENV; process.env.WEB_ORIGIN = origin; }
});
