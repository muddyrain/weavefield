import { toRoomName } from '@weavefield/shared';

export function currentRoom(search: string): string {
  const value = new URLSearchParams(search).get('doc') ?? 'demo-project';
  return toRoomName(value);
}
