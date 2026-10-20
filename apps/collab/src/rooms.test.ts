import { describe, expect, it } from 'vitest';
import { assertDocRoom } from './rooms';

describe('safe doc rooms', () => {
  it('accepts canonical doc room', () => expect(assertDocRoom('doc:demo-project')).toBe('doc:demo-project'));
  it('rejects path traversal and foreign namespaces', () => {
    for (const room of ['doc:../x','/tmp/x','secret:a','doc:ABC','doc:']) expect(() => assertDocRoom(room)).toThrow();
  });
});
