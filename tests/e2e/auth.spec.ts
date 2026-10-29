import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const localRequire = createRequire(path.resolve('package.json'));
const run = `browser-${randomUUID()}`;
const password = 'Demo123!';
const email = `${run}@example.invalid`;
const { prepareDatabase } = localRequire('./tests/helpers/database.cjs');
let prisma: Awaited<ReturnType<typeof prepareDatabase>>;

test.beforeAll(async () => { prisma = await prepareDatabase(); });
test.afterAll(async () => {
  if (prisma) {
    await prisma.user.deleteMany({ where: { email: { startsWith: run } } });
    await prisma.$disconnect();
  }
});
async function openLogin(page: Page) {
  await page.getByRole('button', { name: '登录 / 注册', exact: true }).click();
  return page.getByRole('dialog');
}

test('real registration, refresh, logout and login preserve only valid session state', async ({ page }, testInfo) => {
  await page.goto('/');
  const dialog = await openLogin(page);
  await dialog.getByRole('button', { name: '还没有账号？注册' }).click();
  await dialog.getByLabel('昵称', { exact: true }).fill('织域开发者');
  await dialog.getByLabel('邮箱', { exact: true }).fill(email);
  await dialog.getByLabel('密码', { exact: true }).fill('short12');
  await dialog.getByRole('button', { name: '注册并登录', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('8–128');
  await dialog.getByLabel('密码', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: '注册并登录', exact: true }).click();
  await expect(page.getByTestId('current-user')).toHaveText('织域开发者');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.auth-notice')).toHaveText('注册成功，已登录');
  const cookies = await page.context().cookies();
  const cookie = cookies.find(item => item.name === 'weavefield_session')!;
  expect(cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('weavefield_session');
  await page.reload();
  await expect(page.getByTestId('current-user')).toHaveText('织域开发者');
  await expect(page.locator('.avatar-stack')).toHaveCount(0);
  await expect(page.getByText('本地演示环境', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('authenticated.png'), fullPage: true });
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page.getByTestId('current-user')).toHaveCount(0);
  await expect(page.locator('.auth-notice')).toHaveText('已退出登录');
  await page.reload();
  await openLogin(page);
  await dialog.getByLabel('邮箱', { exact: true }).fill(email);
  await dialog.getByLabel('密码', { exact: true }).fill('Wrong password 42!');
  await dialog.getByRole('button', { name: '登录', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('邮箱或密码不正确');
  await dialog.getByLabel('密码', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByTestId('current-user')).toHaveText('织域开发者');
  // 不等待固定时长：数据库夹具撤销当前会话，主动重新验证真实 API。
  const user = await prisma.user.findUniqueOrThrow({ where: { emailCanonical: email } });
  await prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(0) } });
  await page.getByRole('button', { name: '织域开发者', exact: true }).click();
  await expect(page.getByTestId('current-user')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登录 / 注册', exact: true })).toBeVisible();
});

test('two browser contexts show their own real users and duplicate email is rejected', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    for (const [index, context] of contexts.entries()) {
      const page = await context.newPage();
      await page.goto('/');
      const dialog = await openLogin(page);
      await dialog.getByRole('button', { name: '还没有账号？注册' }).click();
      await dialog.getByLabel('昵称', { exact: true }).fill(`真实用户 ${index}`);
      await dialog.getByLabel('邮箱', { exact: true }).fill(`${run}-${index}@example.invalid`);
      await dialog.getByLabel('密码', { exact: true }).fill(password);
      await dialog.getByRole('button', { name: '注册并登录', exact: true }).click();
      await expect(page.getByTestId('current-user')).toHaveText(`真实用户 ${index}`);
    }
    const first = contexts[0]!.pages()[0]!;
    const second = contexts[1]!.pages()[0]!;
    await first.reload(); await second.reload();
    await expect(first.getByTestId('current-user')).toHaveText('真实用户 0');
    await expect(second.getByTestId('current-user')).toHaveText('真实用户 1');
    await second.getByRole('button', { name: '退出', exact: true }).click();
    const dialog = await openLogin(second);
    await dialog.getByRole('button', { name: '还没有账号？注册' }).click();
    await dialog.getByLabel('昵称', { exact: true }).fill('重复注册');
    await dialog.getByLabel('邮箱', { exact: true }).fill(`${run}-0@example.invalid`);
    await dialog.getByLabel('密码', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: '注册并登录', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('该邮箱已注册');
    await expect(second.getByTestId('current-user')).toHaveCount(0);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('mobile authentication shows pending and service failure states without claiming login', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const dialog = await openLogin(page);
  await dialog.getByLabel('邮箱', { exact: true }).fill(`${run}-unavailable@example.invalid`);
  await dialog.getByLabel('密码', { exact: true }).fill(password);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/auth/login', async route => {
    await gate;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '认证服务暂时不可用，请稍后重试' }) });
  });
  try {
    await dialog.getByRole('button', { name: '登录', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '正在验证…' })).toBeDisabled();
  } finally { release(); }
  await expect(dialog.getByRole('alert')).toHaveText('认证服务暂时不可用，请稍后重试');
  await expect(page.getByTestId('current-user')).toHaveCount(0);
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('auth-mobile.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('a lost logout response rechecks the server and does not keep a revoked identity visible', async ({ page }) => {
  await page.goto('/');
  const dialog = await openLogin(page);
  await dialog.getByRole('button', { name: '还没有账号？注册' }).click();
  await dialog.getByLabel('昵称', { exact: true }).fill('退出验证用户');
  await dialog.getByLabel('邮箱', { exact: true }).fill(`${run}-logout-response@example.invalid`);
  await dialog.getByLabel('密码', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: '注册并登录', exact: true }).click();
  await expect(page.getByTestId('current-user')).toHaveText('退出验证用户');
  await page.route('**/api/auth/logout', async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(204);
    await route.abort('failed');
  });
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page.getByTestId('current-user')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登录 / 注册', exact: true })).toBeVisible();
  await expect(page.locator('.auth-notice')).toContainText('退出响应异常');
});

for (const width of [390, 375]) {
  test(`authenticated mobile navigation stays usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const displayName = '移动端真实用户' + '长昵称'.repeat(10);
    const registration = await page.request.post('/api/auth/register', {
      headers: { Origin: 'http://127.0.0.1:15173', 'X-Weavefield-Request': '1' },
      data: { email: `${run}-mobile-${width}@example.invalid`, password, displayName },
    });
    expect(registration.status()).toBe(201);
    const { user } = await registration.json();
    await page.goto(`/?doc=mobile-auth-${width}`);
    await expect(page.getByTestId('current-user')).toHaveText(displayName);
    await page.evaluate(() => document.fonts.ready);
    const account = page.getByRole('button', { name: displayName, exact: true });
    const logout = page.getByRole('button', { name: '退出', exact: true });
    const copy = page.getByRole('button', { name: '复制本地演示链接', exact: true });
    const measurements: unknown[] = [];
    async function checkNavigation(state: string) {
      const metrics = await page.evaluate(() => ({
        width: innerWidth, documentWidth: document.documentElement.scrollWidth,
        controls: Array.from(document.querySelectorAll('.topbar .icon-button, .auth-control > button, .share-btn')).map(button => {
          const box = button.getBoundingClientRect();
          return { left: box.left, right: box.right, width: box.width, height: box.height };
        }),
      }));
      measurements.push({ state, ...metrics });
      expect(metrics.documentWidth).toBeLessThanOrEqual(width);
      for (const control of metrics.controls) {
        expect(control.left).toBeGreaterThanOrEqual(0);
        expect(control.right).toBeLessThanOrEqual(width);
        expect(control.width).toBeGreaterThan(0);
        expect(control.height).toBeGreaterThan(0);
      }
    }
    await expect(account).toBeVisible(); await expect(logout).toBeVisible();
    await checkNavigation('authenticated');
    const me = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/me');
    await account.click();
    const meResponse = await me;
    expect(meResponse.status()).toBe(200);
    expect((await meResponse.json()).user.id).toBe(user.id);
    await page.reload();
    await expect(page.getByTestId('current-user')).toHaveText(displayName);
    // 新页面刷新保留导航位置；返回 Nova 后继续验证原有账号、复制范围与移动布局。
    await expect(page.locator('.demo-pill')).toHaveText('真实工作空间');
    expect(new URL(page.url()).searchParams.get('view')).toBe('workspace');
    await page.getByRole('region',{name:'我的工作空间',exact:true}).getByRole('button',{name:'返回 Nova 本地演示',exact:true}).click();
    await expect(page.locator('.demo-pill')).toHaveText('本地演示');
    await expect(copy).toBeVisible();
    await expect(copy).toHaveAttribute('title', /其他电脑无法访问/);
    await copy.click();
    await expect(page.locator('.share-feedback')).toHaveText('已复制本地演示链接，仅供这台电脑的其他标签页或浏览器窗口使用。');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    await checkNavigation('copied');
    await page.screenshot({ path: testInfo.outputPath(`authenticated-${width}.png`), fullPage: true });
    await logout.click();
    await expect(page.getByTestId('current-user')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '登录 / 注册', exact: true })).toBeVisible();
    await expect(page.locator('.auth-notice')).toHaveText('已退出登录');
    await expect(copy).toBeEnabled();
    await checkNavigation('logged-out');
    await testInfo.attach('mobile-navigation-metrics', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  });
}
