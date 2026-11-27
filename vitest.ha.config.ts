// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * High-availability scenario (Tests/ha): two OCPI instances from Server/dist on their own
 * Postgres + Hasura + RabbitMQ + Redis stack. Requires `npm run build` first.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['Tests/ha/**/*.test.ts'],
    // One scenario: stack boot, two instances, broadcasts, commands, two failovers.
    testTimeout: 900_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
