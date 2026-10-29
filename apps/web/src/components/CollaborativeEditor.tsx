import { useEffect, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { withCollaboration } from '@blocknote/core/yjs';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import * as Y from 'yjs';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

type Props = { room: string; guestName: string };
type ConnectionStatus = 'connecting' | 'syncing' | 'synced' | 'disconnected' | 'authentication-failed';
const statusLabels: Record<ConnectionStatus, string> = {
  connecting: '正在连接本地协作服务',
  syncing: '已连接，等待文档同步',
  synced: '已同步',
  disconnected: '连接失败，正在重试',
  'authentication-failed': '本地协作配置不匹配',
};
const setupUrl = 'https://github.com/muddyrain/weavefield#安装与启动';

function LiveEditor({ doc, provider, guestName }: {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  guestName: string;
}) {
  const editor = useCreateBlockNote(withCollaboration({
    collaboration: {
      provider: { awareness: provider.awareness ?? undefined },
      fragment: doc.getXmlFragment('document-store'),
      user: { name: guestName, color: '#7486f7' },
      showCursorLabels: 'always',
    },
  }));
  return <BlockNoteView editor={editor} theme="light" />;
}

export default function CollaborativeEditor({ room, guestName }: Props) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const token = import.meta.env.VITE_COLLAB_DEV_TOKEN as string | undefined;
  const url = (import.meta.env.VITE_COLLAB_URL as string | undefined) ?? 'ws://127.0.0.1:1234';

  // Connection side effects must live inside an Effect. Creating the provider in
  // useMemo would leak/reuse a destroyed WebSocket under React StrictMode.
  const [connection, setConnection] = useState<{doc: Y.Doc; provider: HocuspocusProvider; room: string} | null>(null);
  useEffect(() => {
    if (!token) return;
    setStatus('connecting');
    let authenticationFailed = false;
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({url, name: room, document: doc, token});
    const onStatus = ({status: s}: {status: string}) => {
      if (s === 'connected') {
        authenticationFailed = false;
        setStatus('syncing');
      } else if (s === 'disconnected') {
        setStatus(authenticationFailed ? 'authentication-failed' : 'disconnected');
      } else {
        // 自动重试期间保留失败提示，直到连接真正恢复。
        setStatus(current => current === 'disconnected' || current === 'authentication-failed' ? current : 'connecting');
      }
    };
    const onSynced = ({state}: {state: boolean}) => { if (state) setStatus('synced'); };
    const onAuthenticationFailed = () => {
      authenticationFailed = true;
      setStatus('authentication-failed');
    };
    provider.on('status', onStatus);
    provider.on('synced', onSynced);
    provider.on('authenticationFailed', onAuthenticationFailed);
    setConnection({doc, provider, room});
    return () => {
      provider.off('status', onStatus);
      provider.off('synced', onSynced);
      provider.off('authenticationFailed', onAuthenticationFailed);
      provider.destroy();
      doc.destroy();
    };
  }, [room, token, url]);

  if (!token) return (
    <div className="editor-message" role="note" aria-label="本地协作配置指引">
      <h2>尚未配置本地协作</h2>
      <p>缺少 <code>VITE_COLLAB_DEV_TOKEN</code>。本地演示需要同时启动 Web 和 Collab 协作服务。</p>
      <p>请在仓库根目录按照 README 的步骤配置并启动：</p>
      <pre><code>{`pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env
cp apps/collab/.env.example apps/collab/.env
cp apps/api/.env.example apps/api/.env
pnpm dev`}</code></pre>
      <p>Web 与 Collab 的本地开发令牌需一致；修改 Web 配置后请重启 Web，再在本机打开两个相同链接的浏览器窗口。</p>
      <a href={setupUrl}>查看 README 本地启动指引</a>
    </div>
  );
  if (!connection || connection.room !== room) return <div className="editor-message">等待协同服务……</div>;

  return (
    <div className="editor-shell">
      <div className="editor-status" role="status" data-state={status}><span className="live-dot" aria-hidden="true" /><span className="editor-status-label">{statusLabels[status]}</span><span aria-hidden="true">·</span><span className="editor-room" title={room}>{room}</span></div>
      {(status === 'disconnected' || status === 'authentication-failed') && (
        <div className="editor-connection-help" role="note">
          <p>{status === 'authentication-failed'
            ? '请检查 Web 与 Collab 配置中的本地开发令牌是否一致，修改后重启 Web。'
            : '未能连接本地协作服务。请确认 Web 与 Collab 已同时启动，并检查 VITE_COLLAB_URL 和服务端口。'}</p>
          <a href={setupUrl}>查看 README 本地启动指引</a>
        </div>
      )}
      <LiveEditor key={room} doc={connection.doc} provider={connection.provider} guestName={guestName} />
    </div>
  );
}
