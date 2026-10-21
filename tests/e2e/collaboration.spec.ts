import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

const project = process.cwd();
let storage: string;
let server: ChildProcess;
let serverLog = '';

// Presence labels are decorations, not persisted document text.
async function documentText(editor: Locator) {
  return editor.evaluate(element => {
    const content = element.cloneNode(true) as HTMLElement;
    content.querySelectorAll('.bn-collaboration-cursor__base').forEach(cursor => cursor.remove());
    return content.textContent ?? '';
  });
}

async function moveCaretToEnd(editor: Locator) {
  await editor.focus();
  await editor.evaluate(element => {
    // 跳过不可编辑的协作光标装饰，避免各平台 End 键和元素边界定位的差异。
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement?.closest('[contenteditable="false"]')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let lastText: Node | null = null;
    while (walker.nextNode()) lastText = walker.currentNode;
    if (!lastText) throw new Error('Cannot place caret: editor has no editable text');
    window.getSelection()!.collapse(lastText, lastText.textContent!.length);
  });
}

async function startCollab() {
  server = spawn(process.execPath, [
    '--import', pathToFileURL(path.join(project, 'apps/collab/node_modules/tsx/dist/loader.mjs')).href,
    path.join(project, 'apps/collab/src/index.ts'),
  ], {
    cwd: storage,
    env: { ...process.env, NODE_ENV: 'test', COLLAB_PORT: '11234', COLLAB_DEV_TOKEN: 'm0-e2e-local-only-token' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', data => { serverLog += data; });
  server.stderr?.on('data', data => { serverLog += data; });
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(serverLog);
    return fetch('http://127.0.0.1:11234').then(r => r.ok).catch(() => false);
  }).toBe(true);
}

async function stopCollab() {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
}

test.beforeAll(async () => {
  storage = await mkdtemp(path.join(tmpdir(), 'weavefield-e2e-'));
  await startCollab();
});

test.afterAll(async () => {
  await stopCollab();
  await rm(storage, { recursive: true, force: true });
});

async function layoutMetrics(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector)!;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const title = document.querySelector('h1')!;
    const range = document.createRange();
    range.selectNodeContents(title.firstChild!);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      main: rect('.main-panel'), sidebar: rect('.sidebar'), topbar: rect('.topbar'),
      titleLines: range.getClientRects().length,
      controls: ['.icon-button', '.breadcrumb', '.demo-pill', '.avatar-stack', '.share-btn'].map(rect),
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
    };
  });
}

for (const width of [1440, 1280]) {
  test(`sidebar layout stays usable at ${width}px through collapse, expand and refresh`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?doc=sidebar-layout-${width}`);
    await expect(page.locator('.editor-status')).toContainText('已同步');
    await page.evaluate(() => document.fonts.ready);
    const editor = page.locator('[contenteditable="true"]').first();
    const toggle = page.getByRole('button', { name: '切换侧栏' });
    const measurements: Array<Awaited<ReturnType<typeof layoutMetrics>> & { state: string }> = [];

    async function checkLayout(state: string, expanded: boolean) {
      const metrics = await layoutMetrics(page);
      measurements.push({ state, ...metrics });
      expect(metrics.main.width, `${state}: main must fill the available width`).toBeGreaterThan(900);
      expect(Math.abs(metrics.main.right - width)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.main.x - metrics.sidebar.width)).toBeLessThanOrEqual(1);
      if (expanded) expect(metrics.sidebar.width).toBeGreaterThan(0);
      else {
        expect(metrics.sidebar.width).toBe(0);
        expect(Math.abs(metrics.main.width - width)).toBeLessThanOrEqual(1);
      }
      expect(metrics.titleLines, `${state}: title must stay on one line`).toBe(1);
      expect(Math.abs(metrics.topbar.width - metrics.main.width)).toBeLessThanOrEqual(1);
      for (const control of metrics.controls) {
        expect(control.height).toBeGreaterThan(0);
        expect(control.y).toBeGreaterThanOrEqual(metrics.topbar.y);
        expect(control.bottom).toBeLessThanOrEqual(metrics.topbar.bottom);
        expect(control.x).toBeGreaterThanOrEqual(metrics.main.x);
        expect(control.right).toBeLessThanOrEqual(metrics.main.right);
      }
      expect(metrics.documentWidth).toBeLessThanOrEqual(width);
      // 允许跨平台字体度量和子像素舍入造成的少量高度差异；
      // 短文档仍不应因为错误换行产生几千像素的纵向滚动。
      expect(metrics.documentHeight).toBeLessThanOrEqual(metrics.viewport.height + 8);
      await expect(editor).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${state}.png`), fullPage: true });
      return metrics;
    }

    const expanded = await checkLayout('expanded', true);
    await toggle.click();
    const collapsed = await checkLayout('collapsed', false);
    expect(collapsed.main.width).toBeGreaterThan(expanded.main.width);
    await editor.fill(`侧栏折叠后仍可编辑 ${width}`);
    await toggle.click();
    const restored = await checkLayout('expanded-again', true);
    expect(restored.main.width).toBe(expanded.main.width);
    await expect(editor).toContainText(`侧栏折叠后仍可编辑 ${width}`);

    await toggle.click();
    await page.reload();
    await expect(page.locator('.editor-status')).toContainText('已同步');
    // 当前侧栏只保存在 React 内存中，刷新按既有设计恢复默认展开。
    await checkLayout('refreshed', true);
    await expect(editor).toContainText(`侧栏折叠后仍可编辑 ${width}`);
    expect(errors).toEqual([]);
    await testInfo.attach('layout-metrics', {
      body: JSON.stringify(measurements, null, 2), contentType: 'application/json',
    });
  });
}

test('two windows sync, reconnect and restore binary state after a server restart', async ({ browser, request }) => {
  const health = await request.get('http://127.0.0.1:13001/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ ok: true, service: 'weavefield-api' });

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const errors: string[] = [];
  for (const page of [pageA, pageB]) page.on('pageerror', error => errors.push(error.message));
  const editorA = pageA.locator('[contenteditable="true"]').first();
  const editorB = pageB.locator('[contenteditable="true"]').first();

  await Promise.all([pageA.goto('/?doc=m0-e2e'), pageB.goto('/?doc=m0-e2e')]);
  await expect(pageA.locator('.editor-status')).toContainText('已同步');
  await expect(pageB.locator('.editor-status')).toContainText('已同步');
  await editorA.fill('Window A 织域');
  await expect.poll(() => documentText(editorB)).toBe('Window A 织域');
  await moveCaretToEnd(editorB);
  await editorB.pressSequentially(' + Window B');
  const syncedText = 'Window A 织域 + Window B';
  await expect.poll(() => documentText(editorB)).toBe(syncedText);
  await expect.poll(() => documentText(editorA)).toBe(syncedText);
  await pageB.reload();
  await expect.poll(() => documentText(editorB)).toBe(syncedText);

  const snapshot = path.join(storage, '.local/snapshots/doc-m0-e2e.bin');
  await expect.poll(() => readFile(snapshot).then(bytes => bytes.length).catch(() => 0)).toBeGreaterThan(0);
  const saved = await readFile(snapshot);
  await stopCollab();
  await expect(pageA.locator('.editor-status')).toContainText('连接中');
  await expect(pageB.locator('.editor-status')).toContainText('连接中');
  await moveCaretToEnd(editorA);
  await editorA.pressSequentially(' offline-A');
  await expect.poll(() => documentText(editorA)).toBe(`${syncedText} offline-A`);
  await moveCaretToEnd(editorB);
  await editorB.pressSequentially(' offline-B');
  await expect.poll(() => documentText(editorB)).toBe(`${syncedText} offline-B`);
  await startCollab();
  await expect(editorA).toContainText('offline-B');
  await expect(editorB).toContainText('offline-A');
  await expect.poll(async () => (await documentText(editorA)) === (await documentText(editorB))).toBe(true);
  const merged = await documentText(editorA);
  // 并发追加允许任一 CRDT 合并顺序，但原文和两个片段都必须完整。
  expect([
    `${syncedText} offline-A offline-B`,
    `${syncedText} offline-B offline-A`,
  ]).toContain(merged);
  // Wait for the debounce write, then remove every in-memory copy before restoring.
  await expect.poll(async () => (await readFile(snapshot)).equals(saved)).toBe(false);
  await Promise.all([contextA.close(), contextB.close()]);
  await stopCollab();
  await startCollab();
  const fresh = await browser.newContext();
  const restored = await fresh.newPage();
  await restored.goto('/?doc=m0-e2e');
  await expect.poll(() => documentText(restored.locator('[contenteditable="true"]').first())).toBe(merged);
  expect(errors).toEqual([]);
  await fresh.close();
});
