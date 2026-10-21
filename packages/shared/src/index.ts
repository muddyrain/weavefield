import { z } from 'zod';

export type AuthUser = { id: string; email: string; displayName: string };
export type AuthSession = { user: AuthUser; sessionExpiresAt: string };

// Public validation only. ACL and authorization belong to NestJS.
export const workspaceSlugSchema = z.string().min(3).max(64).regex(/^[a-z0-9-]+$/);
export const taskStatusSchema = z.enum(['TODO', 'IN_PROGRESS', 'DONE']);
export const entityKindSchema = z.enum(['DOCUMENT_BLOCK', 'BOARD_NODE', 'TASK']);
export type EntityKind = z.infer<typeof entityKindSchema>;

export const entityLinkSchema = z.object({
  sourceType: entityKindSchema,
  sourceId: z.string().min(1),
  targetType: entityKindSchema,
  targetId: z.string().min(1),
  relation: z.enum(['RELATES_TO', 'IMPLEMENTS', 'BLOCKS']).default('RELATES_TO'),
});
export type EntityLinkInput = z.infer<typeof entityLinkSchema>;

export function toRoomName(documentId: string): string {
  if (!/^[a-z0-9-]{1,80}$/.test(documentId)) throw new Error('Invalid document ID');
  return `doc:${documentId}`;
}
