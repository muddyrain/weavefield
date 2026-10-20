import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { assertDocRoom } from './rooms';

const ROOT = path.resolve(process.cwd(), '.local', 'snapshots');
const toFile = (room: string) => path.join(ROOT, `${assertDocRoom(room)}.bin`);

// DEV-ONLY binary state persistence. Production path: PostgreSQL, see ADR-0002.
export async function loadSnapshot(room: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  try {
    const update = await readFile(toFile(room));
    Y.applyUpdate(doc, new Uint8Array(update));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return doc;
}

export async function storeSnapshot(room: string, doc: Y.Doc): Promise<void> {
  const pathname = toFile(room);
  await mkdir(ROOT, {recursive:true});
  const temp = `${pathname}.${randomUUID()}.tmp`;
  const bytes = Y.encodeStateAsUpdate(doc);
  await writeFile(temp, bytes);
  await rename(temp, pathname);
}
