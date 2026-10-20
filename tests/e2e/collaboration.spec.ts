import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Locator } from '@playwright/test';

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
  await editorB.press('End');
  await editorB.pressSequentially(' + Window B');
  await expect.poll(() => documentText(editorA)).toBe('Window A 织域 + Window B');
  await pageB.reload();
  await expect.poll(() => documentText(editorB)).toBe('Window A 织域 + Window B');

  const snapshot = path.join(storage, '.local/snapshots/doc-m0-e2e.bin');
  await expect.poll(() => readFile(snapshot).then(bytes => bytes.length).catch(() => 0)).toBeGreaterThan(0);
  const saved = await readFile(snapshot);
  await stopCollab();
  await expect(pageA.locator('.editor-status')).toContainText('连接中');
  await editorA.press('End');
  await editorA.pressSequentially(' offline-A');
  await editorB.press('End');
  await editorB.pressSequentially(' offline-B');
  await startCollab();
  await expect(editorA).toContainText('offline-B');
  await expect(editorB).toContainText('offline-A');
  await expect.poll(async () => (await documentText(editorA)) === (await documentText(editorB))).toBe(true);
  const merged = await documentText(editorA);
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
