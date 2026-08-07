import { defineWorkspace } from 'vitest/config';

/**
 * Three suites with very different budgets:
 *  - unit        pure logic, milliseconds
 *  - integration wires real components together, seconds
 *  - stress      throughput and backpressure, up to minutes
 *
 * Keeping them separate means `npm test` stays fast enough to run on every
 * change, while the slow suites are still one command away.
 */
export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['tests/unit/**/*.test.ts'],
      environment: 'node',
      testTimeout: 15_000,
    },
  },
  {
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      environment: 'node',
      testTimeout: 60_000,
      // Integration tests bind ports and write files; run them serially.
      fileParallelism: false,
    },
  },
  {
    test: {
      name: 'stress',
      include: ['tests/stress/**/*.test.ts'],
      environment: 'node',
      testTimeout: 180_000,
      fileParallelism: false,
    },
  },
]);
