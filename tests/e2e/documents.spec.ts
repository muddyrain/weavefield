import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page, type Locator } from '@playwright/test';
const localRequire = createRequire(path.resolve('package.json'));
const { prepareDatabase } = localRequire('./tests/helpers/database.cjs');
const apiRequire = createRequire(path.resolve('apps/api/package.json'));
const run = `uidoc-${randomUUID()}`;
const headers = { Origin: 'http://127.0.0.1:15173', 'X-Weavefield-Request': '1' };
const password = 'Document browser password 42!';
const accounts = Object.fromEntries(['owner', 'editor', 'viewer', 'outsider'].map(actor => [actor, { email: `${run}-${actor}@example.invalid`, displayName: `文档${actor}`, id: '' }])) as Record<string, { email: string; displayName: string; id: string }>;
let prisma: Awaited<ReturnType<typeof prepareDatabase>>;
let authApi: { close(): Promise<void> } | undefined;
let authBase: string;
test.beforeAll(async ({ browser }) => {
  prisma = await prepareDatabase();
  // 独立真实 API 隔离夹具的认证限流计数；Session 仍由数据库校验，文档请求走原 E2E API。
  apiRequire('reflect-metadata'); process.env.WEB_ORIGIN = headers.Origin;
  const app = await apiRequire('./dist/application').createApplication(); authApi = app;
  await app.listen(0, '127.0.0.1'); authBase = await app.getUrl();
  for (const account of Object.values(accounts)) {
    const context = await browser.newContext();
    try {
      const response = await context.request.post(`${authBase}/auth/register`, { headers, data: { email: account.email, displayName: account.displayName, password } });
      expect(response.status()).toBe(201); account.id = (await response.json()).user.id;
    } finally { await context.close(); }
  }
});
test.afterEach(async () => { await prisma.workspace.deleteMany({ where: { slug: { startsWith: run } } }); });
test.afterAll(async () => {
  try { if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: run } } }); }
  finally { if (authApi) await authApi.close(); if (prisma) await prisma.$disconnect(); }
});
async function login(browser: Browser, actor = 'owner') {
  const context = await browser.newContext(); const account = accounts[actor]!;
  expect((await context.request.post(`${authBase}/auth/login`, { headers, data: { email: account.email, password } })).status()).toBe(200);
  const page = await context.newPage(); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?doc=documents-demo');
  await expect(page.getByTestId('current-user')).toHaveText(account.displayName);
  return { context, page, errors };
}
async function space(context: BrowserContext, suffix: string, name: string) {
  const response = await context.request.post('/api/workspaces', { headers, data: { name, slug: `${run}-${suffix}` } });
  expect(response.status()).toBe(201); return response.json();
}
async function createDocument(context: BrowserContext, workspaceId: string, title: string) {
  const response = await context.request.post(`/api/workspaces/${workspaceId}/documents`, { headers, data: { title } });
  expect(response.status()).toBe(201); return response.json();
}
async function open(page: Page, workspaceId: string, actor = 'owner') {
  await page.getByRole('button', { name: accounts[actor]!.displayName, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '我的工作空间', exact: true });
  await dialog.getByLabel('当前工作空间', { exact: true }).selectOption(workspaceId);
  const panel = dialog.getByRole('region', { name: '空间文档', exact: true });
  await expect(panel.getByText('正在加载文档…', { exact: true })).toHaveCount(0);
  await expect(panel).toBeVisible(); return { dialog, panel };
}
async function visualMetrics(detail: Locator) {
  await detail.scrollIntoViewIfNeeded();
  return detail.evaluate(element => {
    const targets = [...element.querySelectorAll('input, button')];
    return targets.map(target => {
      const r = target.getBoundingClientRect(); let visible = 0;
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
        const top = document.elementFromPoint(r.left + (i + .5) * r.width / 5, r.top + (j + .5) * r.height / 5);
        if (top === target || (top && target.contains(top))) visible++;
      }
      const clipping: string[] = [];
      for (let p = target.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p); const box = p.getBoundingClientRect();
        if (style.overflowX !== 'visible' && (r.left < box.left - 1 || r.right > box.right + 1)) clipping.push(p.tagName);
        if (style.overflowY !== 'visible' && (r.top < box.top - 1 || r.bottom > box.bottom + 1)) clipping.push(p.tagName);
      }
      return { coverage: visible / 25, clipping, inViewport: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
    });
  });
}

test('owner creates real metadata, renames across refresh and soft archives without opening an editor', async ({ browser }, info) => {
  const { context, page, errors } = await login(browser);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const workspace = await space(context, 'crud', '文档管理空间');
    let { dialog, panel } = await open(page, workspace.id);
    await expect(panel).toContainText('这个空间还没有文档');
    await panel.getByLabel('新文档标题', { exact: true }).fill('真正的项目文档');
    await panel.getByRole('button', { name: '创建文档', exact: true }).click();
    let detail = panel.getByRole('region', { name: '文档元数据', exact: true });
    await expect(detail.getByRole('heading')).toHaveText('真正的项目文档');
    await expect(panel.getByRole('list', { name: '文档列表' })).toContainText('真正的项目文档');
    await expect(detail).toContainText('正文编辑尚未开放'); await expect(detail.locator('[contenteditable]')).toHaveCount(0);
    const rows = await (await context.request.get(`/api/workspaces/${workspace.id}/documents`)).json();
    expect(rows).toHaveLength(1); expect(rows[0]).not.toHaveProperty('ydocRoomName');
    expect(await prisma.documentSnapshot.count({ where: { documentId: rows[0].id } })).toBe(0);
    await detail.getByLabel('文档标题', { exact: true }).fill('刷新后仍然存在的标题');
    await detail.getByRole('button', { name: '保存文档标题', exact: true }).click();
    await expect(detail.getByRole('heading')).toHaveText('刷新后仍然存在的标题');
    const metrics = await visualMetrics(detail);
    expect(metrics).toHaveLength(3);
    for (const metric of metrics) expect(metric).toEqual({ coverage: 1, clipping: [], inViewport: true });
    await info.attach('document-layout', { body: JSON.stringify(metrics), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('documents-desktop.png'), fullPage: true });
    await page.reload(); ({ dialog, panel } = await open(page, workspace.id));
    await panel.getByRole('button', { name: '刷新后仍然存在的标题', exact: true }).click();
    detail = panel.getByRole('region', { name: '文档元数据', exact: true });
    await expect(detail.getByRole('heading')).toHaveText('刷新后仍然存在的标题');
    await detail.getByRole('button', { name: '归档文档', exact: true }).click();
    await expect(panel).toContainText('文档已归档'); await expect(panel.getByRole('list')).toBeEmpty();
    await expect(detail).toHaveCount(0);
    expect((await context.request.get(`/api/workspaces/${workspace.id}/documents/${rows[0].id}`)).status()).toBe(404);
    expect((await prisma.document.findUnique({ where: { id: rows[0].id } })).archivedAt).not.toBeNull();
    await dialog.getByRole('button', { name: '关闭工作空间' }).click();
    await expect(page.getByRole('heading', { name: '产品需求文档' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('viewer sees read-only metadata and real API writes are denied; editor can manage documents', async ({ browser }) => {
  const owner = await login(browser);
  const workspace = await space(owner.context, 'roles', '文档权限空间');
  for (const [actor, role] of [['viewer', 'VIEWER'], ['editor', 'EDITOR']] as const) {
    expect((await owner.context.request.post(`/api/workspaces/${workspace.id}/members`, { headers, data: { email: accounts[actor]!.email, role } })).status()).toBe(201);
  }
  const item = await createDocument(owner.context, workspace.id, '只读可见');
  const viewer = await login(browser, 'viewer'); const editor = await login(browser, 'editor');
  try {
    const { panel } = await open(viewer.page, workspace.id, 'viewer');
    await panel.getByRole('button', { name: item.title, exact: true }).click();
    await expect(panel.getByRole('heading', { level: 4 })).toHaveText(item.title);
    await expect(panel.getByRole('form')).toHaveCount(0); await expect(panel.getByRole('button', { name: '归档文档' })).toHaveCount(0);
    const root = `/api/workspaces/${workspace.id}/documents`;
    for (const [url, method, data] of [[root, 'POST', { title: '拒绝' }], [`${root}/${item.id}`, 'PATCH', { title: '拒绝' }], [`${root}/${item.id}/archive`, 'POST', {}]] as const) {
      expect((await viewer.context.request.fetch(url, { method, headers, data })).status()).toBe(403);
    }
    const writer = (await open(editor.page, workspace.id, 'editor')).panel;
    await writer.getByLabel('新文档标题', { exact: true }).fill('编辑者创建');
    await writer.getByRole('button', { name: '创建文档', exact: true }).click();
    await expect(writer.getByRole('heading', { level: 4 })).toHaveText('编辑者创建');
    await writer.getByLabel('文档标题', { exact: true }).fill('编辑者改名');
    await writer.getByRole('button', { name: '保存文档标题' }).click();
    await expect(writer.getByRole('heading', { level: 4 })).toHaveText('编辑者改名');
    await writer.getByRole('button', { name: '归档文档' }).click();
    await expect(writer.getByRole('button', { name: '编辑者改名', exact: true })).toHaveCount(0);
  } finally { await Promise.all([owner.context.close(), viewer.context.close(), editor.context.close()]); }
});

test('late document and workspace responses cannot overwrite newer selections', async ({ browser }) => {
  const { context, page } = await login(browser);
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
  let releaseWorkspace!: () => void; let enteredWorkspace!: () => void;
  const workspaceGate = new Promise<void>(resolve => { releaseWorkspace = resolve; });
  const workspaceStarted = new Promise<void>(resolve => { enteredWorkspace = resolve; });
  try {
    const a = await space(context, 'race-a', '空间甲'); const b = await space(context, 'race-b', '空间乙');
    const old = await createDocument(context, a.id, '过期响应标题'); await createDocument(context, a.id, '最新文档');
    await createDocument(context, b.id, '乙空间文档');
    const { dialog, panel } = await open(page, a.id);
    await page.route(`**/api/workspaces/${a.id}/documents/${old.id}`, async route => { const response = await route.fetch(); entered(); await gate; await route.fulfill({ response }); });
    await panel.getByRole('button', { name: old.title, exact: true }).click(); await started;
    await panel.getByRole('button', { name: '最新文档', exact: true }).click();
    await expect(panel.getByRole('heading', { level: 4 })).toHaveText('最新文档');
    const completed = page.waitForResponse(response => response.url().endsWith(`/documents/${old.id}`));
    release(); await (await completed).finished();
    await expect(panel.getByRole('heading', { level: 4 })).toHaveText('最新文档');
    await page.unroute(`**/api/workspaces/${a.id}/documents/${old.id}`);
    await page.route(`**/api/workspaces/${a.id}/documents/${old.id}`, async route => {
      const response = await route.fetch(); enteredWorkspace(); await workspaceGate; await route.fulfill({ response });
    });
    await panel.getByRole('button', { name: old.title, exact: true }).click(); await workspaceStarted;
    await dialog.getByLabel('当前工作空间', { exact: true }).selectOption(b.id);
    await expect(panel.getByRole('button', { name: '乙空间文档', exact: true })).toBeVisible();
    const oldWorkspaceCompleted = page.waitForResponse(response => response.url().endsWith(`/documents/${old.id}`));
    releaseWorkspace(); await (await oldWorkspaceCompleted).finished();
    await expect(panel.getByRole('region', { name: '文档元数据' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '最新文档', exact: true })).toHaveCount(0);
    await page.reload(); const fresh = (await open(page, b.id)).panel;
    await expect(fresh).toContainText('乙空间文档'); await expect(fresh).not.toContainText('过期响应标题');
  } finally { release(); releaseWorkspace(); await context.close(); }
});

test('loading, network failure and refresh recovery never claim an empty successful list', async ({ browser }) => {
  const { context, page } = await login(browser); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const workspace = await space(context, 'network', '错误反馈空间');
    await page.route(`**/api/workspaces/${workspace.id}/documents`, async route => { await gate; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '文档服务暂时不可用' }) }); });
    await page.getByRole('button', { name: accounts.owner!.displayName, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '我的工作空间', exact: true });
    await dialog.getByLabel('当前工作空间', { exact: true }).selectOption(workspace.id);
    const panel = dialog.getByRole('region', { name: '空间文档' });
    await expect(panel.getByRole('status')).toHaveText('正在加载文档…');
    await expect(panel.getByRole('button', { name: '创建文档', exact: true })).toBeDisabled();
    release(); await expect(panel.getByRole('alert')).toHaveText('文档服务暂时不可用');
    await expect(panel.getByText('这个空间还没有文档。')).toHaveCount(0);
    await page.unroute(`**/api/workspaces/${workspace.id}/documents`);
    await page.route(`**/api/workspaces/${workspace.id}/documents`, route => route.abort('connectionrefused'));
    await panel.getByRole('button', { name: '刷新文档', exact: true }).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByText('这个空间还没有文档。')).toHaveCount(0);
    await page.unroute(`**/api/workspaces/${workspace.id}/documents`);
    await panel.getByRole('button', { name: '刷新文档', exact: true }).click();
    await expect(panel.getByText('这个空间还没有文档。')).toBeVisible();
  } finally { release(); await context.close(); }
});

test('stale write permissions show 403 and externally archived details show 404', async ({ browser }) => {
  const owner = await login(browser); const editor = await login(browser, 'editor');
  try {
    const workspace = await space(owner.context, 'stale', '过期权限空间');
    expect((await owner.context.request.post(`/api/workspaces/${workspace.id}/members`, { headers, data: { email: accounts.editor!.email, role: 'EDITOR' } })).status()).toBe(201);
    const item = await createDocument(owner.context, workspace.id, '待授权修改');
    const { panel } = await open(editor.page, workspace.id, 'editor');
    await panel.getByRole('button', { name: item.title, exact: true }).click();
    await expect(panel.getByRole('heading', { level: 4 })).toHaveText(item.title);
    expect((await owner.context.request.patch(`/api/workspaces/${workspace.id}/members/${accounts.editor!.id}`, { headers, data: { role: 'VIEWER' } })).status()).toBe(200);
    await panel.getByLabel('文档标题', { exact: true }).fill('不能保存');
    await panel.getByRole('button', { name: '保存文档标题' }).click();
    await expect(panel.getByRole('alert')).toHaveText('此操作需要 OWNER 或 EDITOR 权限');
    await expect(panel.getByRole('form')).toHaveCount(0);
    expect((await owner.context.request.post(`/api/workspaces/${workspace.id}/documents/${item.id}/archive`, { headers, data: {} })).status()).toBe(200);
    await panel.getByRole('button', { name: item.title, exact: true }).click();
    await expect(panel.getByRole('alert')).toHaveText('文档不存在或不可访问');
    await expect(panel.getByRole('region', { name: '文档元数据' })).toHaveCount(0);
  } finally { await Promise.all([owner.context.close(), editor.context.close()]); }
});

test('logout, account switching and session expiry clear protected document information', async ({ browser }) => {
  const { context, page } = await login(browser);
  try {
    const workspace = await space(context, 'session', '账号隔离空间'); await createDocument(context, workspace.id, '前一账号私有标题');
    let { dialog, panel } = await open(page, workspace.id);
    await panel.getByRole('button', { name: '前一账号私有标题', exact: true }).click();
    await expect(panel.getByRole('heading', { level: 4 })).toHaveText('前一账号私有标题');
    await dialog.getByRole('button', { name: '关闭工作空间' }).click();
    await page.getByRole('button', { name: '退出', exact: true }).click();
    await expect(page.getByTestId('current-user')).toHaveCount(0); await expect(page.getByText('前一账号私有标题', { exact: true })).toHaveCount(0);
    const outsider = accounts.outsider!;
    expect((await context.request.post(`${authBase}/auth/login`, { headers, data: { email: outsider.email, password } })).status()).toBe(200);
    await page.reload(); await page.getByRole('button', { name: outsider.displayName, exact: true }).click();
    await expect(page.getByRole('dialog')).not.toContainText('前一账号私有标题');
    expect((await context.request.get(`/api/workspaces/${workspace.id}/documents`)).status()).toBe(404);
    expect((await context.request.post(`${authBase}/auth/login`, { headers, data: { email: accounts.owner!.email, password } })).status()).toBe(200);
    await page.reload(); ({ dialog, panel } = await open(page, workspace.id));
    await prisma.session.updateMany({ where: { userId: accounts.owner!.id }, data: { expiresAt: new Date(0) } });
    await panel.getByRole('button', { name: '刷新文档' }).click();
    await expect(dialog).not.toBeVisible(); await expect(page.getByTestId('current-user')).toHaveCount(0);
  } finally { await context.close(); }
});

test('mobile document metadata keeps controls visible and inside the dialog', async ({ browser }, info) => {
  const { context, page, errors } = await login(browser);
  try {
    await page.setViewportSize({ width: 375, height: 844 });
    const workspace = await space(context, 'mobile', '移动文档空间'); const item = await createDocument(context, workspace.id, '移动端文档');
    const { panel } = await open(page, workspace.id);
    await panel.getByRole('button', { name: item.title, exact: true }).click();
    const detail = panel.getByRole('region', { name: '文档元数据' });
    await expect(detail.getByRole('heading')).toHaveText(item.title);
    const metrics = await visualMetrics(detail);
    for (const metric of metrics) expect(metric).toEqual({ coverage: 1, clipping: [], inViewport: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await info.attach('document-mobile-layout', { body: JSON.stringify(metrics), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('documents-mobile.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
