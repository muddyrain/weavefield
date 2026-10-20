import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports API identity', () => expect(new HealthController().check()).toMatchObject({ok:true,service:'weavefield-api'}));
});
