import { describe, expect, it } from 'vitest';
import type { UserConfig } from 'vitest/config';
import configuration from '../vitest.config';

describe('Vitest worker policy', () => {
  it('caps file workers at half of the available CPUs', () => {
    const resolvedConfiguration = configuration as UserConfig;

    expect(resolvedConfiguration.test?.maxWorkers).toBe('50%');
  });

  it('allows a test long enough to spawn the Prisma schema push it needs', () => {
    const resolvedConfiguration = configuration as UserConfig;

    expect(resolvedConfiguration.test?.testTimeout).toBe(20_000);
  });
});
