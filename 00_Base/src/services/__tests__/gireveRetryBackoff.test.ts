// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import {
  computeGireveNextRetryAt,
  computeGireveRetryDelaySeconds,
  getGireveRetryBackoffOptions,
} from '../gireveRetryBackoff';

describe('gireveRetryBackoff', () => {
  const options = {
    baseIntervalSeconds: 300,
    multiplier: 2,
    maxIntervalSeconds: 86400,
  };

  it('doubles the delay on each failed attempt (5, 10, 20, 40 min...)', () => {
    expect(
      [0, 1, 2, 3, 4].map((n) => computeGireveRetryDelaySeconds(n, options)),
    ).toEqual([300, 600, 1200, 2400, 4800]);
  });

  it('caps the delay at maxIntervalSeconds', () => {
    expect(computeGireveRetryDelaySeconds(20, options)).toBe(86400);
    expect(computeGireveRetryDelaySeconds(10_000, options)).toBe(86400);
  });

  it('treats a negative attemptCount as the first attempt', () => {
    expect(computeGireveRetryDelaySeconds(-1, options)).toBe(300);
  });

  it('computes nextRetryAt from the given reference date', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    expect(computeGireveNextRetryAt(2, options, from).toISOString()).toBe(
      '2026-01-01T00:20:00.000Z',
    );
  });

  it('falls back to defaults when gireve config is missing', () => {
    expect(getGireveRetryBackoffOptions({} as any)).toEqual({
      baseIntervalSeconds: 300,
      multiplier: 2,
      maxIntervalSeconds: 86400,
    });
  });

  it('reads backoff settings from config', () => {
    expect(
      getGireveRetryBackoffOptions({
        gireve: {
          retryIntervalSeconds: 60,
          retryBackoffMultiplier: 3,
          retryMaxIntervalSeconds: 3600,
        },
      } as any),
    ).toEqual({
      baseIntervalSeconds: 60,
      multiplier: 3,
      maxIntervalSeconds: 3600,
    });
  });
});
