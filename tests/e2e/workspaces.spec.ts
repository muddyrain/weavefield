import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
const localRequire = createRequire(path.resolve('package.json'));
const { prepareDatabase } = localRequire('./tests/helpers/database.cjs');
const apiRequire = createRequire(path.resolve('apps/api/package.json'));
// 此文件包含真实登录；只保留白名单诊断，不生成含凭据的原始 Trace。
test.use({ trace: 'off' });
const run = `uiws-${randomUUID()}`;
const password = 'Workspace browser password 42!';
const headers = { Origin: 'http://127.0.0.1:15173', 'X-Weavefield-Request': '1' };
const accounts = {
  owner: { email: `${run}-owner@example.invalid`, displayName: '空间管理员', id: '' },
  colleague: { email: `${run}-colleague@example.invalid`, displayName: '空间同事', id: '' },
};
let prisma: Awaited<ReturnType<typeof prepareDatabase>>;
let authApi: { close(): Promise<void> } | undefined;
let authBase: string;
async function startAuthApi() {
  // 仅隔离测试实例的限流计数；仍使用真实认证服务、Cookie 与数据库 Session。
  apiRequire('reflect-metadata'); process.env.WEB_ORIGIN = headers.Origin;
  const app = await apiRequire('./dist/application').createApplication(); authApi = app;
  await app.listen(0, '127.0.0.1'); authBase = await app.getUrl();
}
test.beforeAll(async ({ browser }, info) => {
  prisma = await prepareDatabase();
  await startAuthApi();
  for (const account of Object.values(accounts)) {
    const context = await browser.newContext();
    try {
      const response = await context.request.post(`${authBase}/auth/register`, { headers, data: { email: account.email, displayName: account.displayName, password } });
      console.info('[workspace-auth] ' + JSON.stringify({ operation: 'register', workerIndex: info.workerIndex, status: response.status() }));
      expect(response.status()).toBe(201); account.id = (await response.json()).user.id;
    } finally { await context.close(); }
  }
});
test.beforeEach(async () => { await authApi?.close(); await startAuthApi(); });
test.afterEach(async () => { await prisma.workspace.deleteMany({ where: { slug: { startsWith: run } } }); });
test.afterAll(async () => {
  try { if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: run } } }); }
  finally { if (authApi) await authApi.close(); if (prisma) await prisma.$disconnect(); }
});
async function login(browser: Browser, actor: keyof typeof accounts = 'owner') {
  const context = await browser.newContext();
  const response = await context.request.post(`${authBase}/auth/login`, { headers, data: { email: accounts[actor].email, password } });
  expect(response.status()).toBe(200);
  const page = await context.newPage(); await page.goto('/?doc=workspace-demo');
  await expect(page.getByTestId('current-user')).toHaveText(accounts[actor].displayName);
  return { context, page };
}
async function open(page: Page, actor: keyof typeof accounts = 'owner') {
  await page.getByRole('button', { name: accounts[actor].displayName, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '我的工作空间', exact: true });
  await expect(dialog).toBeVisible(); return dialog;
}

test('real workspace creation, switching and refresh recovery stay separate from the M0 document', async ({ browser }, info) => {
  const { context, page } = await login(browser);
  try {
    let dialog = await open(page);
    await expect(dialog).toContainText('还没有加入任何工作空间');
    await expect(dialog).toContainText('不包含 M0 演示文档');
    for (const [suffix, name] of [['alpha', '真实空间甲'], ['beta', '真实空间乙']] as const) {
      await dialog.getByLabel('新空间名称', { exact: true }).fill(name);
      await dialog.getByLabel('空间标识', { exact: true }).fill(`${run}-${suffix}`);
      await dialog.getByRole('button', { name: '创建工作空间', exact: true }).click();
      await expect(dialog.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(dialog.getByTestId('workspace-role')).toHaveText('OWNER');
    }
    await dialog.getByLabel('当前工作空间', { exact: true }).selectOption({ label: '真实空间甲' });
    await expect(dialog.getByRole('heading', { name: '真实空间甲', exact: true })).toBeVisible();
    await page.reload(); dialog = await open(page);
    await expect(dialog.getByRole('heading', { name: '真实空间甲', exact: true })).toBeVisible();
    await dialog.getByLabel('空间名称', { exact: true }).fill('改名后的真实空间');
    await dialog.getByRole('button', { name: '保存空间名称', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: '改名后的真实空间', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('workspace-desktop.png') });
    await dialog.getByRole('button', { name: '关闭工作空间', exact: true }).click();
    await expect(page.getByRole('heading', { name: '产品需求文档' })).toBeVisible();
    await expect(page.locator('.demo-pill')).toHaveText('本地演示');
  } finally { await context.close(); }
});

async function createSpace(context: BrowserContext, suffix: string, name = '成员协作空间') {
  const response = await context.request.post('/api/workspaces', { headers, data: { name, slug: `${run}-${suffix}` } });
  expect(response.status()).toBe(201); return response.json();
}
async function selectSpace(page: Page, id: string, actor: keyof typeof accounts = 'owner') {
  const dialog = await open(page, actor);
  await dialog.getByLabel('当前工作空间', { exact: true }).selectOption(id);
  await expect(dialog.getByTestId('workspace-role')).toBeVisible();
  // 角色出现时，子面板的初始鉴权请求可能尚未完成；过期 Session 前先等待其落地。
  const documents = dialog.getByRole('region', { name: '空间文档', exact: true });
  await expect(documents).toBeVisible();
  await expect(documents.getByText('正在加载文档…', { exact: true })).toHaveCount(0);
  return dialog;
}

test('owner manages real members while editor, viewer and removed users see the correct access', async ({ browser }) => {
  const owner = await login(browser); const colleague = await login(browser, 'colleague');
  try {
    const space = await createSpace(owner.context, 'members');
    const dialog = await selectSpace(owner.page, space.id);
    await dialog.getByLabel('成员邮箱', { exact: true }).fill(accounts.colleague.email.toUpperCase());
    await dialog.getByLabel('新成员角色', { exact: true }).selectOption('EDITOR');
    await dialog.getByRole('button', { name: '添加成员', exact: true }).click();
    await expect(dialog.getByTestId('workspace-member')).toHaveCount(2);
    const reader = await selectSpace(colleague.page, space.id, 'colleague');
    await expect(reader.getByTestId('workspace-role')).toHaveText('EDITOR');
    await expect(reader.getByRole('form', { name: '添加已有账号' })).toHaveCount(0);
    await expect(reader.getByRole('button', { name: '保存空间名称' })).toHaveCount(0);
    await expect(reader.getByTestId('workspace-member')).toHaveCount(2);
    await dialog.getByLabel('空间同事的角色', { exact: true }).selectOption('VIEWER');
    await dialog.getByRole('button', { name: '更新空间同事角色', exact: true }).click();
    await expect(dialog.getByTestId('workspace-member').filter({ hasText: accounts.colleague.email })).toContainText('VIEWER');
    await reader.getByRole('button', { name: '刷新工作空间', exact: true }).click();
    await expect(reader.getByTestId('workspace-role')).toHaveText('VIEWER');
    await expect(reader.getByRole('button', { name: /^移除/ })).toHaveCount(0);
    await dialog.getByRole('button', { name: '移除空间同事', exact: true }).click();
    await expect(dialog.getByTestId('workspace-member')).toHaveCount(1);
    await reader.getByRole('button', { name: '刷新工作空间', exact: true }).click();
    await expect(reader).toContainText('所选空间已不可访问');
    await expect(reader).toContainText('还没有加入任何工作空间');
    await expect(reader.getByTestId('workspace-member')).toHaveCount(0);
    expect(await colleague.page.evaluate(id => localStorage.getItem(`weavefield.workspace.${id}`), accounts.colleague.id)).toBeNull();
    await colleague.page.reload(); await open(colleague.page, 'colleague');
    await expect(colleague.page.getByTestId('workspace-role')).toHaveCount(0);
  } finally { await Promise.all([owner.context.close(), colleague.context.close()]); }
});

test('stale owner controls show server rejection and refresh the actual role', async ({ browser }) => {
  const owner = await login(browser); const colleague = await login(browser, 'colleague');
  try {
    const space = await createSpace(owner.context, 'stale');
    expect((await owner.context.request.post(`/api/workspaces/${space.id}/members`, { headers, data: { email: accounts.colleague.email, role: 'OWNER' } })).status()).toBe(201);
    const dialog = await selectSpace(owner.page, space.id);
    expect((await colleague.context.request.patch(`/api/workspaces/${space.id}/members/${accounts.owner.id}`, { headers, data: { role: 'VIEWER' } })).status()).toBe(200);
    await dialog.getByLabel('空间名称', { exact: true }).fill('不应生效的修改');
    await dialog.getByRole('button', { name: '保存空间名称', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('此操作需要 OWNER 权限');
    await expect(dialog.getByTestId('workspace-role')).toHaveText('VIEWER');
    await expect(dialog.getByRole('button', { name: '保存空间名称' })).toHaveCount(0);
    await expect(dialog.getByRole('heading', { name: '成员协作空间', exact: true })).toBeVisible();
  } finally { await Promise.all([owner.context.close(), colleague.context.close()]); }
});

test('expired and logged-out sessions clear protected workspace state and stored selection', async ({ browser }, info) => {
  const started = Date.now();
  const stages: { name: string; durationMs: number; completed: boolean }[] = [];
  const http: { operation: string; status: number }[] = [];
  let context: BrowserContext | undefined;
  let failed = false;
  async function step<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const start = Date.now(); let completed = false;
    try {
      const result = await test.step(name, operation, { timeout: 15000 });
      completed = true; return result;
    } finally {
      stages.push({ name, durationMs: Date.now() - start, completed });
      // 白名单阶段名、耗时和状态码；不输出 Cookie、密码、请求体或原始 Trace。
      console.info('[workspace-session] ' + JSON.stringify({ ...stages[stages.length - 1], http }));
    }
  }
  try {
    const actor = await step('login', () => login(browser));
    context = actor.context;
    const { page } = actor;
    page.on('response', response => {
      const route = new URL(response.url()).pathname;
      const operation = route === '/api/auth/me' ? 'session-check'
        : route === '/api/auth/logout' ? 'logout'
          : route === '/api/workspaces' ? 'workspace-list'
            : /^\/api\/workspaces\/[^/]+\/documents$/.test(route) ? 'document-list'
              : /^\/api\/workspaces\/[^/]+\/members$/.test(route) ? 'workspace-members'
                : /^\/api\/workspaces\/[^/]+$/.test(route) ? 'workspace-detail' : undefined;
      if (operation) http.push({ operation, status: response.status() });
    });
    const space = await step('create-workspace', () => createSpace(actor.context, 'expiry'));
    let dialog = await step('select-workspace', () => selectSpace(page, space.id));
    await step('expire-session', async () => {
      const expired = await prisma.session.updateMany({ where: { userId: accounts.owner.id }, data: { expiresAt: new Date(0) } });
      expect(expired.count).toBeGreaterThan(0);
    });
    await step('refresh-expired-workspace', () => dialog.getByRole('button', { name: '刷新工作空间', exact: true }).click());
    await step('verify-expired-state', async () => {
      await expect(dialog).not.toBeVisible();
      await expect(page.getByTestId('current-user')).toHaveCount(0);
      expect(await page.evaluate(id => localStorage.getItem(`weavefield.workspace.${id}`), accounts.owner.id)).toBeNull();
      const response = await actor.context.request.get(`/api/workspaces/${space.id}`);
      http.push({ operation: 'expired-workspace', status: response.status() });
      expect(response.status()).toBe(401);
    });
    await step('login-again', async () => {
      const response = await actor.context.request.post(`${authBase}/auth/login`, { headers, data: { email: accounts.owner.email, password } });
      http.push({ operation: 'login-again', status: response.status() });
      expect(response.status()).toBe(200);
    });
    await step('reload', async () => {
      await page.reload();
      await expect(page.getByTestId('current-user')).toHaveText(accounts.owner.displayName);
    });
    dialog = await step('reselect-workspace', () => selectSpace(page, space.id));
    await step('close-workspace', () => dialog.getByRole('button', { name: '关闭工作空间', exact: true }).click());
    await step('logout', () => page.getByRole('button', { name: '退出', exact: true }).click());
    await step('verify-logged-out-state', async () => {
      await expect(page.getByTestId('current-user')).toHaveCount(0);
      await expect(page.getByRole('dialog', { name: '我的工作空间' })).toHaveCount(0);
      expect(await page.evaluate(id => localStorage.getItem(`weavefield.workspace.${id}`), accounts.owner.id)).toBeNull();
      const response = await actor.context.request.get('/api/workspaces');
      http.push({ operation: 'logged-out-workspaces', status: response.status() });
      expect(response.status()).toBe(401);
    });
  } catch (error) { failed = true; throw error; }
  finally {
    // 首个业务错误优先；清理阶段单独计时，避免 context.close 掩盖原始失败。
    try { if (context) await step('close-context', () => context!.close()); }
    catch (error) { if (!failed) throw error; }
    finally {
      await info.attach('workspace-session-diagnostics', {
        body: JSON.stringify({ elapsedMs: Date.now() - started, stages, http }), contentType: 'application/json',
      });
    }
  }
});

test('mobile workspace loading, service failure and recovery use explicit feedback', async ({ browser }, info) => {
  const { context, page } = await login(browser);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/workspaces', async route => { await gate; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '工作空间服务暂时不可用' }) }); });
  try {
    await page.setViewportSize({ width: 375, height: 844 });
    const dialog = await open(page);
    await expect(dialog.getByRole('status')).toHaveText('正在加载工作空间…');
    await expect(dialog.getByRole('button', { name: '创建工作空间', exact: true })).toBeDisabled();
    release();
    await expect(dialog.getByRole('alert')).toHaveText('工作空间服务暂时不可用');
    await expect(dialog.getByText('还没有加入任何工作空间', { exact: false })).toHaveCount(0);
    await page.unroute('**/api/workspaces');
    await dialog.getByRole('button', { name: '刷新工作空间', exact: true }).click();
    await expect(dialog).toContainText('还没有加入任何工作空间');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.screenshot({ path: info.outputPath('workspace-mobile.png'), fullPage: true });
  } finally { release(); await context.close(); }
});

test('removal between list and detail responses clears the persisted selection', async ({ browser }) => {
  const owner = await login(browser); const colleague = await login(browser, 'colleague');
  try {
    const space = await createSpace(owner.context, 'read-race');
    expect((await owner.context.request.post(`/api/workspaces/${space.id}/members`, { headers, data: { email: accounts.colleague.email } })).status()).toBe(201);
    const dialog = await selectSpace(colleague.page, space.id, 'colleague');
    await colleague.page.route('**/api/workspaces', async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      expect((await owner.context.request.delete(`/api/workspaces/${space.id}/members/${accounts.colleague.id}`, { headers, data: {} })).status()).toBe(204);
      await route.fulfill({ response });
    }, { times: 1 });
    await dialog.getByRole('button', { name: '刷新工作空间', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('工作空间不存在或不可访问');
    await expect(dialog.getByTestId('workspace-member')).toHaveCount(0);
    expect(await colleague.page.evaluate(id => localStorage.getItem(`weavefield.workspace.${id}`), accounts.colleague.id)).toBeNull();
  } finally { await Promise.all([owner.context.close(), colleague.context.close()]); }
});
