require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { before, after, test } = require('node:test');
const { RequestMethod } = require('@nestjs/common');
const { METHOD_METADATA, PATH_METADATA } = require('@nestjs/common/constants');
const { ModulesContainer } = require('@nestjs/core');
const SwaggerParser = require('@apidevtools/swagger-parser');
const Ajv = require('ajv');
const { prepareDatabase } = require('../../../tests/helpers/database.cjs');
const run = `openapi-${randomUUID()}`;
const origin = 'http://127.0.0.1:15173';
let app, prisma, base, document, ownerCookie, viewerCookie, space, item, viewerId;
const savedEnv = { NODE_ENV: process.env.NODE_ENV, WEB_ORIGIN: process.env.WEB_ORIGIN, ENABLE_OPENAPI_DOCS: process.env.ENABLE_OPENAPI_DOCS };
const restoreEnv = () => { for (const [name, value] of Object.entries(savedEnv)) value === undefined ? delete process.env[name] : process.env[name] = value; };
const createApplication = () => require('../dist/application').createApplication();
const ajv = new Ajv({ strict: false, validateFormats: false });
function valid(schema, data) {
  const validate = ajv.compile({ ...schema, components: document.components });
  assert.ok(validate(data), JSON.stringify(validate.errors));
}
async function request(path, { method = 'GET', cookie = ownerCookie, body, headers = {} } = {}) {
  return fetch(`${base}${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Weavefield-Request': '1',
    ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function response(path, template, method, status, options = {}) {
  const result = await request(path, { method, ...options });
  assert.equal(result.status, status, `${method} ${template}`);
  const contract = document.paths[template][method.toLowerCase()].responses[status];
  assert.ok(contract, `Undocumented status ${status}: ${method} ${template}`);
  if (status === 204) { assert.equal(await result.text(), ''); assert.equal(contract.content, undefined); return; }
  const data = await result.json();
  valid(contract.content['application/json'].schema, data);
  return data;
}
before(async () => {
  prisma = await prepareDatabase();
  process.env.NODE_ENV = 'test'; process.env.WEB_ORIGIN = origin; process.env.ENABLE_OPENAPI_DOCS = '1';
  app = await createApplication(); await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  const result = await fetch(`${base}/openapi.json`);
  assert.equal(result.status, 200); assert.equal(result.headers.get('set-cookie'), null);
  document = await result.json();
});
after(async () => {
  if (prisma) {
    await prisma.workspace.deleteMany({ where: { slug: { startsWith: run } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: run } } });
  }
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
  restoreEnv();
});

test('explicit local opt-in serves a valid OpenAPI 3 JSON and a browse-only Swagger UI', async () => {
  await SwaggerParser.validate(structuredClone(document));
  assert.match(document.openapi, /^3\.0\./);
  const ui = await fetch(`${base}/api-docs`);
  assert.equal(ui.status, 200); assert.match(ui.headers.get('content-type'), /text\/html/);
  assert.match(await ui.text(), /swagger-ui/);
  const init = await fetch(`${base}/api-docs/swagger-ui-init.js`);
  assert.equal(init.status, 200);
  assert.match(await init.text(), /"supportedSubmitMethods": \[\]/);
  for (const path of ['/api-docs-json', '/api-docs-yaml', '/api-docs.yaml']) assert.equal((await fetch(`${base}${path}`)).status, 404);
});

test('all real Controller route methods and paths exactly match the 18 documented operations', () => {
  const actual = [];
  for (const module of app.get(ModulesContainer).values()) for (const { metatype } of module.controllers.values()) {
    const prefix = Reflect.getMetadata(PATH_METADATA, metatype);
    for (const name of Object.getOwnPropertyNames(metatype.prototype)) {
      const fn = metatype.prototype[name];
      const method = Reflect.getMetadata(METHOD_METADATA, fn);
      if (method === undefined) continue;
      const suffix = Reflect.getMetadata(PATH_METADATA, fn);
      actual.push(`${RequestMethod[method].toLowerCase()} /${[prefix, suffix].join('/').split('/').filter(Boolean).join('/').replace(/:([A-Za-z]+)/g, '{$1}')}`);
    }
  }
  const published = Object.entries(document.paths).flatMap(([path, methods]) => Object.keys(methods).map(method => `${method} ${path}`));
  assert.equal(actual.length, 18);
  assert.deepEqual(published.sort(), actual.sort());
});

test('Cookie Session, required write headers, input fields and resource parameters are explicit', () => {
  assert.deepEqual(document.components.securitySchemes, {
    cookieSession: { type: 'apiKey', in: 'cookie', name: 'weavefield_session', description: '浏览器自动携带 HttpOnly Cookie；不要粘贴真实 Session 值。' },
  });
  for (const [path, methods] of Object.entries(document.paths)) for (const [method, operation] of Object.entries(methods)) {
    if (path.startsWith('/workspaces') || path === '/auth/me') assert.deepEqual(operation.security, [{ cookieSession: [] }]);
    else assert.ok(!operation.security?.length);
    for (const name of [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1])) {
      const param = operation.parameters.find(p => p.name === name && p.in === 'path');
      assert.equal(param.required, true); assert.equal(param.schema.maxLength, 80);
    }
    if (['post', 'patch', 'delete'].includes(method)) {
      for (const name of ['Origin', 'X-Weavefield-Request']) assert.equal(operation.parameters.find(p => p.name === name).required, true);
      if (path !== '/auth/logout') assert.equal(operation.requestBody.required, true);
      else assert.equal(operation.requestBody.required, false);
      assert.deepEqual(Object.keys(operation.requestBody.content), ['application/json']);
    }
  }
  const schemas = document.components.schemas;
  for (const name of ['RegisterInput', 'LoginInput', 'CreateWorkspaceInput', 'RenameWorkspaceInput', 'AddMemberInput', 'ChangeRoleInput', 'DocumentTitleInput', 'EmptyInput']) {
    assert.equal(schemas[name].additionalProperties, false);
    assert.equal(schemas[name].type, 'object');
  }
  assert.deepEqual(schemas.RegisterInput.required, ['email', 'password', 'displayName']);
  assert.deepEqual(schemas.AddMemberInput.required, ['email']);
  assert.equal(schemas.AddMemberInput.properties.role.default, 'VIEWER');
  assert.deepEqual(schemas.ChangeRoleInput.properties.role.enum, ['OWNER', 'EDITOR', 'VIEWER']);
  assert.equal(schemas.LoginInput.properties.password.writeOnly, true);
  assert.equal(schemas.LoginInput.properties.password.minLength, 12);
  assert.equal(schemas.LoginInput.properties.password.maxLength, 128);
  assert.match(schemas.LoginInput.properties.password.description, /256/);
  // 429 / 503 的真实 HTTP 行为由既有 Auth 集成用例验证，这里确保它们未漏出契约。
  assert.deepEqual(Object.keys(document.paths['/auth/login'].post.responses).sort(), ['200', '400', '401', '403', '413', '429', '503']);
  assert.deepEqual(Object.keys(document.paths['/auth/register'].post.responses).sort(), ['201', '400', '403', '409', '413', '429', '503']);
});

test('every public response schema excludes credentials and private room mappings', () => {
  const visited = new Set();
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      if (visited.has(value.$ref)) return;
      visited.add(value.$ref);
      return inspect(document.components.schemas[value.$ref.split('/').at(-1)]);
    }
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!['password', 'passwordHash', 'token', 'tokenHash', 'ydocRoomName', 'binaryState', 'DATABASE_URL'].includes(key), `Private response field ${key}`);
      inspect(child);
    }
  }
  for (const methods of Object.values(document.paths)) for (const operation of Object.values(methods)) inspect(operation.responses);
  assert.deepEqual(Object.keys(document.components.schemas.User.properties).sort(), ['displayName', 'email', 'id']);
  assert.deepEqual(Object.keys(document.components.schemas.Document.properties).sort(), ['archivedAt', 'createdAt', 'id', 'title', 'updatedAt', 'workspaceId']);
});

test('generating and fetching documentation performs no business database operations or Session creation', async t => {
  const fail = () => { throw new Error('Documentation must not execute a database operation'); };
  const spies = [];
  const restore = [];
  // Prisma Proxy 的 descriptor 不含 value，不能用 mock.method；在数据库边界替换可调用属性。
  function deny(target, name) {
    const original = target[name]; const spy = t.mock.fn(fail);
    target[name] = spy; spies.push(spy); restore.push(() => { target[name] = original; });
  }
  let isolated;
  try {
    for (const name of ['$transaction', '$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe']) deny(prisma, name);
    for (const model of ['user', 'session', 'workspace', 'membership', 'document', 'documentSnapshot', 'board', 'boardNode', 'boardEdge', 'task', 'entityLink']) {
      for (const method of ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy']) deny(prisma[model], method);
    }
    isolated = await createApplication();
    await isolated.listen(0, '127.0.0.1');
    const result = await fetch(`${await isolated.getUrl()}/openapi.json`);
    assert.equal(result.status, 200); assert.equal(result.headers.get('set-cookie'), null);
    assert.deepEqual(await result.json(), document);
    for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
  } finally { if (isolated) await isolated.close(); for (const undo of restore.reverse()) undo(); t.mock.restoreAll(); }
});

test('all 18 success contracts validate against real HTTP responses with documentation enabled', async () => {
  const password = 'OpenAPI acceptance password 42!';
  for (const actor of ['owner', 'viewer']) {
    const result = await request('/auth/register', { method: 'POST', cookie: null, body: { email: `${run}-${actor}@example.invalid`, password, displayName: actor } });
    assert.equal(result.status, 201);
    const data = await result.json(); valid(document.paths['/auth/register'].post.responses[201].content['application/json'].schema, data);
    if (actor === 'owner') ownerCookie = result.headers.get('set-cookie').split(';')[0];
    else { viewerCookie = result.headers.get('set-cookie').split(';')[0]; viewerId = data.user.id; }
  }
  const login = await request('/auth/login', { method: 'POST', body: { email: `${run}-owner@example.invalid`, password } });
  assert.equal(login.status, 200); valid(document.paths['/auth/login'].post.responses[200].content['application/json'].schema, await login.json());
  ownerCookie = login.headers.get('set-cookie').split(';')[0];
  await response('/auth/me', '/auth/me', 'GET', 200);
  await response('/health', '/health', 'GET', 200);
  space = await response('/workspaces', '/workspaces', 'POST', 201, { body: { name: '验收空间', slug: run } });
  await response('/workspaces', '/workspaces', 'GET', 200);
  const ws = `/workspaces/${space.id}`;
  await response(ws, '/workspaces/{workspaceId}', 'GET', 200);
  await response(ws, '/workspaces/{workspaceId}', 'PATCH', 200, { body: { name: '修改空间' } });
  await response(`${ws}/members`, '/workspaces/{workspaceId}/members', 'GET', 200);
  await response(`${ws}/members`, '/workspaces/{workspaceId}/members', 'POST', 201, { body: { email: `${run}-viewer@example.invalid` } });
  await response(`${ws}/members/${viewerId}`, '/workspaces/{workspaceId}/members/{userId}', 'PATCH', 200, { body: { role: 'EDITOR' } });
  await response(`${ws}/members/${viewerId}`, '/workspaces/{workspaceId}/members/{userId}', 'PATCH', 200, { body: { role: 'VIEWER' } });
  item = await response(`${ws}/documents`, '/workspaces/{workspaceId}/documents', 'POST', 201, { body: { title: '验收文档' } });
  await response(`${ws}/documents`, '/workspaces/{workspaceId}/documents', 'GET', 200);
  await response(`${ws}/documents/${item.id}`, '/workspaces/{workspaceId}/documents/{documentId}', 'GET', 200);
  await response(`${ws}/documents/${item.id}`, '/workspaces/{workspaceId}/documents/{documentId}', 'PATCH', 200, { body: { title: '验收改名' } });
  const archived = await response(`${ws}/documents/${item.id}/archive`, '/workspaces/{workspaceId}/documents/{documentId}/archive', 'POST', 200, { body: {} });
  assert.ok(archived.archivedAt);
  await response(`${ws}/members/${viewerId}`, '/workspaces/{workspaceId}/members/{userId}', 'DELETE', 204, { body: {} });
  // 保留 viewer 为真实只读成员，供后续优先级回归。
  await response(`${ws}/members`, '/workspaces/{workspaceId}/members', 'POST', 201, { body: { email: `${run}-viewer@example.invalid` } });
  item = await response(`${ws}/documents`, '/workspaces/{workspaceId}/documents', 'POST', 201, { body: { title: '有效文档' } });
  await response('/auth/logout', '/auth/logout', 'POST', 204, { cookie: null });
});

test('trimmed Unicode input boundaries agree with schemas and the unchanged HTTP validators', async () => {
  const schema = document.components.schemas.DocumentTitleInput;
  const validate = ajv.compile(schema);
  const ws = `/workspaces/${space.id}/documents`;
  for (const title of ['  标题  ', ' 😀 ', '😀'.repeat(200), ` ${'织'.repeat(200)} `, '', ' ', '\n标题', '标题\n', 'x'.repeat(201)]) {
    const accepted = validate({ title });
    const result = await request(ws, { method: 'POST', body: { title } });
    assert.equal(result.status, accepted ? 201 : 400, 'Schema and real title validation must agree');
    if (accepted) assert.equal((await result.json()).title, title.trim());
  }
  for (const body of [{ title: 'X', role: 'OWNER' }, { title: null }, {}, []]) {
    assert.equal(validate(body), false);
    await response(ws, '/workspaces/{workspaceId}/documents', 'POST', 400, { body });
  }
  const loginSchema = document.components.schemas.LoginInput;
  for (const body of [{ email: 'invalid', password: 's'.repeat(12) }, { email: 'a@b.c', password: 'short' }, { email: 'a@b.c', password: 's'.repeat(129) }]) {
    assert.equal(ajv.compile(loginSchema)(body), false);
    await response('/auth/login', '/auth/login', 'POST', 400, { cookie: null, body });
  }
  // OpenAPI 的字符数不能代替 UTF-8 字节数，字节限制在声明描述中独立列出。
  await response('/auth/login', '/auth/login', 'POST', 400, { cookie: null, body: { email: 'a@b.c', password: '织'.repeat(100) } });
  // logout 与移除成员的空对象契约不同：它忽略 JSON 内容，且允许省略 body。
  await response('/auth/logout', '/auth/logout', 'POST', 204, { cookie: null, body: { ignored: true } });
});

test('401/403/404/400/413 priorities remain truthful across parser, Guard, input and resource checks', async () => {
  const route = `/workspaces/${space.id}/documents`;
  const template = '/workspaces/{workspaceId}/documents';
  await response(route, template, 'POST', 401, { cookie: null, body: {}, headers: { Origin: 'https://evil.invalid' } });
  await response(route, template, 'POST', 403, { body: {}, headers: { Origin: 'https://evil.invalid' } });
  await response('/workspaces/missing/documents', template, 'POST', 400, { body: { title: '' } });
  await response('/workspaces/missing/documents', template, 'POST', 404, { body: { title: 'valid' } });
  await response(`${route}/${item.id}`, `${template}/{documentId}`, 'PATCH', 403, { cookie: viewerCookie, body: { title: 'valid' } });
  await response(`${route}/missing`, `${template}/{documentId}`, 'PATCH', 404, { cookie: viewerCookie, body: { title: 'valid' } });
  for (const suffix of ['', '/archive']) await response(`${route}/missing${suffix}`, `${template}/{documentId}${suffix}`, suffix ? 'POST' : 'GET', 404, { cookie: viewerCookie, ...(suffix ? { body: {} } : {}) });
  const bad = await fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"DO_NOT_ECHO",' });
  assert.equal(bad.status, 400); const error = await bad.json(); valid(document.components.schemas.ApiError, error); assert.ok(!JSON.stringify(error).includes('DO_NOT_ECHO'));
  await response(route, template, 'POST', 413, { cookie: null, body: { title: 'x'.repeat(5000) } });
  await response('/workspaces', '/workspaces', 'POST', 409, { body: { name: '重复', slug: run } });
});

test('default, false-like, unknown-environment and production configurations do not mount docs or their assets', async () => {
  for (const [mode, flag] of [['development', undefined], ['development', '0'], ['development', 'true'], ['staging', '1'], ['production', undefined], ['production', '1']]) {
    let isolated;
    try {
      process.env.NODE_ENV = mode; process.env.WEB_ORIGIN = mode === 'production' ? 'https://weavefield.example' : origin;
      if (flag === undefined) delete process.env.ENABLE_OPENAPI_DOCS; else process.env.ENABLE_OPENAPI_DOCS = flag;
      isolated = await createApplication(); await isolated.listen(0, '127.0.0.1'); const url = await isolated.getUrl();
      for (const path of ['/openapi.json', '/api-docs', '/api-docs/', '/api-docs/swagger-ui-init.js', '/api-docs/swagger-ui.css', '/api-docs-json', '/api-docs-yaml']) {
        assert.equal((await fetch(`${url}${path}`)).status, 404, `${mode}/${flag}: ${path}`);
      }
      assert.equal((await fetch(`${url}/health`)).status, 200);
      assert.equal((await fetch(`${url}/workspaces`)).status, 401);
    } finally { if (isolated) await isolated.close(); }
  }
  process.env.NODE_ENV = 'test'; process.env.WEB_ORIGIN = origin; process.env.ENABLE_OPENAPI_DOCS = '1';
});
