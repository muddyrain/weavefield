import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

describe('binary snapshots', () => {
  let root: string;
  let storage: typeof import('./storage');

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'weavefield-storage-'));
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    storage = await import('./storage');
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores portable filenames and restores CRDT history without duplication', async () => {
    const doc = new Y.Doc();
    doc.getText('body').insert(0, '织域 persistence');
    await storage.storeSnapshot('doc:storage-test', doc);
    expect(await readdir(path.join(root, '.local', 'snapshots'))).toEqual(['doc-storage-test.bin']);
    const restored = await storage.loadSnapshot('doc:storage-test');
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
    expect(restored.getText('body').toString()).toBe('织域 persistence');
    restored.getText('body').insert(restored.getText('body').length, ' after restart');
    await storage.storeSnapshot('doc:storage-test', restored);
    const next = await storage.loadSnapshot('doc:storage-test');
    expect(next.getText('body').toString()).toBe('织域 persistence after restart');
    doc.destroy();
    restored.destroy();
    next.destroy();
  });

  it('returns an empty document for a missing snapshot', async () => {
    const doc = await storage.loadSnapshot('doc:missing');
    expect(doc.getText('body').toString()).toBe('');
    doc.destroy();
  });

  it('rejects unsafe room names before accessing files', async () => {
    await expect(storage.loadSnapshot('doc:../escape')).rejects.toThrow('Unsupported');
  });

  it('reports corrupt snapshots instead of silently resetting content', async () => {
    await writeFile(path.join(root, '.local', 'snapshots', 'doc-corrupt.bin'), new Uint8Array([255]));
    await expect(storage.loadSnapshot('doc:corrupt')).rejects.toThrow();
  });
});
