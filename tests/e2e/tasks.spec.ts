import { choose } from '../helpers/select';
import { e2eOrigin } from '../helpers/e2e-address';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
const requireLocal = createRequire(path.resolve('package.json'));
const apiRequire = createRequire(path.resolve('apps/api/package.json'));
const { prepareDatabase } = requireLocal('./tests/helpers/database.cjs');
const run = `uitasks-${randomUUID()}`, password = 'Task browser password 42!';
const headers = { Origin: e2eOrigin, 'X-Weavefield-Request': '1' };
const account = (role: string) => ({ id: '', email: `${run}-${role}@example.invalid`, name: `任务-${role}`, cookie: '' });
const accounts = { owner: account('owner'), editor: account('editor'), viewer: account('viewer'), outsider: account('outsider'), logout: account('logout'), revoked: account('revoked') };
type Actor = keyof typeof accounts;
let prisma: any, authApi: any, authBase: string;
test.use({ trace: 'off', video: 'off' });
test.beforeAll(async ({ browser }) => {
  prisma = await prepareDatabase(); apiRequire('reflect-metadata'); process.env.WEB_ORIGIN = headers.Origin;
  authApi = await apiRequire('./dist/application').createApplication(); await authApi.listen(0, '127.0.0.1'); authBase = await authApi.getUrl();
  for (const a of Object.values(accounts)) {
    const c = await browser.newContext();
    try { const r = await c.request.post(authBase + '/auth/register', { headers, data: { email: a.email, password, displayName: a.name } }); expect(r.status()).toBe(201); a.id = (await r.json()).user.id; const cookie = r.headers()['set-cookie']?.split(';')[0]; if (!cookie) throw new Error('真实注册响应缺少 Session Cookie'); a.cookie = cookie; }
    finally { await c.close(); }
  }
});
test.afterEach(async () => { await prisma.workspace.deleteMany({ where: { slug: { startsWith: run } } }); });
test.afterAll(async () => { try { if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: run } } }); } finally { if (authApi) await authApi.close(); if (prisma) await prisma.$disconnect(); } });
async function contextFor(browser: Browser, actor: Actor = 'owner') {
  const context = await browser.newContext(); const at = accounts[actor].cookie.indexOf('=');
  await context.addCookies([{ name: accounts[actor].cookie.slice(0, at), value: accounts[actor].cookie.slice(at + 1), url: headers.Origin, httpOnly: true, sameSite: 'Lax' }]);
  return context;
}
async function space(context: BrowserContext, name = '产品开发团队') {
  const r = await context.request.post('/api/workspaces', { headers, data: { name, slug: `${run}-${randomUUID().slice(0, 8)}` } }); expect(r.status()).toBe(201); return r.json();
}
async function member(context: BrowserContext, id: string, actor: Actor, role: string) {
  const r = await context.request.post(`/api/workspaces/${id}/members`, { headers, data: { email: accounts[actor].email, role } }); expect(r.status()).toBe(201);
}
async function task(context: BrowserContext, id: string, title = '梳理发布验收清单', status = 'TODO') {
  const r = await context.request.post(`/api/workspaces/${id}/tasks`, { headers, data: { title, description: '整理工作内容，确认验收标准。\n让团队知道下一步做什么。' } }); expect(r.status()).toBe(201); const data = await r.json();
  if (status === 'TODO') return data;
  const update = await context.request.patch(`/api/workspaces/${id}/tasks/${data.id}`, { headers, data: { version: data.version, status } }); expect(update.status()).toBe(200); return update.json();
}
async function open(context: BrowserContext) {
  const page = await context.newPage(); await page.goto('/?view=tasks'); const root = page.getByRole('region', { name: '开发任务', exact: true });
  await expect(root.getByTestId('task-workspace-role')).toBeVisible(); await expect(root.getByText('正在加载任务…', { exact: true })).toHaveCount(0); return { page, root };
}
async function loginUI(page: Page, actor: Actor) {
  await page.getByRole('button', { name: '登录 / 注册', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '登录你的账号', exact: true });
  await dialog.getByLabel('邮箱', { exact: true }).fill(accounts[actor].email); await dialog.getByLabel('密码', { exact: true }).fill(password); await dialog.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByTestId('current-user')).toHaveText(accounts[actor].name);
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

test('real UI login, task creation, editing, persistence and second account read', async ({ browser }, info) => {
  const context = await browser.newContext(); let second: BrowserContext | undefined;
  try {
    const page = await context.newPage(); await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/?view=tasks'); await loginUI(page, 'owner');
    const ws = await space(context); await member(context, ws.id, 'editor', 'EDITOR'); await page.reload();
    const root = page.getByRole('region', { name: '开发任务', exact: true }); await root.getByRole('button', { name: '新建任务', exact: true }).click();
    const create = page.getByRole('dialog', { name: '创建任务', exact: true }); await create.getByLabel('任务标题', { exact: true }).fill('确认真实任务闭环'); await create.getByLabel('任务描述', { exact: true }).fill('从页面创建，保存到 PostgreSQL。');
    await create.getByRole('button', { name: '创建任务', exact: true }).click(); await expect(create).toHaveCount(0); await expect(page.locator('[data-sonner-toast]').filter({ hasText: '任务已创建' })).toBeVisible();
    await root.getByRole('button', { name: '编辑任务：确认真实任务闭环', exact: true }).click(); const edit = page.getByRole('dialog', { name: '编辑任务', exact: true });
    await edit.getByLabel('任务标题', { exact: true }).fill('任务闭环已验收'); await choose(edit.getByLabel('任务状态', { exact: true }), 'IN_PROGRESS'); await edit.getByRole('button', { name: '保存任务', exact: true }).click(); await expect(edit).toHaveCount(0);
    await page.reload(); await expect(root.getByRole('region', { name: '进行中任务', exact: true }).getByText('任务闭环已验收', { exact: true })).toBeVisible();
    await task(context, ws.id); await task(context, ws.id, '完成权限矩阵验证', 'DONE'); await root.getByRole('button', { name: '刷新任务', exact: true }).click(); await expect(root.getByText('完成权限矩阵验证', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('tasks-1440.png') });
    second = await contextFor(browser, 'editor'); const editor = await open(second); await expect(editor.root.getByText('任务闭环已验收', { exact: true })).toBeVisible();
    const stored = await prisma.task.findFirstOrThrow({ where: { workspaceId: ws.id, title: '任务闭环已验收' } }); expect(stored.version).toBe(2); expect(stored.status).toBe('IN_PROGRESS');
  } finally { await second?.close(); await context.close(); }
});
test('VIEWER sees readonly tasks and actual write APIs deny 403', async ({ browser }) => {
  const owner = await contextFor(browser), viewer = await contextFor(browser, 'viewer');
  try { const ws = await space(owner); await member(owner, ws.id, 'viewer', 'VIEWER'); const item = await task(owner, ws.id); const { page, root } = await open(viewer);
    await expect(root.getByText('任务只读：可以查看任务，不能创建或修改。', { exact: true })).toBeVisible(); await expect(root.getByRole('button', { name: '新建任务', exact: true })).toHaveCount(0);
    await root.getByRole('button', { name: `查看任务：${item.title}`, exact: true }).click(); const detail = page.getByRole('dialog', { name: '任务详情', exact: true }); await expect(detail.getByRole('button', { name: '保存任务', exact: true })).toHaveCount(0);
    expect((await viewer.request.post(`/api/workspaces/${ws.id}/tasks`, { headers, data: { title: '拒绝' } })).status()).toBe(403);
    expect((await viewer.request.patch(`/api/workspaces/${ws.id}/tasks/${item.id}`, { headers, data: { version: 1, status: 'DONE' } })).status()).toBe(403);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: item.id } })).version).toBe(1);
  } finally { await viewer.close(); await owner.close(); }
});
test('real version conflict preserves draft and explicitly loads latest before saving', async ({ browser }) => {
  const owner = await contextFor(browser), editor = await contextFor(browser, 'editor');
  try { const ws = await space(owner); await member(owner, ws.id, 'editor', 'EDITOR'); const item = await task(owner, ws.id); const { page, root } = await open(owner);
    await root.getByRole('button', { name: `编辑任务：${item.title}`, exact: true }).click(); const dialog = page.getByRole('dialog', { name: '编辑任务', exact: true }); await dialog.getByLabel('任务标题', { exact: true }).fill('我的未提交草稿');
    expect((await editor.request.patch(`/api/workspaces/${ws.id}/tasks/${item.id}`, { headers, data: { version: 1, title: '另一位成员的版本' } })).status()).toBe(200);
    await dialog.getByRole('button', { name: '保存任务', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('任务已被其他人修改'); await expect(dialog.getByLabel('任务标题', { exact: true })).toHaveValue('我的未提交草稿'); await expect(dialog.getByRole('button', { name: '保存任务', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: '加载最新版本', exact: true }).click(); await expect(dialog.getByLabel('任务标题', { exact: true })).toHaveValue('另一位成员的版本'); await dialog.getByLabel('任务标题', { exact: true }).fill('基于最新版本调整'); await dialog.getByRole('button', { name: '保存任务', exact: true }).click(); await expect(dialog).toHaveCount(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: item.id } })).version).toBe(3);
  } finally { await editor.close(); await owner.close(); }
});
for (const phase of ['PATCH', 'followup-GET'] as const) test(`write protection includes ${phase}, manual controls and focus refresh`, async ({ browser }) => {
  const context = await contextFor(browser), release = deferred();
  try { const ws = await space(context), other = await space(context, '另一个真实空间'); const item = await task(context, ws.id); const { page, root } = await open(context);
    await choose(root.getByLabel('当前工作空间', { exact: true }), ws.id); await expect(root.getByRole('button', { name: `编辑任务：${item.title}`, exact: true })).toBeVisible();
    let writes = 0, reads = 0, written = false, held = false; const entered = deferred();
    await page.route(`**/api/workspaces/${ws.id}/tasks**`, async route => {
      const method = route.request().method(); if (method === 'PATCH') writes++; if (method === 'GET') reads++;
      if (!held && (phase === 'PATCH' && method === 'PATCH' || phase === 'followup-GET' && method === 'GET' && written)) { held = true; const response = await route.fetch(); entered.resolve(); await release.promise; await route.fulfill({ response }); }
      else if (method === 'PATCH') { const response = await route.fetch(); written = true; await route.fulfill({ response }); } else await route.continue();
    });
    await root.getByRole('button', { name: `编辑任务：${item.title}`, exact: true }).click(); const dialog = page.getByRole('dialog', { name: '编辑任务', exact: true }); await dialog.getByLabel('任务标题', { exact: true }).fill('真实保存且反馈保留'); await dialog.getByRole('button', { name: '保存任务', exact: true }).click(); await entered.promise;
    await expect(page.locator('.tasks-page').getByRole('button', { name: '刷新任务', exact: true, includeHidden: true })).toBeDisabled(); await expect(page.locator('.tasks-page').getByLabel('当前工作空间', { exact: true })).toBeDisabled();
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); }); await expect.poll(() => writes).toBe(1); expect(reads).toBe(phase === 'PATCH' ? 0 : 1);
    release.resolve(); await expect(dialog).toHaveCount(0); await expect(page.locator('[data-sonner-toast]').filter({ hasText: '任务已保存' })).toBeVisible(); await expect(root.getByRole('button', { name: '刷新任务', exact: true })).toBeEnabled();
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(page.locator('[data-sonner-toast]').filter({ hasText: '任务已保存' })).toBeVisible(); await expect(root.getByRole('button', { name: '编辑任务：真实保存且反馈保留', exact: true })).toBeVisible();
    await choose(root.getByLabel('当前工作空间', { exact: true }), other.id); await expect(root.getByText('真实保存且反馈保留', { exact: true })).toHaveCount(0); expect(writes).toBe(1);
  } finally { release.resolve(); await context.close(); }
});
test('real committed POST with lost response never retries or claims success', async ({ browser }) => {
  const context = await contextFor(browser);
  try { const ws = await space(context); const { page, root } = await open(context); let posts = 0;
    await page.route(`**/api/workspaces/${ws.id}/tasks`, async route => { if (route.request().method() !== 'POST') return route.continue(); posts++; const actual = await route.fetch(); expect(actual.status()).toBe(201); await route.abort('failed'); });
    await root.getByRole('button', { name: '新建任务', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '创建任务', exact: true }); await dialog.getByLabel('任务标题', { exact: true }).fill('响应丢失但真实提交'); await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('提交结果无法确认'); await expect(dialog.getByRole('button', { name: '创建任务', exact: true })).toBeDisabled(); await expect(page.locator('[data-sonner-toast]').filter({ hasText: '任务已创建' })).toHaveCount(0);
    await dialog.getByRole('button', { name: '返回看板并刷新', exact: true }).click(); await expect(root.getByText('响应丢失但真实提交', { exact: true })).toBeVisible(); expect(posts).toBe(1); expect(await prisma.task.count({ where: { workspaceId: ws.id, title: '响应丢失但真实提交' } })).toBe(1);
  } finally { await context.close(); }
});
test('Session revoke clears protected tasks while task writes are independently guarded', async ({ browser }) => {
  const owner = await contextFor(browser), victim = await contextFor(browser, 'revoked');
  try { const ws = await space(owner); await member(owner, ws.id, 'revoked', 'EDITOR'); await task(owner, ws.id, '撤销后不得显示的任务'); const { page } = await open(victim);
    await prisma.session.updateMany({ where: { userId: accounts.revoked.id }, data: { revokedAt: new Date() } }); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('current-user')).toHaveCount(0); await expect(page.getByText('撤销后不得显示的任务', { exact: true })).toHaveCount(0); expect((await victim.request.get(`/api/workspaces/${ws.id}/tasks`)).status()).toBe(401);
  } finally { await victim.close(); await owner.close(); }
});
test('late task response cannot restore data after logout and another account login', async ({ browser }) => {
  const owner = await contextFor(browser), outsider = await contextFor(browser, 'outsider'), victim = await contextFor(browser, 'logout'), release = deferred();
  try { const ws = await space(owner); await member(owner, ws.id, 'logout', 'EDITOR'); await task(owner, ws.id, '旧账号空间的私有任务'); const other = await space(outsider, '新账号自己的空间'); await task(outsider, other.id, '新账号可见任务'); const { page, root } = await open(victim); const entered = deferred(); let held = false;
    await page.route(`**/api/workspaces/${ws.id}/tasks`, async route => { if (held || route.request().method() !== 'GET') return route.continue(); held = true; const response = await route.fetch(); entered.resolve(); await release.promise; await route.fulfill({ response }); });
    await root.getByRole('button', { name: '刷新任务', exact: true }).click(); await entered.promise; await page.getByRole('button', { name: '退出', exact: true }).click(); await expect(page.getByTestId('current-user')).toHaveCount(0); await loginUI(page, 'outsider');
    await page.getByRole('button', { name: '开发任务', exact: true }).click(); await expect(page.getByText('新账号可见任务', { exact: true })).toBeVisible(); release.resolve(); await expect(page.getByText('旧账号空间的私有任务', { exact: true })).toHaveCount(0);
    expect((await victim.request.get(`/api/workspaces/${ws.id}/tasks`)).status()).toBe(404);
  } finally { release.resolve(); await victim.close(); await outsider.close(); await owner.close(); }
});
for (const width of [1280, 390, 375]) test(`real task board ${width}px layout, keyboard dialog and focus recovery`, async ({ browser }, info) => {
  const context = await contextFor(browser);
  try { const ws = await space(context); await task(context, ws.id, '梳理任务管理验收标准'); await task(context, ws.id, '完善小屏幕操作反馈', 'IN_PROGRESS'); await task(context, ws.id, '服务端权限矩阵已验证', 'DONE'); const { page, root } = await open(context); await page.setViewportSize({ width, height: 1000 });
    await expect(root.getByText('服务端权限矩阵已验证', { exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width); expect(await page.locator('.workspace-body').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`tasks-${width}.png`) }); const trigger = root.getByRole('button', { name: '新建任务', exact: true }); await trigger.focus(); await trigger.press('Enter'); const dialog = page.getByRole('dialog', { name: '创建任务', exact: true }); await expect(dialog).toBeVisible();
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true); }
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  } finally { await context.close(); }
});
test('Reduced Motion and long task content stay scoped and fit 375px', async ({ browser }, info) => {
  const context = await contextFor(browser);
  try { const ws = await space(context); await task(context, ws.id, 'L'.repeat(200)); const { page, root } = await open(context); await page.setViewportSize({ width: 375, height: 1000 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(root.locator('.task-card')).toBeVisible(); expect(await root.locator('.task-card').evaluate(e => getComputedStyle(e).transitionDuration)).toBe('0s'); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375); await page.screenshot({ path: info.outputPath('tasks-375-reduced.png') });
  } finally { await context.close(); }
});

test('real role downgrade returns 403 and restores a readonly board', async ({ browser }) => {
  const owner = await contextFor(browser), editor = await contextFor(browser, 'editor');
  try { const ws = await space(owner); await member(owner, ws.id, 'editor', 'EDITOR'); const item = await task(owner, ws.id); const { page, root } = await open(editor);
    await root.getByRole('button', { name: `编辑任务：${item.title}`, exact: true }).click(); const dialog = page.getByRole('dialog', { name: '编辑任务', exact: true });
    expect((await owner.request.patch(`/api/workspaces/${ws.id}/members/${accounts.editor.id}`, { headers, data: { role: 'VIEWER' } })).status()).toBe(200);
    await dialog.getByLabel('任务标题', { exact: true }).fill('禁止写入'); await dialog.getByRole('button', { name: '保存任务', exact: true }).click(); await expect(dialog).toHaveCount(0);
    await expect(root.getByRole('alert')).toContainText('OWNER 或 EDITOR'); await expect(root.getByTestId('task-workspace-role')).toHaveText('VIEWER'); await expect(root.getByRole('button', { name: '新建任务', exact: true })).toHaveCount(0); expect((await prisma.task.findUniqueOrThrow({ where: { id: item.id } })).version).toBe(1);
  } finally { await editor.close(); await owner.close(); }
});
test('missing task 404 removes stale detail and keeps other authorized tasks', async ({ browser }) => {
  const context = await contextFor(browser);
  try { const ws = await space(context); const item = await task(context, ws.id); await task(context, ws.id, '仍然有权查看的任务'); const { page, root } = await open(context);
    await root.getByRole('button', { name: `编辑任务：${item.title}`, exact: true }).click(); await prisma.task.delete({ where: { id: item.id } }); // 仅隔离数据库夹具模拟资源失效，不提供任务删除功能。
    const dialog = page.getByRole('dialog', { name: '编辑任务', exact: true }); await dialog.getByRole('button', { name: '保存任务', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(root.getByRole('alert')).toContainText('任务不存在或不可访问'); await expect(root.getByText(item.title, { exact: true })).toHaveCount(0); await expect(root.getByText('仍然有权查看的任务', { exact: true })).toBeVisible();
  } finally { await context.close(); }
});
test('committed create followed by real access-loss GET clears protected content', async ({ browser }) => {
  const owner = await contextFor(browser), editor = await contextFor(browser, 'editor');
  try { const ws = await space(owner); await member(owner, ws.id, 'editor', 'EDITOR'); await task(owner, ws.id, '权限失效后必须清理的旧任务'); const { page, root } = await open(editor); let posted = false, revoked = false, posts = 0;
    await page.route(`**/api/workspaces/${ws.id}/tasks`, async route => {
      if (route.request().method() === 'POST') { posts++; const response = await route.fetch(); expect(response.status()).toBe(201); posted = true; await route.fulfill({ response }); }
      else if (posted && !revoked) { revoked = true; expect((await owner.request.delete(`/api/workspaces/${ws.id}/members/${accounts.editor.id}`, { headers, data: {} })).status()).toBe(204); const response = await route.fetch(); expect(response.status()).toBe(404); await route.fulfill({ response }); }
      else await route.continue();
    });
    await root.getByRole('button', { name: '新建任务', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '创建任务', exact: true }); await dialog.getByLabel('任务标题', { exact: true }).fill('真实提交后权限失效'); await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
    await expect(root.getByRole('alert')).toContainText('任务已由服务端保存'); await expect(dialog).toHaveCount(0); await expect(root.getByText('权限失效后必须清理的旧任务', { exact: true })).toHaveCount(0); await expect(root.getByTestId('task-workspace-role')).toHaveCount(0); expect(posts).toBe(1); expect(await prisma.task.count({ where: { workspaceId: ws.id, title: '真实提交后权限失效' } })).toBe(1);
  } finally { await editor.close(); await owner.close(); }
});

test('synchronous duplicate form submission produces one real POST', async ({ browser }) => {
  const context = await contextFor(browser), release = deferred();
  try { const ws = await space(context); const { page, root } = await open(context); let posts = 0; const entered = deferred();
    await page.route(`**/api/workspaces/${ws.id}/tasks`, async route => { if (route.request().method() !== 'POST') return route.continue(); posts++; const response = await route.fetch(); expect(response.status()).toBe(201); entered.resolve(); await release.promise; await route.fulfill({ response }); });
    await root.getByRole('button', { name: '新建任务', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '创建任务', exact: true }); await dialog.getByLabel('任务标题', { exact: true }).fill('同步重复提交只写一次');
    await dialog.getByRole('form', { name: '创建任务', exact: true }).evaluate(form => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit(); }); await entered.promise;
    expect(posts).toBe(1); release.resolve(); await expect(dialog).toHaveCount(0); await expect(root.getByText('同步重复提交只写一次', { exact: true })).toBeVisible(); expect(await prisma.task.count({ where: { workspaceId: ws.id, title: '同步重复提交只写一次' } })).toBe(1);
  } finally { release.resolve(); await context.close(); }
});
test('confirmed create with lost followup GET stays committed and blocks a second submit', async ({ browser }) => {
  const context = await contextFor(browser);
  try { const ws = await space(context); const { page, root } = await open(context); let posted = false, dropped = false, posts = 0;
    await page.route(`**/api/workspaces/${ws.id}/tasks`, async route => {
      if (route.request().method() === 'POST') { posts++; const response = await route.fetch(); expect(response.status()).toBe(201); posted = true; await route.fulfill({ response }); }
      else if (posted && !dropped) { dropped = true; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); } else await route.continue();
    });
    await root.getByRole('button', { name: '新建任务', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '创建任务', exact: true }); await dialog.getByLabel('任务标题', { exact: true }).fill('成功提交后读取断开'); await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('任务已由服务端保存'); await expect(dialog.getByRole('button', { name: '创建任务', exact: true })).toBeDisabled(); await dialog.getByRole('button', { name: '返回看板并刷新', exact: true }).click(); await expect(root.getByText('成功提交后读取断开', { exact: true })).toBeVisible(); expect(posts).toBe(1);
  } finally { await context.close(); }
});
