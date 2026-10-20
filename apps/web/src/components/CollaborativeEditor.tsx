import { useEffect, useMemo, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { withCollaboration } from '@blocknote/core/yjs';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import * as Y from 'yjs';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

type Props = { room: string; guestName: string };

function LiveEditor({ doc, provider, guestName }: {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  guestName: string;
}) {
  const editor = useCreateBlockNote(withCollaboration({
    collaboration: {
      provider,
      fragment: doc.getXmlFragment('document-store'),
      user: { name: guestName, color: '#7486f7' },
      showCursorLabels: 'always',
    },
  }));
  return <BlockNoteView editor={editor} theme="light" />;
}

export default function CollaborativeEditor({ room, guestName }: Props) {
  const [status, setStatus] = useState('连接中');
  const token = import.meta.env.VITE_COLLAB_DEV_TOKEN as string | undefined;
  const url = (import.meta.env.VITE_COLLAB_URL as string | undefined) ?? 'ws://127.0.0.1:1234';

  const connection = useMemo(() => {
    if (!token) return null;
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({ url, name: room, document: doc, token });
    return { doc, provider };
  }, [room, token, url]);

  useEffect(() => {
    if (!connection) return;
    const onStatus = ({ status: s }: { status: string }) => setStatus(s === 'connected' ? '已连接' : '连接中');
    const onSynced = () => setStatus('已同步');
    connection.provider.on('status', onStatus);
    connection.provider.on('synced', onSynced);
    return () => {
      connection.provider.off('status', onStatus);
      connection.provider.off('synced', onSynced);
      connection.provider.destroy();
      connection.doc.destroy();
    };
  }, [connection]);

  if (!token) return <div className="editor-message">未设置 VITE_COLLAB_DEV_TOKEN，请复制 apps/web/.env.example → .env。</div>;
  if (!connection) return <div className="editor-message">等待协同服务……</div>;

  return (
    <div className="editor-shell">
      <div className="editor-status"><span className="live-dot" /> {status} · {room}</div>
      <LiveEditor doc={connection.doc} provider={connection.provider} guestName={guestName} />
    </div>
  );
}
