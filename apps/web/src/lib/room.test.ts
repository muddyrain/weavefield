import { describe, expect, it } from 'vitest';
import { currentRoom } from './room';

describe('room URL parser', () => {
  it('uses shared demo room by default', () => expect(currentRoom('')).toBe('doc:demo-project'));
  it('supports safe room', () => expect(currentRoom('?doc=project-1')).toBe('doc:project-1'));
  it('rejects unsafe room', () => expect(() => currentRoom('?doc=..%2Fx')).toThrow());
});
