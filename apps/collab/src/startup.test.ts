import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('demo startup guard', () => {
  it('refuses production before listening', () => {
    // Both scripts execute this entry point; production must fail before listening.
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      env: { ...process.env, NODE_ENV: 'production', COLLAB_DEV_TOKEN: 'test-only-token' },
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NOT production safe');
  });

  it('refuses a missing or short development token', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      env: { ...process.env, NODE_ENV: 'test', COLLAB_DEV_TOKEN: '' },
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Set COLLAB_DEV_TOKEN');
  });
});
