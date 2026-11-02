import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type BrowserContextOptions } from '@playwright/test';
import { choose } from '../helpers/select';
import { e2eOrigin } from '../helpers/e2e-address';
const local = createRequire(path.resolve('package.json')), apiRequire = createRequire(path.resolve('apps/api/package.json'));
const { prepareDatabase } = local('./tests/helpers/database.cjs');
const run = `ux-${randomUUID().slice(0, 8)}`, headers = { Origin: e2eOrigin, 'X-Weavefield-Request': '1' };
const actors = { expired: { id: '', cookie: '', email: `${run}-expired@example.invalid` }, session: { id: '', cookie: '', email: `${run}-session@example.invalid` }, owner: { id: '', cookie: '', email: `${run}-owner@example.invalid` }, editor: { id: '', cookie: '', email: `${run}-editor@example.invalid` } };
let database: any, app: any;
test.use({ trace: 'off', video: 'off' });
test.beforeAll(async ({ browser }) => {
  database = await prepareDatabase(); apiRequire('reflect-metadata'); process.env.WEB_ORIGIN = e2eOrigin;
  app = await apiRequire('./dist/application').createApplication(); await app.listen(0, '127.0.0.1');
  for (const actor of Object.values(actors)) {
    const context = await browser.newContext();
    try { const r = await context.request.post((await app.getUrl()) + '/auth/register', { headers, data: { email: actor.email, password: 'UX browser password 42!', displayName: actor === actors.owner ? 'UX Owner' : 'UX Editor' } }); expect(r.status()).toBe(201); actor.id = (await r.json()).user.id; const cookie = r.headers()['set-cookie']?.split(';')[0]; if (!cookie) throw Error('Session Cookie missing'); actor.cookie = cookie; }
    finally { await context.close(); }
  }
});
test.afterEach(async () => { await database.workspace.deleteMany({ where: { slug: { startsWith: run } } }); });
test.afterAll(async () => { try { if (database) await database.user.deleteMany({ where: { email: { startsWith: run } } }); } finally { await app?.close(); await database?.$disconnect(); } });
async function contextFor(browser: Browser, actor: keyof typeof actors = 'owner', options: BrowserContextOptions = {}) {
  const c = await browser.newContext(options), cookie = actors[actor].cookie, at = cookie.indexOf('=');
  await c.addCookies([{ name: cookie.slice(0, at), value: cookie.slice(at + 1), url: e2eOrigin, httpOnly: true, sameSite: 'Lax' }]); return c;
}
async function space(c: BrowserContext, name = 'UX 真实工作空间') {
  const r = await c.request.post('/api/workspaces', { headers, data: { name, slug: `${run}-${randomUUID().slice(0, 8)}` } }); expect(r.status()).toBe(201); return r.json();
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

test('workspace committed creation recovers only after the complete recovery GET succeeds', async ({ browser }, info) => {
  const c = await contextFor(browser), entered = deferred(), release = deferred(), finished = deferred();
  let posts = 0, failed = false, recovering = false, held = false;
  try {
    const initial = await space(c), page = await c.newPage(); await page.goto('/?view=workspace');
    await expect(page.getByTestId('workspace-role')).toHaveText('OWNER');
    await page.route('**/api/workspaces', async route => {
      const response = await route.fetch();
      if (route.request().method() === 'POST') { expect(response.status()).toBe(201); posts++; }
      else if (posts === 1 && !failed) { failed = true; expect(response.status()).toBe(200); return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '验收故障：创建后读取失败' }) }); }
      await route.fulfill({ response });
    });
    await page.route(`**/api/workspaces/${initial.id}/members`, async route => {
      if (!recovering || held) return route.continue(); held = true;
      try { const response = await route.fetch(); expect(response.status()).toBe(200); entered.resolve(); await release.promise; await route.fulfill({ response }); } finally { finished.resolve(); }
    });
    await page.getByRole('button', { name: '新建空间', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '创建工作空间', exact: true }), submit = dialog.getByRole('button', { name: '创建工作空间', exact: true });
    await dialog.getByLabel('新空间名称', { exact: true }).fill('恢复后的第一个真实空间'); await dialog.getByLabel('空间标识', { exact: true }).fill(`${run}-first`); await submit.click();
    await expect(dialog.getByRole('alert')).toHaveText('验收故障：创建后读取失败'); await expect(submit).toBeDisabled();
    await expect(page.getByRole('status', { includeHidden: true }).filter({ hasText: '操作已由服务端完成，但刷新失败' })).toHaveCount(1); expect(posts).toBe(1);
    recovering = true; await dialog.getByRole('button', { name: '返回空间并刷新', exact: true }).click(); await entered.promise;
    await expect(page.getByRole('button', { name: '新建空间', exact: true })).toBeDisabled();
    await expect(page.getByRole('status').filter({ hasText: '操作已由服务端完成，但刷新失败' })).toHaveCount(1);
    release.resolve(); await finished.promise;
    await page.getByRole('button', { name: '新建空间', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0); await expect(submit).toBeEnabled();
    await expect(page.getByRole('status', { includeHidden: true }).filter({ hasText: '操作已由服务端完成，但刷新失败' })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('workspace-create-recovered.png') });
    await dialog.getByLabel('新空间名称', { exact: true }).fill('恢复后的第二个真实空间'); await dialog.getByLabel('空间标识', { exact: true }).fill(`${run}-second`); await submit.click();
    await expect(dialog).toHaveCount(0); await expect(page.getByRole('heading', { name: '恢复后的第二个真实空间', exact: true })).toBeVisible(); expect(posts).toBe(2);
    const actual = await c.request.get('/api/workspaces'); expect(actual.status()).toBe(200);
    expect((await actual.json()).filter((w: any) => [ '恢复后的第一个真实空间', '恢复后的第二个真实空间' ].includes(w.name))).toHaveLength(2);
  } finally { release.resolve(); if (held) await finished.promise; await c.close(); }
});

test('workspace committed creation stays protected when recovery GET fails again', async ({ browser }, info) => {
  const c = await contextFor(browser); let posts = 0, failedReads = 0;
  try {
    const initial = await space(c); const page = await c.newPage(); await page.goto('/?view=workspace'); await expect(page.getByTestId('workspace-role')).toHaveText('OWNER');
    await page.route('**/api/workspaces', async route => {
      const response = await route.fetch();
      if (route.request().method() === 'POST') { expect(response.status()).toBe(201); posts++; }
      else if (posts && !failedReads) { expect(response.status()).toBe(200); failedReads++; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: `验收故障：恢复读取失败 ${failedReads}` }) }); }
      await route.fulfill({ response });
    });
    await page.route(`**/api/workspaces/${initial.id}/members`, async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200);
      if (posts) { failedReads++; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: `验收故障：恢复读取失败 ${failedReads}` }) }); }
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: '新建空间', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '创建工作空间', exact: true });
    await dialog.getByLabel('新空间名称', { exact: true }).fill('重复读取失败仍仅创建一次'); await dialog.getByLabel('空间标识', { exact: true }).fill(`${run}-locked`); await dialog.getByRole('button', { name: '创建工作空间', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('验收故障：恢复读取失败 1'); await expect(dialog.getByRole('button', { name: '创建工作空间', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: '返回空间并刷新', exact: true }).click(); await expect(page.getByRole('alert')).toHaveText('验收故障：恢复读取失败 2');
    await page.getByRole('button', { name: '新建空间', exact: true }).click(); await expect(dialog.getByRole('button', { name: '创建工作空间', exact: true })).toBeDisabled(); await expect(dialog.getByRole('alert')).toHaveText('验收故障：恢复读取失败 2');
    expect(posts).toBe(1); const actual = await c.request.get('/api/workspaces'); expect(actual.status()).toBe(200); expect((await actual.json()).filter((w: any) => w.name === '重复读取失败仍仅创建一次')).toHaveLength(1);
    await page.screenshot({ path: info.outputPath('workspace-create-still-locked.png') });
  } finally { await c.close(); }
});

test('workspace successful automatic refresh clears the earlier read error', async ({ browser }) => {
  const c = await contextFor(browser); let failed = false;
  try {
    await space(c); const page = await c.newPage(); await page.goto('/?view=workspace'); await expect(page.getByTestId('workspace-role')).toHaveText('OWNER');
    await page.route('**/api/workspaces', async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200);
      if (!failed) { failed = true; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '验收故障：后台网络错误' }) }); }
      await route.fulfill({ response });
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(page.getByRole('alert')).toHaveText('验收故障：后台网络错误'); await expect(page.getByTestId('workspace-role')).toHaveText('OWNER');
    const refreshed = page.waitForResponse(r => r.url().endsWith('/members') && r.request().method() === 'GET'); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await refreshed;
    await expect(page.getByRole('region', { name: '我的工作空间', exact: true })).toHaveAttribute('aria-busy', 'false'); await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { await c.close(); }
});

test('workspace selector uses an accessible styled listbox and keyboard selection', async ({ browser }) => {
  const c = await contextFor(browser);
  try {
    await space(c, '第一个空间'); const second = await space(c, '第二个空间'); const page = await c.newPage(); await page.goto('/?view=tasks');
    const trigger = page.getByLabel('当前工作空间', { exact: true }); await expect(trigger).toBeEnabled();
    await expect(trigger).toHaveAttribute('data-slot', 'select-trigger');
    await trigger.focus(); await trigger.press('Enter'); await expect(page.getByRole('listbox')).toBeVisible();
    await page.getByRole('option', { name: '第二个空间', exact: true }).click(); await expect(page.getByRole('listbox')).toHaveCount(0); await expect(trigger).toContainText('第二个空间');
    await trigger.press('Enter'); await expect(page.getByRole('option', { name: '第二个空间', exact: true })).toBeFocused(); await page.keyboard.press('Home'); await expect(page.getByRole('option', { name: '第一个空间', exact: true })).toBeFocused(); await page.keyboard.press('Enter'); await expect(trigger).toContainText('第一个空间'); await expect(trigger).toBeFocused();
    expect(second.id).toBeTruthy();
  } finally { await c.close(); }
});


test('register and logout use one Sonner toast without an inline success box', async ({ browser }, info) => {
  const c = await browser.newContext(); const email = `${run}-toast@example.invalid`;
  try {
    const page = await c.newPage(); await page.goto('/?view=tasks'); await page.getByRole('button', { name: '登录 / 注册', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: '还没有账号？注册', exact: true }).click();
    await dialog.getByLabel('昵称', { exact: true }).fill('UX Toast'); await dialog.getByLabel('邮箱', { exact: true }).fill(email); await dialog.getByLabel('密码', { exact: true }).fill('UX browser password 42!');
    await dialog.getByRole('button', { name: '注册并登录', exact: true }).click(); await expect(dialog).not.toBeVisible();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: '注册成功，已登录' })).toHaveCount(1); await expect(page.locator('.auth-notice')).toHaveCount(0);
    await expect(page.locator('[data-sonner-toast]')).toHaveCSS('opacity', '1'); await page.screenshot({ path: info.outputPath('toast.png') }); await page.getByRole('button', { name: '退出', exact: true }).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: '已退出登录' })).toHaveCount(1); await expect(page.locator('.auth-notice')).toHaveCount(0);
    await page.getByRole('button', { name: '登录 / 注册', exact: true }).click(); await dialog.getByLabel('邮箱', { exact: true }).fill(email); await dialog.getByLabel('密码', { exact: true }).fill('UX browser password 42!'); await dialog.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: '登录成功' })).toHaveCount(1); await expect(page.locator('[data-sonner-toaster]')).toHaveCount(1);
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: '登录成功' })).toHaveCount(0);
  } finally { await c.close(); }
});


test('task background refresh retains the real board while a real GET is delayed', async ({ browser }, info) => {
  const c = await contextFor(browser), release = deferred(), entered = deferred(), finished = deferred(); let held = false;
  try {
    const ws = await space(c); expect((await c.request.post(`/api/workspaces/${ws.id}/tasks`, { headers, data: { title: '刷新期间仍可见的真实任务' } })).status()).toBe(201);
    const page = await c.newPage(); await page.goto('/?view=tasks'); const card = page.getByRole('button', { name: '编辑任务：刷新期间仍可见的真实任务', exact: true }); await expect(card).toBeVisible();
    await page.route(`**/api/workspaces/${ws.id}/tasks`, async route => {
      if (held || route.request().method() !== 'GET') return route.continue(); held = true;
      try { const response = await route.fetch(); entered.resolve(); await release.promise; await route.fulfill({ response }); } finally { finished.resolve(); }
    });
    await page.getByRole('button', { name: '刷新任务', exact: true }).click(); await entered.promise;
    await expect(card).toBeVisible(); await expect(page.locator('.loading-task-board')).toHaveCount(0); await page.screenshot({ path: info.outputPath('tasks-refresh.png') });
    release.resolve(); await finished.promise; await expect(card).toBeVisible();
  } finally { release.resolve(); if (held) await finished.promise; await c.close(); }
});


test('route surface transitions keep the shell stable, focus main and respect Reduced Motion', async ({ browser }, info) => {
  const c = await contextFor(browser);
  try {
    const page = await c.newPage(); await page.goto('/?view=tasks'); await expect(page.getByRole('heading', { name: '开发任务', exact: true })).toBeVisible();
    const surface = page.locator('.route-surface'); await expect(surface).toBeVisible();
    const shell = await page.locator('.sidebar').elementHandle();
    await page.evaluate(() => { (window as any).__routeFrames = []; let count = 0; const sample = () => { const node = document.querySelector('.route-surface'); if (node) (window as any).__routeFrames.push({ opacity: Number(getComputedStyle(node).opacity), y: new DOMMatrix(getComputedStyle(node).transform).m42 }); if (++count < 45) requestAnimationFrame(sample); }; requestAnimationFrame(sample); });
    await page.getByRole('button', { name: '工作空间', exact: true }).click(); await expect(surface).toHaveAttribute('data-route', 'workspace'); await expect(page.locator('#main-content')).toBeFocused();
    await expect.poll(async () => page.evaluate(() => (window as any).__routeFrames.some((f: any) => f.opacity < 1 || f.y !== 0))).toBe(true);
    await info.attach('route-frames', { body: JSON.stringify(await page.evaluate(() => (window as any).__routeFrames)), contentType: 'application/json' });
    expect(await shell?.evaluate(node => node.isConnected)).toBe(true);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.getByRole('button', { name: '开发任务', exact: true }).click(); await expect(surface).toHaveAttribute('data-route', 'tasks');
    expect(await surface.evaluate(node => ({ opacity: Number(getComputedStyle(node).opacity), y: new DOMMatrix(getComputedStyle(node).transform).m42 }))).toEqual({ opacity: 1, y: 0 });
    await page.goBack(); await expect(surface).toHaveAttribute('data-route', 'workspace'); await page.goForward(); await expect(surface).toHaveAttribute('data-route', 'tasks');
    expect(await page.locator('.document-view').evaluate(node => getComputedStyle(node).transform)).toBe('none');
  } finally { await c.close(); }
});

test('document write started during parent refresh invalidates the earlier parent response', async ({ browser }) => {
  const c = await contextFor(browser), releaseParent = deferred(), enteredParent = deferred(), parentDone = deferred(), releaseWrite = deferred(), enteredWrite = deferred(), writeDone = deferred();
  let parentHeld = false, writeHeld = false, writes = 0;
  try {
    const ws = await space(c), r = await c.request.post(`/api/workspaces/${ws.id}/documents`, { headers, data: { title: '父级读取中的文档' } }); expect(r.status()).toBe(201); const doc = await r.json();
    const page = await c.newPage(); await page.goto('/?view=workspace'); const docs = page.getByRole('region', { name: '空间文档', exact: true }); await docs.getByRole('button', { name: doc.title, exact: true }).click();
    const detail = docs.getByRole('region', { name: '文档元数据', exact: true }); await detail.getByLabel('文档标题', { exact: true }).fill('父级旧响应不能打断保存'); const controller = await docs.elementHandle();
    await page.route(`**/api/workspaces/${ws.id}`, async route => {
      if (parentHeld || route.request().method() !== 'GET') return route.continue(); parentHeld = true;
      try { const response = await route.fetch(); enteredParent.resolve(); await releaseParent.promise; await route.fulfill({ response }); } finally { parentDone.resolve(); }
    });
    await page.route(`**/api/workspaces/${ws.id}/documents/${doc.id}`, async route => {
      if (route.request().method() !== 'PATCH') return route.continue(); writes++; writeHeld = true;
      try { const response = await route.fetch(); expect(response.status()).toBe(200); enteredWrite.resolve(); await releaseWrite.promise; await route.fulfill({ response }); } finally { writeDone.resolve(); }
    });
    await page.getByRole('button', { name: '刷新工作空间', exact: true }).click(); await enteredParent.promise;
    await detail.getByRole('button', { name: '保存文档标题', exact: true }).click(); await enteredWrite.promise;
    releaseParent.resolve(); await parentDone.promise; await expect(detail.getByLabel('文档标题', { exact: true })).toBeDisabled(); expect(await controller?.evaluate(node => node.isConnected)).toBe(true);
    releaseWrite.resolve(); await writeDone.promise; await expect(detail.getByRole('heading')).toHaveText('父级旧响应不能打断保存'); await expect(page.locator('[data-sonner-toast]').filter({ hasText: '文档已保存' })).toHaveCount(1); expect(writes).toBe(1);
  } finally { releaseParent.resolve(); releaseWrite.resolve(); if (parentHeld) await parentDone.promise; if (writeHeld) await writeDone.promise; await c.close(); }
});

test('confirmed document write recovery remains locked across automatic parent refresh', async ({ browser }) => {
  const c = await contextFor(browser);
  try {
    const ws = await space(c), page = await c.newPage(); await page.goto('/?view=workspace');
    const docs = page.getByRole('region', { name: '空间文档', exact: true }); await expect(docs.getByText('正在加载文档…', { exact: true })).toHaveCount(0);
    let written = false, dropped = false, posts = 0;
    await page.route(`**/api/workspaces/${ws.id}/documents`, async route => {
      if (route.request().method() === 'POST') { posts++; const response = await route.fetch(); expect(response.status()).toBe(201); written = true; await route.fulfill({ response }); }
      else if (written && !dropped) { dropped = true; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); }
      else await route.continue();
    });
    await docs.getByRole('button', { name: '新建文档', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '创建文档', exact: true });
    await dialog.getByLabel('新文档标题', { exact: true }).fill('真实保存后读取丢失'); await dialog.getByRole('button', { name: '创建文档', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('服务端已完成创建'); await expect(dialog.getByRole('button', { name: '创建文档', exact: true })).toBeDisabled();
    const rechecked = page.waitForResponse(r => r.url().endsWith(`/workspaces/${ws.id}/members`) && r.request().method() === 'GET');
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await rechecked;
    await expect(page.getByRole('region', { name: '我的工作空间', exact: true, includeHidden: true })).toHaveAttribute('aria-busy', 'false');
    await expect(dialog.getByRole('button', { name: '创建文档', exact: true })).toBeDisabled(); await expect(dialog.getByRole('status')).toContainText('服务端已完成创建'); expect(posts).toBe(1);
    expect((await (await c.request.get(`/api/workspaces/${ws.id}/documents`)).json()).filter((d: any) => d.title === '真实保存后读取丢失')).toHaveLength(1);
  } finally { await c.close(); }
});

test('manual archive recovery does not reopen confirmation for a different document', async ({ browser }) => {
  const c = await contextFor(browser);
  try {
    const ws = await space(c), documents = [];
    for (const title of ['归档目标', '保留的文档']) { const r = await c.request.post(`/api/workspaces/${ws.id}/documents`, { headers, data: { title } }); expect(r.status()).toBe(201); documents.push(await r.json()); }
    const page = await c.newPage(); await page.goto('/?view=workspace'); const docs = page.getByRole('region', { name: '空间文档', exact: true }); await docs.getByRole('button', { name: '归档目标', exact: true }).click();
    let archived = false, dropped = false;
    await page.route(`**/api/workspaces/${ws.id}/documents**`, async route => {
      if (route.request().method() === 'POST') { const response = await route.fetch(); expect(response.status()).toBe(200); archived = true; await route.fulfill({ response }); }
      else if (archived && !dropped && route.request().url().endsWith('/documents')) { dropped = true; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); }
      else await route.continue();
    });
    await docs.getByRole('button', { name: '归档文档', exact: true }).click(); const confirmation = page.getByRole('dialog', { name: '确认归档文档', exact: true }); await confirmation.getByRole('button', { name: '确认归档文档', exact: true }).click(); await expect(confirmation).toHaveCount(0);
    await expect(docs.getByRole('status')).toContainText('操作已由服务端完成'); await page.getByRole('button', { name: '刷新工作空间', exact: true }).click();
    await docs.getByRole('button', { name: '保留的文档', exact: true }).click(); await expect(docs.getByRole('heading', { name: '保留的文档', exact: true })).toBeVisible(); await expect(confirmation).toHaveCount(0);
    const actual = await (await c.request.get(`/api/workspaces/${ws.id}/documents`)).json(); expect(actual.map((d: any) => d.title)).toEqual(['保留的文档']);
  } finally { await c.close(); }
});

for (const kind of ['tasks', 'workspace', 'documents'] as const) test(`first ${kind} load uses business skeletons for a delayed real GET`, async ({ browser }, info) => {
  const c = await contextFor(browser), release = deferred(), entered = deferred(), finished = deferred(); let held = false;
  try {
    const ws = await space(c), page = await c.newPage();
    const url = kind === 'workspace' ? '**/api/workspaces' : `**/api/workspaces/${ws.id}/${kind}`;
    await page.route(url, async route => {
      if (route.request().method() !== 'GET') return route.continue(); held = true;
      try { const response = await route.fetch(); expect(response.status()).toBe(200); entered.resolve(); await release.promise; await route.fulfill({ response }); } finally { finished.resolve(); }
    });
    await page.goto(`/?view=${kind === 'tasks' ? 'tasks' : 'workspace'}`); await entered.promise;
    const skeleton = page.locator(`.loading-${kind}`); await expect(skeleton).toBeVisible();
    if (kind === 'tasks') await expect(skeleton.locator('.loading-task-column')).toHaveCount(3);
    await page.screenshot({ path: info.outputPath(`first-${kind}.png`) });
    if (kind === 'tasks') { await page.setViewportSize({ width: 375, height: 1000 }); expect(await skeleton.locator('.loading-task-board').evaluate(n => getComputedStyle(n).gridTemplateColumns.split(' ').length)).toBe(1); await page.screenshot({ path: info.outputPath('first-tasks-375.png') }); }
    release.resolve(); await finished.promise; await expect(skeleton).toHaveCount(0);
  } finally { release.resolve(); if (held) await finished.promise; await c.pages()[0]?.unrouteAll({ behavior: 'wait' }); await c.close(); }
});

test('workspace refresh preserves the document controller, selected detail and unsaved input', async ({ browser }, info) => {
  const c = await contextFor(browser), release = deferred(), entered = deferred(), finished = deferred(); let held = false;
  try {
    const ws = await space(c), r = await c.request.post(`/api/workspaces/${ws.id}/documents`, { headers, data: { title: '保持可见的文档' } }); expect(r.status()).toBe(201);
    const page = await c.newPage(); await page.goto('/?view=workspace'); const docs = page.getByRole('region', { name: '空间文档', exact: true });
    await docs.getByRole('button', { name: '保持可见的文档', exact: true }).click(); const detail = docs.getByRole('region', { name: '文档元数据', exact: true });
    await detail.getByLabel('文档标题', { exact: true }).fill('未提交的文档草稿'); const controller = await docs.elementHandle();
    await page.route(`**/api/workspaces/${ws.id}`, async route => {
      if (held || route.request().method() !== 'GET') return route.continue(); held = true;
      try { const response = await route.fetch(); entered.resolve(); await release.promise; await route.fulfill({ response }); } finally { finished.resolve(); }
    });
    await page.getByRole('button', { name: '刷新工作空间', exact: true }).click(); await entered.promise;
    await expect(detail).toBeVisible(); await expect(detail.getByLabel('文档标题', { exact: true })).toHaveValue('未提交的文档草稿'); await page.screenshot({ path: info.outputPath('workspace-background.png') });
    release.resolve(); await finished.promise; await expect(docs).toHaveAttribute('aria-busy', 'false');
    expect(await controller?.evaluate(node => node.isConnected)).toBe(true); await expect(detail.getByLabel('文档标题', { exact: true })).toHaveValue('未提交的文档草稿');
    await docs.getByRole('button', { name: '刷新文档', exact: true }).click(); await expect(docs).toHaveAttribute('aria-busy', 'false'); await expect(detail.getByLabel('文档标题', { exact: true })).toHaveValue('未提交的文档草稿');
  } finally { release.resolve(); if (held) await finished.promise; await c.close(); }
});

test('member role Select preserves FormData, default reset and real server permissions', async ({ browser }) => {
  const c = await contextFor(browser);
  try {
    const ws = await space(c), page = await c.newPage(); await page.goto('/?view=workspace'); const root = page.getByRole('region', { name: '我的工作空间', exact: true });
    await root.getByRole('tab', { name: '成员', exact: true }).click(); await root.getByLabel('成员邮箱', { exact: true }).fill(actors.editor.email);
    await choose(root.getByLabel('新成员角色', { exact: true }), 'EDITOR'); await root.getByRole('button', { name: '添加成员', exact: true }).click();
    await expect(root.getByTestId('workspace-member')).toHaveCount(2); await expect(root.getByLabel('新成员角色', { exact: true })).toContainText('VIEWER');
    const row = root.getByTestId('workspace-member').filter({ hasText: actors.editor.email });
    await choose(row.getByRole('combobox'), 'VIEWER'); await row.getByRole('button', { name: '更新UX Editor角色', exact: true }).click();
    await expect(row.getByRole('combobox')).toContainText('VIEWER');
    const members = await (await c.request.get(`/api/workspaces/${ws.id}/members`)).json(); expect(members.find((m: any) => m.user.id === actors.editor.id).role).toBe('VIEWER');
  } finally { await c.close(); }
});

for (const width of [1440, 1280, 390, 375]) test(`real Selects fit ${width}px and task status menu stays above Dialog`, async ({ browser }, info) => {
  const c = await contextFor(browser, 'owner', { viewport: { width, height: 1000 }, hasTouch: width < 700, isMobile: width < 700 });
  try {
    const ws = await space(c, 'UX 产品研发团队'); const long = '跨团队需求与产品工程协作空间'.repeat(4); await space(c, long);
    for (const [title, status] of [['整理真实工作内容', 'TODO'], ['完善页面加载反馈', 'IN_PROGRESS'], ['验证工作空间隔离', 'DONE']]) {
      const r = await c.request.post(`/api/workspaces/${ws.id}/tasks`, { headers, data: { title, description: '真实 API 与 PostgreSQL 数据，供界面验收。' } }); expect(r.status()).toBe(201); const task = await r.json();
      if (status !== 'TODO') expect((await c.request.patch(`/api/workspaces/${ws.id}/tasks/${task.id}`, { headers, data: { version: 1, status } })).status()).toBe(200);
    }
    const page = await c.newPage(); await page.goto('/?view=tasks'); await expect(page.getByRole('button', { name: '编辑任务：整理真实工作内容', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width); await page.screenshot({ path: info.outputPath(`ux-${width}.png`) });
    const trigger = page.getByLabel('当前工作空间', { exact: true }); if (width < 700) await trigger.tap(); else await trigger.click();
    const menu = page.getByRole('listbox'); await expect(menu).toBeVisible(); await expect(menu).toHaveCSS('opacity', '1'); const box = await menu.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await expect(page.getByRole('option', { name: long, exact: true })).toHaveAttribute('title', long); await page.screenshot({ path: info.outputPath(`select-${width}.png`) });
    if (width < 700) await page.getByRole('option', { name: long, exact: true }).tap(); else await page.getByRole('option', { name: long, exact: true }).click();
    await expect(trigger).toHaveAttribute('title', long); await expect(menu).toHaveCount(0); await choose(trigger, ws.id);
    await page.getByRole('button', { name: '编辑任务：整理真实工作内容', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '编辑任务', exact: true });
    const state = dialog.getByRole('combobox', { name: '任务状态', exact: true }); await state.click(); await expect(page.getByRole('option', { name: '已完成', exact: true })).toBeVisible(); await expect(page.getByRole('listbox')).toHaveCSS('opacity', '1'); await page.screenshot({ path: info.outputPath(`dialog-select-${width}.png`) });
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible(); await expect(state).toBeFocused(); await choose(state, 'DONE');
    await dialog.getByRole('button', { name: '保存任务', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(page.getByRole('region', { name: '已完成任务', exact: true }).getByText('整理真实工作内容', { exact: true })).toBeVisible();
  } finally { await c.close(); }
});

for (const action of ['logout', '401'] as const) test(`${action} clears protected tasks despite a delayed background response`, async ({ browser }) => {
  const owner = await contextFor(browser), victim = await contextFor(browser, action === 'logout' ? 'session' : 'expired');
  const release = deferred(), entered = deferred(), finished = deferred(); let held = false;
  try {
    const ws = await space(owner); const actor = action === 'logout' ? actors.session : actors.expired;
    expect((await owner.request.post(`/api/workspaces/${ws.id}/members`, { headers, data: { email: actor.email, role: 'EDITOR' } })).status()).toBe(201);
    expect((await owner.request.post(`/api/workspaces/${ws.id}/tasks`, { headers, data: { title: '身份失效后必须清理' } })).status()).toBe(201);
    const page = await victim.newPage(); await page.goto('/?view=tasks'); await expect(page.getByText('身份失效后必须清理', { exact: true })).toBeVisible();
    await page.route(`**/api/workspaces/${ws.id}/tasks`, async route => {
      if (held || route.request().method() !== 'GET') return route.continue(); held = true;
      try { const response = await route.fetch(); entered.resolve(); await release.promise; await route.fulfill({ response }); } finally { finished.resolve(); }
    });
    await page.getByRole('button', { name: '刷新任务', exact: true }).click(); await entered.promise;
    if (action === 'logout') await page.getByRole('button', { name: '退出', exact: true }).click();
    else { await database.session.updateMany({ where: { userId: actor.id }, data: { revokedAt: new Date() } }); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); }
    await expect(page.getByTestId('current-user')).toHaveCount(0); await expect(page.getByText('身份失效后必须清理', { exact: true })).toHaveCount(0);
    release.resolve(); await finished.promise; await expect(page.getByText('身份失效后必须清理', { exact: true })).toHaveCount(0);
  } finally { release.resolve(); if (held) await finished.promise; await victim.close(); await owner.close(); }
});

test('real membership removal during background refresh clears private cards on 404', async ({ browser }) => {
  const owner = await contextFor(browser), editor = await contextFor(browser, 'editor'), release = deferred(), entered = deferred(), finished = deferred(); let held = false;
  try {
    const ws = await space(owner); expect((await owner.request.post(`/api/workspaces/${ws.id}/members`, { headers, data: { email: actors.editor.email, role: 'EDITOR' } })).status()).toBe(201);
    expect((await owner.request.post(`/api/workspaces/${ws.id}/tasks`, { headers, data: { title: '撤权后的私有卡片' } })).status()).toBe(201);
    const page = await editor.newPage(); await page.goto('/?view=tasks'); await expect(page.getByText('撤权后的私有卡片', { exact: true })).toBeVisible();
    await page.route(`**/api/workspaces/${ws.id}/tasks`, async route => {
      if (held || route.request().method() !== 'GET') return route.continue(); held = true;
      try { entered.resolve(); await release.promise; const response = await route.fetch(); expect(response.status()).toBe(404); await route.fulfill({ response }); } finally { finished.resolve(); }
    });
    await page.getByRole('button', { name: '刷新任务', exact: true }).click(); await entered.promise;
    expect((await owner.request.delete(`/api/workspaces/${ws.id}/members/${actors.editor.id}`, { headers, data: {} })).status()).toBe(204);
    release.resolve(); await finished.promise; await expect(page.getByText('撤权后的私有卡片', { exact: true })).toHaveCount(0); await expect(page.getByTestId('task-workspace-role')).toHaveCount(0); await expect(page.getByRole('alert')).toBeVisible();
  } finally { release.resolve(); if (held) await finished.promise; await editor.close(); await owner.close(); }
});

test('late background task response cannot overwrite a newly selected workspace', async ({ browser }) => {
  const c = await contextFor(browser), release = deferred(), entered = deferred(), finished = deferred(); let held = false;
  try {
    const a = await space(c, '空间甲'), b = await space(c, '空间乙');
    for (const [id, title] of [[a.id, '甲空间任务'], [b.id, '乙空间任务']]) expect((await c.request.post(`/api/workspaces/${id}/tasks`, { headers, data: { title } })).status()).toBe(201);
    const page = await c.newPage(); await page.goto('/?view=tasks'); await expect(page.getByText('甲空间任务', { exact: true })).toBeVisible();
    await page.route(`**/api/workspaces/${a.id}/tasks`, async route => {
      if (held || route.request().method() !== 'GET') return route.continue(); held = true;
      try { const response = await route.fetch(); entered.resolve(); await release.promise; await route.fulfill({ response }); } finally { finished.resolve(); }
    });
    await page.getByRole('button', { name: '刷新任务', exact: true }).click(); await entered.promise;
    await choose(page.getByLabel('当前工作空间', { exact: true }), b.id); await expect(page.getByText('甲空间任务', { exact: true })).toHaveCount(0); await expect(page.getByText('乙空间任务', { exact: true })).toBeVisible();
    release.resolve(); await finished.promise; await expect(page.getByText('甲空间任务', { exact: true })).toHaveCount(0); await expect(page.getByLabel('当前工作空间', { exact: true })).toContainText('空间乙');
  } finally { release.resolve(); if (held) await finished.promise; await c.close(); }
});

test('repeated refresh ignores the earlier real snapshot arriving last', async ({ browser }) => {
  const c = await contextFor(browser), release = deferred(), entered = deferred(), finished = deferred(); let held = false;
  try {
    const ws = await space(c), r = await c.request.post(`/api/workspaces/${ws.id}/tasks`, { headers, data: { title: '较早的真实版本' } }); expect(r.status()).toBe(201); const task = await r.json();
    const page = await c.newPage(); await page.goto('/?view=tasks'); await expect(page.getByText(task.title, { exact: true })).toBeVisible();
    await page.route(`**/api/workspaces/${ws.id}/tasks`, async route => {
      if (held || route.request().method() !== 'GET') return route.continue(); held = true;
      try { const response = await route.fetch(); entered.resolve(); await release.promise; await route.fulfill({ response }); } finally { finished.resolve(); }
    });
    await page.getByRole('button', { name: '刷新任务', exact: true }).click(); await entered.promise;
    expect((await c.request.patch(`/api/workspaces/${ws.id}/tasks/${task.id}`, { headers, data: { version: 1, title: '最新的真实版本' } })).status()).toBe(200);
    await page.getByRole('button', { name: '刷新任务', exact: true }).click(); await expect(page.getByText('最新的真实版本', { exact: true })).toBeVisible();
    release.resolve(); await finished.promise; await expect(page.getByText(task.title, { exact: true })).toHaveCount(0); await expect(page.getByText('最新的真实版本', { exact: true })).toBeVisible();
  } finally { release.resolve(); if (held) await finished.promise; await c.close(); }
});

for (const width of [1440, 390]) for (const reducedMotion of ['no-preference', 'reduce'] as const) test(`route recording ${width}px ${reducedMotion}`, async ({ browser }, info) => {
  const c = await contextFor(browser, 'owner', { viewport: { width, height: 1000 }, reducedMotion, recordVideo: { dir: info.outputPath('raw-video'), size: { width, height: 1000 } } });
  let page: Awaited<ReturnType<typeof c.newPage>> | undefined;
  try {
    const ws = await space(c, '产品与工程协作'); expect((await c.request.post(`/api/workspaces/${ws.id}/tasks`, { headers, data: { title: '让真实工作保持连贯', description: '路由、选择和刷新都连接真实工作空间。' } })).status()).toBe(201);
    page = await c.newPage(); await page.goto('/?view=tasks'); await expect(page.getByText('让真实工作保持连贯', { exact: true })).toBeVisible();
    for (const [label, target] of [['工作空间', 'workspace'], ['开发任务', 'tasks'], ['用户流程', 'workflow'], ['开发任务', 'tasks']]) {
      if (width < 901) await page.getByRole('button', { name: '打开导航', exact: true }).click();
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.locator('.route-surface')).toHaveAttribute('data-route', target!); await expect(page.locator('.route-surface')).toHaveCSS('opacity', '1');
      // 仅为录屏阅读保留镜头；业务成功使用上面的真实断言判定。
      await page.waitForTimeout(500);
    }
    await page.getByLabel('当前工作空间', { exact: true }).click(); await expect(page.getByRole('listbox')).toBeVisible(); await page.waitForTimeout(500); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '编辑任务：让真实工作保持连贯', exact: true }).click(); await expect(page.getByRole('dialog', { name: '编辑任务', exact: true })).toBeVisible(); await page.waitForTimeout(500); await page.keyboard.press('Escape');
  } finally { const video = page?.video(); await c.close(); if (video) await video.saveAs(info.outputPath(`route-${width}-${reducedMotion}.webm`)); }
});

test('task success Toast begins after a slow confirmed followup GET completes', async ({ browser }) => {
  const c = await contextFor(browser), release = deferred(), entered = deferred(), finished = deferred(); let held = false, posted = false;
  try {
    const ws = await space(c), page = await c.newPage(); await page.goto('/?view=tasks'); await page.getByRole('button', { name: '新建任务', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '创建任务', exact: true }); await dialog.getByLabel('任务标题', { exact: true }).fill('慢读取之后仍能看到成功反馈');
    await page.route(`**/api/workspaces/${ws.id}/tasks`, async route => {
      if (route.request().method() === 'POST') { const response = await route.fetch(); expect(response.status()).toBe(201); posted = true; await route.fulfill({ response }); }
      else if (posted && !held) { held = true; try { const response = await route.fetch(); expect(response.status()).toBe(200); entered.resolve(); await release.promise; await route.fulfill({ response }); } finally { finished.resolve(); } }
      else await route.continue();
    });
    await dialog.getByRole('button', { name: '创建任务', exact: true }).click(); await entered.promise; await page.waitForTimeout(4500); // 真实 GET 延迟超过 Toast 的 4000ms 生命周期，是此场景的验收输入。
    release.resolve(); await finished.promise; await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: '任务已创建' })).toHaveCSS('opacity', '1');
    await expect(page.getByRole('button', { name: '编辑任务：慢读取之后仍能看到成功反馈', exact: true })).toBeVisible();
  } finally { release.resolve(); if (held) await finished.promise; await c.close(); }
});
