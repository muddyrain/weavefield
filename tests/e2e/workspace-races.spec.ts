import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const apiRequire = createRequire(path.resolve('apps/api/package.json'));
const localRequire = createRequire(path.resolve('package.json'));
const run = `ui202-race-${randomUUID()}`;
const email = `${run}@example.invalid`, password = 'UI202 race local test password 42!';
const headers = { Origin: 'http://127.0.0.1:15173', 'X-Weavefield-Request': '1' };
let prisma: any, app: any, authBase: string;
test.use({ trace: 'off', video: 'on' });

async function startApi() {
  apiRequire('reflect-metadata'); process.env.WEB_ORIGIN = headers.Origin;
  app = await apiRequire('./dist/application').createApplication(); await app.listen(0, '127.0.0.1'); authBase = await app.getUrl();
}
test.beforeAll(async ({ browser }) => {
  prisma = await localRequire('./tests/helpers/database.cjs').prepareDatabase(); await startApi();
  const context = await browser.newContext();
  try { expect((await context.request.post(`${authBase}/auth/register`, { headers, data: { email, password, displayName: '并发验收账号' } })).status()).toBe(201); }
  finally { await context.close(); }
});
test.beforeEach(async () => { await app.close(); await startApi(); });
test.afterEach(async () => { await prisma.workspace.deleteMany({ where: { slug: { startsWith: run } } }); });
test.afterAll(async () => {
  try { if (prisma) await prisma.user.deleteMany({ where: { email } }); }
  finally { if (app) await app.close(); if (prisma) await prisma.$disconnect(); }
});

async function login(context: BrowserContext) {
  expect((await context.request.post(`${authBase}/auth/login`, { headers, data: { email, password } })).status()).toBe(200);
}
async function space(context: BrowserContext, name = '并发基线空间') {
  const response = await context.request.post('/api/workspaces', { headers, data: { name, slug: `${run}-${randomUUID().slice(0, 8)}` } });
  expect(response.status()).toBe(201); return response.json();
}
function latch() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
// 只延迟真实写请求/响应；鉴权、事务和数据库结果均由实际 API 产生。
async function holdWrite(page: Page, routePath: string, method: string, afterCommit = false) {
  const reached = latch(), gate = latch(), finished = latch(); let status = 0, writes = 0;
  await page.route(`**/api${routePath}`, async route => {
    if (route.request().method() !== method) { await route.continue(); return; }
    writes++;
    try {
      let response = afterCommit ? await route.fetch() : undefined;
      reached.release(); await gate.promise;
      response ??= await route.fetch(); status = response.status();
      await route.fulfill({ response });
    } finally { finished.release(); }
  });
  return { reached: reached.promise, release: gate.release, finished: finished.promise, result: () => ({ status, writes }) };
}
async function autoRefresh(page: Page, trigger: 'focus' | 'visibilitychange' | 'interval') {
  if (trigger === 'interval') await page.clock.runFor(60000);
  else if (trigger === 'focus') await refocus(page);
  else await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}
async function refocus(page: Page) {
  await page.evaluate(async () => {
    window.dispatchEvent(new Event('focus'));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

test('workspace POST keeps committed success when focus refresh races with the write', async ({ page }, info) => {
  await login(page.context()); await space(page.context()); await page.goto('/?view=workspace');
  const region = page.getByRole('region', { name: '我的工作空间', exact: true });
  await expect(region.getByTestId('workspace-role')).toHaveText('OWNER');
  const held = await holdWrite(page, '/workspaces', 'POST');
  await region.getByRole('button', { name: '新建空间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '创建工作空间', exact: true });
  await dialog.getByLabel('新空间名称', { exact: true }).fill('焦点切换期间创建的空间');
  await dialog.getByLabel('空间标识', { exact: true }).fill(`${run}-created`);
  try {
    await dialog.getByRole('button', { name: '创建工作空间', exact: true }).click(); await held.reached;
    await refocus(page); held.release(); await held.finished;
    const list = await (await page.context().request.get('/api/workspaces')).json();
    expect(list.filter((item: any) => item.name === '焦点切换期间创建的空间')).toHaveLength(1);
    expect(held.result()).toEqual({ status: 201, writes: 1 });
    await expect(dialog).toHaveCount(0);
    await expect(region.getByRole('heading', { name: '焦点切换期间创建的空间', exact: true })).toBeVisible();
    await expect(region.getByRole('status').filter({ hasText: '工作空间已更新' })).toBeVisible();
  } finally {
    held.release(); await held.finished;
    await page.screenshot({ path: info.outputPath('workspace-post-focus.png') });
    console.log('[workspace-race]', JSON.stringify({ scenario: 'workspace-post-focus', ...held.result(), dialogStillOpen: await dialog.count(), visibleStatus: await region.getByRole('status').allTextContents() }));
  }
});

test('workspace PATCH keeps success feedback when focus arrives after server commit', async ({ page }, info) => {
  await login(page.context()); const item = await space(page.context()); await page.goto('/?view=workspace');
  const region = page.getByRole('region', { name: '我的工作空间', exact: true });
  await region.getByRole('tab', { name: '设置', exact: true }).click();
  const held = await holdWrite(page, `/workspaces/${item.id}`, 'PATCH', true);
  try {
    await region.getByLabel('空间名称', { exact: true }).fill('实际已改名空间');
    await region.getByRole('button', { name: '保存空间名称', exact: true }).click(); await held.reached;
    expect((await (await page.context().request.get(`/api/workspaces/${item.id}`)).json()).name).toBe('实际已改名空间');
    await refocus(page); held.release(); await held.finished;
    await expect(region.getByRole('status').filter({ hasText: '工作空间已更新' })).toBeVisible();
    await expect(region.getByRole('heading', { name: '实际已改名空间', exact: true })).toBeVisible();
    await expect(region.getByRole('button', { name: '保存空间名称', exact: true })).toBeEnabled();
  } finally {
    held.release(); await held.finished;
    await page.screenshot({ path: info.outputPath('workspace-patch-focus.png') });
    console.log('[workspace-race]', JSON.stringify({ scenario: 'workspace-patch-focus', ...held.result(), visibleStatus: await region.getByRole('status').allTextContents() }));
  }
});

for (const trigger of ['focus', 'visibilitychange', 'interval'] as const) test(`parent ${trigger} refresh preserves pending document POST and resumes afterwards`, async ({ page }, info) => {
  if (trigger === 'interval') await page.clock.install();
  await login(page.context()); const item = await space(page.context()); await page.goto('/?view=workspace');
  const region = page.getByRole('region', { name: '我的工作空间', exact: true });
  const docs = region.getByRole('region', { name: '空间文档', exact: true });
  const held = await holdWrite(page, `/workspaces/${item.id}/documents`, 'POST');
  let savedBeforeNextRefresh = false;
  await docs.getByRole('button', { name: '新建文档', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '创建文档', exact: true });
  await dialog.getByLabel('新文档标题', { exact: true }).fill('焦点切换期间创建的文档');
  try {
    await dialog.getByRole('button', { name: '创建文档', exact: true }).click(); await held.reached;
    await autoRefresh(page, trigger);
    await expect.soft(dialog, '父级自动刷新不能卸载正在提交的文档表单').toBeVisible();
    held.release(); await held.finished;
    expect((await (await page.context().request.get(`/api/workspaces/${item.id}/documents`)).json()).length).toBe(1);
    expect(held.result()).toEqual({ status: 201, writes: 1 });
    await expect(dialog).toHaveCount(0);
    await expect(docs.getByRole('status')).toContainText('文档已保存');
    await expect(docs.getByRole('region', { name: '文档元数据', exact: true }).getByRole('heading')).toHaveText('焦点切换期间创建的文档');
    savedBeforeNextRefresh = true;
    await page.screenshot({ path: info.outputPath(`document-post-${trigger}-saved.png`) });
    const resumed = page.waitForResponse(response => response.url().endsWith('/api/workspaces') && response.request().method() === 'GET');
    await autoRefresh(page, trigger); expect((await resumed).status()).toBe(200);
    await expect(region.getByTestId('workspace-role')).toHaveText('OWNER');
    await expect(docs.getByRole('button', { name: '焦点切换期间创建的文档', exact: true })).toBeVisible();
  } finally {
    held.release(); await held.finished;
    await page.screenshot({ path: info.outputPath('document-post-focus.png') });
    console.log('[workspace-race]', JSON.stringify({ scenario: `document-post-${trigger}`, ...held.result(), savedBeforeNextRefresh, visibleStatus: await docs.getByRole('status').allTextContents() }));
  }
});

test('focus Session revalidation still clears a pending document after real revocation', async ({ page }) => {
  await login(page.context()); const item = await space(page.context()); await page.goto('/?view=workspace');
  const region = page.getByRole('region', { name: '我的工作空间', exact: true });
  const docs = region.getByRole('region', { name: '空间文档', exact: true });
  const held = await holdWrite(page, `/workspaces/${item.id}/documents`, 'POST', true);
  try {
    await docs.getByRole('button', { name: '新建文档', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '创建文档', exact: true });
    await dialog.getByLabel('新文档标题', { exact: true }).fill('撤销会话前实际已提交的文档');
    await dialog.getByRole('button', { name: '创建文档', exact: true }).click(); await held.reached;
    expect((await (await page.context().request.get(`/api/workspaces/${item.id}/documents`)).json()).length).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect((await prisma.session.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } })).count).toBeGreaterThan(0);
    const expired = page.waitForResponse(response => response.url().endsWith('/api/auth/me') && response.status() === 401);
    await refocus(page); await expired;
    await expect(page.getByTestId('current-user')).toHaveCount(0);
    await expect(region).toHaveCount(0); await expect(dialog).toHaveCount(0);
    held.release(); await held.finished; expect(held.result()).toEqual({ status: 201, writes: 1 });
    expect((await page.context().request.get('/api/workspaces')).status()).toBe(401);
    await expect(page.getByTestId('workspace-member')).toHaveCount(0);
    await expect(page.getByTestId('current-user')).toHaveCount(0);
  } finally { held.release(); await held.finished; }
});

test('focus during workspace POST preserves committed state if its follow-up read fails', async ({ page }) => {
  await login(page.context()); await space(page.context()); await page.goto('/?view=workspace');
  const region = page.getByRole('region', { name: '我的工作空间', exact: true });
  await expect(region.getByTestId('workspace-role')).toHaveText('OWNER');
  const held = await holdWrite(page, '/workspaces', 'POST', true);
  await region.getByRole('button', { name: '新建空间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '创建工作空间', exact: true });
  await dialog.getByLabel('新空间名称', { exact: true }).fill('提交成功但读取失败空间');
  await dialog.getByLabel('空间标识', { exact: true }).fill(`${run}-refresh-failed`);
  try {
    await dialog.getByRole('button', { name: '创建工作空间', exact: true }).click(); await held.reached;
    await refocus(page);
    // 后注册的故障路由只影响下一次真实写入之后的 GET，不模拟 POST 或授权。
    let failed = false;
    await page.route('**/api/workspaces', async route => {
      if (route.request().method() === 'GET' && !failed) { failed = true; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '验收故障：提交后列表暂不可用' }) }); }
      else await route.fallback();
    });
    held.release(); await held.finished;
    await expect(dialog.getByRole('alert')).toHaveText('验收故障：提交后列表暂不可用');
    await expect(dialog.getByRole('button', { name: '创建工作空间', exact: true })).toBeDisabled();
    await expect(page.locator('.workspace-page [role=status]').filter({ hasText: '操作已由服务端完成' })).toBeVisible();
    const list = await (await page.context().request.get('/api/workspaces')).json();
    expect(list.filter((item: any) => item.name === '提交成功但读取失败空间')).toHaveLength(1);
    await dialog.getByRole('button', { name: '返回空间并刷新', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(region.getByLabel('当前工作空间', { exact: true })).toBeEnabled();
    const committed = list.find((item: any) => item.name === '提交成功但读取失败空间');
    await region.getByLabel('当前工作空间', { exact: true }).selectOption(committed.id);
    await expect(region.getByRole('heading', { name: '提交成功但读取失败空间', exact: true })).toBeVisible();
    expect(held.result()).toEqual({ status: 201, writes: 1 });
  } finally { held.release(); await held.finished; }
});

for (const target of ['workspace', 'document'] as const) test(`${target} write stays protected until its follow-up GET completes`, async ({ page }) => {
  await login(page.context()); const item = await space(page.context()); await page.goto('/?view=workspace');
  const region = page.getByRole('region', { name: '我的工作空间', exact: true });
  const docs = region.getByRole('region', { name: '空间文档', exact: true });
  await expect(region.getByTestId('workspace-role')).toHaveText('OWNER');
  const path = target === 'workspace' ? '/workspaces' : `/workspaces/${item.id}/documents`;
  const reached = latch(), gate = latch(), finished = latch(); let reads = 0;
  await page.route(`**/api${path}`, async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    reads++;
    try { const response = await route.fetch(); expect(response.status()).toBe(200); reached.release(); await gate.promise; await route.fulfill({ response }); }
    finally { finished.release(); }
  });
  let postStatus = 0;
  page.on('response', response => { if (response.url().endsWith(`/api${path}`) && response.request().method() === 'POST') postStatus = response.status(); });
  const title = `等待刷新完成的${target === 'workspace' ? '空间' : '文档'}`;
  const dialog = page.getByRole('dialog', { name: target === 'workspace' ? '创建工作空间' : '创建文档', exact: true });
  try {
    if (target === 'workspace') {
      await region.getByRole('button', { name: '新建空间', exact: true }).click();
      await dialog.getByLabel('新空间名称', { exact: true }).fill(title);
      await dialog.getByLabel('空间标识', { exact: true }).fill(`${run}-follow-up`);
    } else {
      await docs.getByRole('button', { name: '新建文档', exact: true }).click();
      await dialog.getByLabel('新文档标题', { exact: true }).fill(title);
    }
    const submit = dialog.locator('form').getByRole('button');
    await submit.click(); await reached.promise;
    expect(postStatus).toBe(201); await refocus(page);
    await expect(dialog).toBeVisible(); await expect(submit).toBeDisabled();
    gate.release(); await finished.promise;
    await expect(dialog).toHaveCount(0); expect(reads).toBe(1);
    if (target === 'workspace') await expect(region.getByRole('heading', { name: title, exact: true })).toBeVisible();
    else await expect(docs.getByRole('region', { name: '文档元数据', exact: true }).getByRole('heading')).toHaveText(title);
  } finally { gate.release(); if (reads) await finished.promise; }
});

async function prepareRename(page: Page) {
  await login(page.context());
  const original = await space(page.context(), '手动入口原空间'), next = await space(page.context(), '手动入口目标空间');
  const created = await page.context().request.post(`/api/workspaces/${original.id}/documents`, { headers, data: { title: '手动入口原文档' } });
  expect(created.status()).toBe(201); const document = await created.json();
  await page.goto('/?view=workspace');
  const region = page.getByRole('region', { name: '我的工作空间', exact: true });
  await expect(region.getByTestId('workspace-role')).toHaveText('OWNER');
  await region.getByLabel('当前工作空间', { exact: true }).selectOption(original.id);
  const docs = region.getByRole('region', { name: '空间文档', exact: true });
  await docs.getByRole('button', { name: document.title, exact: true }).click();
  const detail = docs.getByRole('region', { name: '文档元数据', exact: true });
  await expect(detail.getByRole('heading')).toHaveText(document.title);
  await detail.getByLabel('文档标题', { exact: true }).fill('手动入口提交后标题');
  return { original, next, document, region, docs, detail };
}
async function holdRename(page: Page, workspaceId: string, documentId: string, phase: 'write' | 'follow-up', failGet = false) {
  const reached = latch(), gate = latch(), finished = latch(); let writes = 0, status = 0;
  const root = `/api/workspaces/${workspaceId}/documents`;
  await page.route(`**${root}/${documentId}`, async route => {
    writes++; const response = await route.fetch(); status = response.status();
    if (phase === 'write') { reached.release(); await gate.promise; }
    try { await route.fulfill({ response }); } finally { if (phase === 'write') finished.release(); }
  }, { times: 1 });
  if (phase === 'follow-up') await page.route(`**${root}`, async route => {
    const response = await route.fetch(); expect(response.status()).toBe(200); reached.release(); await gate.promise;
    try {
      if (failGet) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '验收故障：文档提交后读取失败' }) });
      else await route.fulfill({ response });
    } finally { finished.release(); }
  }, { times: 1 });
  return { reached: reached.promise, release: gate.release, finished: finished.promise, result: () => ({ writes, status }) };
}

for (const action of ['refresh', 'switch'] as const) for (const phase of ['write', 'follow-up'] as const) {
  test(`manual review ${action} cannot discard rename during ${phase}`, async ({ page }, info) => {
    const { original, next, document, region, docs, detail } = await prepareRename(page);
    const held = await holdRename(page, original.id, document.id, phase);
    const refresh = region.getByRole('button', { name: '刷新工作空间', exact: true }), selector = region.getByLabel('当前工作空间', { exact: true });
    let blocked = false;
    try {
      await detail.getByRole('button', { name: '保存文档标题', exact: true }).click(); await held.reached;
      if (action === 'refresh') { blocked = await refresh.isDisabled(); if (!blocked) await refresh.click(); }
      else {
        blocked = await selector.isDisabled();
        if (!blocked) await selector.selectOption(next.id);
        else {
          // 重放排队的 change，验证 ref 在任何选择/缓存修改前拒绝切换。
          await selector.evaluate((node, id) => { const select = node as HTMLSelectElement; select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); }, next.id);
          await expect(region.getByRole('heading', { name: original.name, exact: true })).toBeVisible();
          expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('weavefield.workspace.')).map(key => localStorage.getItem(key)))).toEqual([original.id]);
        }
      }
      expect.soft(blocked, '父级手动入口在文档写入及其后续读取期间必须禁用').toBe(true);
      held.release(); await held.finished;
      expect(held.result()).toEqual({ writes: 1, status: 200 });
      const actual = await (await page.context().request.get(`/api/workspaces/${original.id}/documents`)).json();
      expect(actual).toHaveLength(1); expect(actual[0].title).toBe('手动入口提交后标题');
      await expect(docs.getByRole('status').filter({ hasText: '文档已保存' })).toBeVisible();
      await expect(detail.getByRole('heading')).toHaveText('手动入口提交后标题');
      await page.screenshot({ path: info.outputPath(`${action}-${phase}-saved.png`) });
      await expect(refresh).toBeEnabled(); await expect(selector).toBeEnabled();
      await refresh.click(); await expect(docs.getByRole('button', { name: '手动入口提交后标题', exact: true })).toBeVisible();
      await selector.selectOption(next.id); await expect(region.getByRole('heading', { name: next.name, exact: true })).toBeVisible();
    } finally {
      held.release(); await held.finished;
      await page.screenshot({ path: info.outputPath(`${action}-${phase}-final.png`) });
      console.log('[manual-race]', JSON.stringify({ action, phase, blocked, ...held.result() }));
    }
  });
}

test('manual review parent write controls cannot reload a pending rename', async ({ page }) => {
  const { original, document, region, docs, detail } = await prepareRename(page);
  const held = await holdRename(page, original.id, document.id, 'write'); let parentWrites = 0, documentWrites = 0;
  page.on('request', request => {
    if (request.method() === 'PATCH' && request.url().endsWith(`/api/workspaces/${original.id}`)) parentWrites++;
    if (request.method() === 'PATCH' && request.url().endsWith(`/api/workspaces/${original.id}/documents/${document.id}`)) documentWrites++;
  });
  try {
    await detail.getByRole('button', { name: '保存文档标题', exact: true }).click(); await held.reached;
    await docs.getByRole('form', { name: '重命名文档', exact: true }).evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(documentWrites).toBe(1);
    await region.getByRole('tab', { name: '成员', exact: true }).click();
    expect.soft(await region.getByRole('button', { name: '新建空间', exact: true }).isDisabled()).toBe(true);
    for (const button of await region.getByRole('button').filter({ hasText: /更新角色|移除|添加成员/ }).all()) expect.soft(await button.isDisabled()).toBe(true);
    await region.getByRole('tab', { name: '设置', exact: true }).click();
    const save = region.getByRole('button', { name: '保存空间名称', exact: true });
    expect.soft(await save.isDisabled()).toBe(true);
    // 重放已排队的 submit：即使绕开禁用展示，也不能进入真实父级写 API。
    await region.locator('.workspace-settings-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect.soft(parentWrites).toBe(0);
    held.release(); await held.finished;
    await region.getByRole('tab', { name: '文档', exact: true }).click();
    await expect(docs.getByRole('status').filter({ hasText: '文档已保存' })).toBeVisible(); expect(documentWrites).toBe(1);
    expect((await (await page.context().request.get(`/api/workspaces/${original.id}`)).json()).name).toBe(original.name);
    await region.getByRole('tab', { name: '设置', exact: true }).click();
    await expect(save).toBeEnabled(); await region.getByLabel('空间名称', { exact: true }).fill('文档完成后可保存的空间名称'); await save.click();
    await expect(region.getByRole('heading', { name: '文档完成后可保存的空间名称', exact: true })).toBeVisible(); expect(parentWrites).toBe(1);
  } finally { held.release(); await held.finished; }
});

test('manual review reverse order blocks document writes while parent rename is pending', async ({ page }) => {
  const { original, document, region, docs } = await prepareRename(page);
  await region.getByRole('tab', { name: '设置', exact: true }).click();
  const held = await holdWrite(page, `/workspaces/${original.id}`, 'PATCH', true); let documentWrites = 0;
  page.on('request', request => { if (request.method() === 'PATCH' && request.url().endsWith(`/api/workspaces/${original.id}/documents/${document.id}`)) documentWrites++; });
  try {
    await region.getByLabel('空间名称', { exact: true }).fill('父级保存后的空间');
    await region.getByRole('button', { name: '保存空间名称', exact: true }).click(); await held.reached;
    await region.getByRole('tab', { name: '文档', exact: true }).click();
    expect.soft(await docs.getByRole('button', { name: '保存文档标题', exact: true }).isDisabled()).toBe(true);
    await docs.getByRole('form', { name: '重命名文档', exact: true }).evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect.soft(documentWrites).toBe(0);
    held.release(); await held.finished;
    await expect(region.getByRole('heading', { name: '父级保存后的空间', exact: true })).toBeVisible();
    await docs.getByRole('button', { name: document.title, exact: true }).click();
    await expect(docs.getByRole('button', { name: '保存文档标题', exact: true })).toBeEnabled();
    await docs.getByLabel('文档标题', { exact: true }).fill('父级完成后可保存的文档'); await docs.getByRole('button', { name: '保存文档标题', exact: true }).click();
    await expect(docs.getByRole('region', { name: '文档元数据', exact: true }).getByRole('heading')).toHaveText('父级完成后可保存的文档'); expect(documentWrites).toBe(1);
  } finally { held.release(); await held.finished; }
});

test('manual review logout remains available during an inline pending rename', async ({ page }) => {
  const { original, document, region, detail } = await prepareRename(page);
  const held = await holdRename(page, original.id, document.id, 'write');
  try {
    await detail.getByRole('button', { name: '保存文档标题', exact: true }).click(); await held.reached;
    await page.getByRole('button', { name: '退出', exact: true }).click();
    await expect(page.getByTestId('current-user')).toHaveCount(0); await expect(region).toHaveCount(0);
    held.release(); await held.finished; expect(held.result()).toEqual({ status: 200, writes: 1 });
    expect((await page.context().request.get('/api/workspaces')).status()).toBe(401);
    await expect(page.getByTestId('workspace-member')).toHaveCount(0); await expect(page.getByRole('region', { name: '文档元数据', exact: true })).toHaveCount(0);
  } finally { held.release(); await held.finished; }
});

test('manual review controls recover after the rename follow-up GET fails', async ({ page }) => {
  const { original, next, document, region, docs, detail } = await prepareRename(page);
  const held = await holdRename(page, original.id, document.id, 'follow-up', true);
  try {
    await detail.getByRole('button', { name: '保存文档标题', exact: true }).click(); await held.reached;
    await expect(region.getByRole('button', { name: '刷新工作空间', exact: true })).toBeDisabled(); await expect(region.getByLabel('当前工作空间', { exact: true })).toBeDisabled();
    held.release(); await held.finished;
    await expect(docs.getByRole('alert')).toHaveText('验收故障：文档提交后读取失败');
    await expect(docs.getByRole('status')).toContainText('操作已由服务端完成');
    await expect(region.getByRole('button', { name: '刷新工作空间', exact: true })).toBeEnabled(); await expect(region.getByLabel('当前工作空间', { exact: true })).toBeEnabled();
    await region.getByRole('button', { name: '刷新工作空间', exact: true }).click(); await expect(docs.getByRole('button', { name: '手动入口提交后标题', exact: true })).toBeVisible();
    await region.getByLabel('当前工作空间', { exact: true }).selectOption(next.id); await expect(region.getByRole('heading', { name: next.name, exact: true })).toBeVisible(); expect(held.result()).toEqual({ status: 200, writes: 1 });
  } finally { held.release(); await held.finished; }
});
