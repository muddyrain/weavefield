import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  const result = await editor.evaluate(element => {
    // 只选择正文；协作装饰里的 U+2060 和访客标签不属于可输入内容。
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: node => !node.parentElement?.closest('.bn-inline-content')
        || node.parentElement.closest('.bn-collaboration-cursor__base, [contenteditable="false"]')
        || !node.textContent?.replace(/[\u200b\u2060\ufeff]/g, '')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let lastText: Node | null = null;
    while (walker.nextNode()) lastText = walker.currentNode;
    if (!lastText) throw new Error('Cannot place caret: editor has no editable text');
    // Tiptap 在编辑器根元素上公开 editor；这里只操作 Selection，不写入文档。
    const { editor: tiptap } = element as HTMLElement & { editor: {
      commands: { setTextSelection(position: number): boolean };
      view: {
        posAtDOM(node: Node, offset: number): number;
        state: { selection: { anchor: number; head: number } };
      };
    } };
    const offset = lastText.textContent!.length;
    const position = tiptap.view.posAtDOM(lastText, offset);
    // 直接 collapse 只更新 DOM，selectionchange 前模型仍可能在段首。
    const applied = tiptap.commands.setTextSelection(position);
    const selection = window.getSelection();
    return {
      applied,
      focused: document.activeElement === element,
      collapsed: selection?.isCollapsed,
      anchorAtEnd: selection?.anchorNode === lastText && selection.anchorOffset === offset,
      focusAtEnd: selection?.focusNode === lastText && selection.focusOffset === offset,
      modelAtEnd: tiptap.view.state.selection.anchor === position && tiptap.view.state.selection.head === position,
      positions: {
        expectedOffset: offset, anchorOffset: selection?.anchorOffset, focusOffset: selection?.focusOffset,
        expectedPosition: position, modelAnchor: tiptap.view.state.selection.anchor, modelHead: tiptap.view.state.selection.head,
      },
    };
  });
  // 只附加布尔值和位置数字；CI 可上传它们，不包含正文、DOM、网络或凭据。
  const diagnostics = test.info().outputPath(`caret-diagnostics-${test.info().attachments.length}.json`);
  await writeFile(diagnostics, JSON.stringify(result));
  await test.info().attach('caret-diagnostics', { path: diagnostics, contentType: 'application/json' });
  const { positions: _positions, ...checks } = result;
  expect(checks).toEqual({ applied: true, focused: true, collapsed: true, anchorAtEnd: true, focusAtEnd: true, modelAtEnd: true });
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
      controls: ['.icon-button', '.breadcrumb', '.demo-pill', '.share-btn'].map(rect),
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
    };
  });
}

for (const width of [1440, 1280]) {
  test(`sidebar layout stays usable at ${width}px through collapse, expand and refresh`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      // 未登录的 /auth/me 按协议返回 401；其他控制台错误仍必须使布局测试失败。
      const anonymousSession = new URL(message.location().url || page.url()).pathname === '/api/auth/me'
        && /^Failed to load resource:.*401/.test(message.text());
      if (message.type() === 'error' && !anonymousSession) errors.push(message.text());
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?doc=sidebar-layout-${width}`);
    await expect(page.locator('.editor-status')).toContainText('已同步');
    await expect(page.locator('.avatar-stack')).toHaveCount(0);
    await expect(page.locator('.demo-pill')).toHaveText('本地演示');
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

for (const viewport of [{ width: 1512, height: 740 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`document scroll stays inside the viewport at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`/?doc=viewport-scroll-${viewport.width}`);
    await expect(page.locator('.editor-status')).toContainText('已同步');
    const body = page.locator('.workspace-body');
    const editor = page.locator('[contenteditable="true"]').first();
    const topbar = await page.locator('.topbar').boundingBox();
    const footer = await page.locator('.status-bar').boundingBox();
    const sidebar = await page.locator('.sidebar').boundingBox();
    expect(topbar!.y).toBe(0);
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(viewport.height);
    if (viewport.width > 900) {
      // 桌面短文档应直接落在一屏内，不能只把溢出裁掉。
      const short = await body.evaluate(element => ({ scroll: element.scrollHeight, visible: element.clientHeight }));
      expect(short.scroll).toBeLessThanOrEqual(short.visible + 1);
      const card = await page.locator('.editor-card').boundingBox();
      expect(card!.y + card!.height).toBeLessThanOrEqual(footer!.y);
    }
    // BlockNote 的 fill 仅保留首段；通过真实键盘输入生成可滚动的长文档。
    await editor.fill('滚动回归段落 0');
    for (let index = 1; index < 40; index++) {
      await page.keyboard.press('Enter');
      await page.keyboard.insertText(`滚动回归段落 ${index}`);
    }
    await expect(editor).toContainText('滚动回归段落 39');
    await body.evaluate(element => { element.scrollTop = 0; });
    const box = await body.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(50);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    expect(await page.locator('.topbar').boundingBox()).toEqual(topbar);
    expect(await page.locator('.status-bar').boundingBox()).toEqual(footer);
    if (sidebar) expect(await page.locator('.sidebar').boundingBox()).toEqual(sidebar);
    await expect(editor).toContainText('滚动回归段落 39');
  });
}

test('unavailable local collab shows recovery guidance and clears it after syncing', async ({ page }, testInfo) => {
  await stopCollab();
  try {
    await page.goto('/?doc=connection-guidance');
    await expect(page.locator('.editor-status')).toHaveAttribute('data-state', 'disconnected');
    await expect(page.locator('.editor-status')).toContainText('连接失败，正在重试');
    await expect(page.locator('.editor-status')).not.toContainText('已同步');
    await expect(page.locator('.editor-connection-help')).toContainText('Web 与 Collab 已同时启动');
    await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('connection-unavailable.png'), fullPage: true });
  } finally {
    await startCollab();
  }
  await expect(page.locator('.editor-status')).toHaveAttribute('data-state', 'synced');
  await expect(page.locator('.editor-status')).toContainText('已同步');
  await expect(page.locator('.editor-connection-help')).toHaveCount(0);
});

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
  await expect.poll(() => documentText(editorA)).toBe('Window A 织域');
  await expect.poll(() => documentText(editorB)).toBe('Window A 织域');
  await moveCaretToEnd(editorB);
  // 使用当前焦点发送真实键盘事件，避免 Locator 输入再次调用 focus。
  await pageB.keyboard.type(' + Window B');
  const syncedText = 'Window A 织域 + Window B';
  await expect.poll(() => documentText(editorB)).toBe(syncedText);
  await expect.poll(() => documentText(editorA)).toBe(syncedText);
  await pageB.reload();
  await expect.poll(() => documentText(editorB)).toBe(syncedText);

  const snapshot = path.join(storage, '.local/snapshots/doc-m0-e2e.bin');
  await expect.poll(() => readFile(snapshot).then(bytes => bytes.length).catch(() => 0)).toBeGreaterThan(0);
  const saved = await readFile(snapshot);
  await stopCollab();
  await expect(pageA.locator('.editor-status')).toContainText('连接失败，正在重试');
  await expect(pageB.locator('.editor-status')).toContainText('连接失败，正在重试');
  await moveCaretToEnd(editorA);
  await pageA.keyboard.type(' offline-A');
  await expect.poll(() => documentText(editorA)).toBe(`${syncedText} offline-A`);
  await moveCaretToEnd(editorB);
  await pageB.keyboard.type(' offline-B');
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
