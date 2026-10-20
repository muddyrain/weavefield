export const DOC_ROOM_RE = /^doc:[a-z0-9-]{1,80}$/;

export function assertDocRoom(value: string): string {
  if (!DOC_ROOM_RE.test(value)) throw new Error('Unsupported collaboration room');
  return value;
}
