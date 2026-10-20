import { describe, expect, it } from 'vitest';
import { entityLinkSchema, toRoomName } from './index';

describe('shared contract', () => {
  it('accepts safe room IDs', () => expect(toRoomName('demo-project')).toBe('doc:demo-project'));
  it('rejects invalid room IDs', () => expect(() => toRoomName('../secret')).toThrow());
  it('validates linked entity types', () => {
    expect(entityLinkSchema.safeParse({sourceType:'DOCUMENT_BLOCK',sourceId:'a',targetType:'TASK',targetId:'b'}).success).toBe(true);
    expect(entityLinkSchema.safeParse({sourceType:'SECRET',sourceId:'a',targetType:'TASK',targetId:'b'}).success).toBe(false);
  });
});
