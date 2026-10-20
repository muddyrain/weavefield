import 'dotenv/config';
import { Server } from '@hocuspocus/server';
import { assertDocRoom } from './rooms';
import { loadSnapshot, storeSnapshot } from './storage';

if (process.env.NODE_ENV === 'production') {
  throw new Error('The demo collab service is NOT production safe. Implement authenticated tickets and PostgreSQL persistence first.');
}

const token = process.env.COLLAB_DEV_TOKEN;
if (!token || token.length < 12) {
  throw new Error('Set COLLAB_DEV_TOKEN in apps/collab/.env (dev only).');
}

const port = Number(process.env.COLLAB_PORT ?? 1234);
const server = new Server({
  name: 'weavefield-collab-dev',
  port,
  address: '127.0.0.1',
  debounce: 800,
  maxDebounce: 2500,
  maxUnauthenticatedQueueSize: 512 * 1024,
  maxPendingDocuments: 4,
  async onAuthenticate({ token: presented, documentName }) {
    assertDocRoom(documentName);
    if (presented !== token) throw new Error('Unauthorized');
    return {dev: true};
  },
  async onLoadDocument({ documentName }) {
    return loadSnapshot(documentName);
  },
  async onStoreDocument({ documentName, document }) {
    await storeSnapshot(documentName, document);
  },
});

void server.listen();
console.log(`[collab] localhost-only ws://127.0.0.1:${port} (DEV, NOT FOR PRODUCTION)`);
