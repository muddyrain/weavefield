import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test('missing local configuration explains how to start Web and Collab without exposing a token', async ({ page }, testInfo) => {
  // 独立启动真实 Vite，空环境变量覆盖本机 .env，不改写开发者配置。
  const web = spawn(process.execPath, [
    path.resolve('apps/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '15174',
  ], {
    cwd: path.resolve('apps/web'),
    env: { ...process.env, VITE_COLLAB_DEV_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  web.stdout.on('data', data => { serverLog += data; });
  web.stderr.on('data', data => { serverLog += data; });
  try {
    await expect.poll(async () => {
      if (web.exitCode !== null) throw new Error(serverLog);
      return fetch('http://127.0.0.1:15174').then(response => response.ok).catch(() => false);
    }).toBe(true);
    await page.goto('http://127.0.0.1:15174/?doc=missing-config');
    const guide = page.getByRole('note', { name: '本地协作配置指引' });
    await expect(guide).toContainText('尚未配置本地协作');
    await expect(guide).toContainText('VITE_COLLAB_DEV_TOKEN');
    await expect(guide).toContainText('同时启动 Web 和 Collab');
    await expect(guide.locator('pre')).toHaveText([
      'pnpm install --frozen-lockfile',
      'cp apps/web/.env.example apps/web/.env',
      'cp apps/collab/.env.example apps/collab/.env',
      'cp apps/api/.env.example apps/api/.env',
      'pnpm dev',
    ].join('\n'));
    await expect(guide.getByRole('link')).toHaveAttribute('href', 'https://github.com/muddyrain/weavefield#安装与启动');
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
    await expect(page.locator('.editor-status')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('m0-e2e-local-only-token');
    await page.screenshot({ path: testInfo.outputPath('missing-configuration.png'), fullPage: true });
  } finally {
    if (web.exitCode === null) {
      const exited = once(web, 'exit');
      web.kill();
      await exited;
    }
  }
});

for (const clipboard of ['success', 'denied', 'unavailable'] as const) {
  test(`local demo link reports clipboard ${clipboard} and explains its local scope`, async ({ page }, testInfo) => {
    await page.addInitScript(mode => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: mode === 'unavailable' ? undefined : {
          writeText: async (text: string) => {
            if (mode === 'denied') throw new DOMException('Clipboard denied', 'NotAllowedError');
            document.documentElement.dataset.copiedDemoLink = text;
          },
        },
      });
    }, clipboard);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?doc=local-link');
    await expect(page.locator('.avatar-stack')).toHaveCount(0);
    await expect(page.locator('.demo-pill')).toHaveText('本地演示');
    const copy = page.getByRole('button', { name: '复制本地演示链接' });
    await expect(copy).toHaveAttribute('title', /其他电脑无法访问/);
    await copy.click();
    const feedback = page.locator('.share-feedback');
    if (clipboard === 'success') {
      await expect(feedback).toHaveText('已复制本地演示链接，仅供这台电脑的其他标签页或浏览器窗口使用。');
      await expect(page.locator('html')).toHaveAttribute('data-copied-demo-link', page.url());
    } else {
      await expect(feedback).toHaveText('复制失败，请手动复制地址栏链接；该链接仅限这台电脑使用。');
      await expect(page.locator('html')).not.toHaveAttribute('data-copied-demo-link');
    }
    await expect(copy).toBeEnabled();
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`clipboard-${clipboard}.png`), fullPage: true });
  });
}
