// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { OcpiConfig } from '../config/ocpi.types.js';

export const DEFAULT_GIREVE_RETRY_INTERVAL_SECONDS = 300;
export const DEFAULT_GIREVE_RETRY_BACKOFF_MULTIPLIER = 2;
export const DEFAULT_GIREVE_RETRY_MAX_INTERVAL_SECONDS = 86400;

export interface GireveRetryBackoffOptions {
  baseIntervalSeconds: number;
  multiplier: number;
  maxIntervalSeconds: number;
}

export function getGireveRetryBackoffOptions(
  config: OcpiConfig,
): GireveRetryBackoffOptions {
  return {
    baseIntervalSeconds:
      config.gireve?.retryIntervalSeconds ??
      DEFAULT_GIREVE_RETRY_INTERVAL_SECONDS,
    multiplier:
      config.gireve?.retryBackoffMultiplier ??
      DEFAULT_GIREVE_RETRY_BACKOFF_MULTIPLIER,
    maxIntervalSeconds:
      config.gireve?.retryMaxIntervalSeconds ??
      DEFAULT_GIREVE_RETRY_MAX_INTERVAL_SECONDS,
  };
}

/**
 * Exponential backoff delay for a retry row.
 * attemptCount = number of failed retry attempts already recorded
 * (0 for a freshly queued row): 0 => base, 1 => base * m, 2 => base * m^2...
 * Capped at maxIntervalSeconds.
 */
export function computeGireveRetryDelaySeconds(
  attemptCount: number,
  options: GireveRetryBackoffOptions,
): number {
  const exponent = Math.max(0, attemptCount);
  const delay =
    options.baseIntervalSeconds * Math.pow(options.multiplier, exponent);
  return Math.min(delay, options.maxIntervalSeconds);
}

export function computeGireveNextRetryAt(
  attemptCount: number,
  options: GireveRetryBackoffOptions,
  from: Date = new Date(),
): Date {
  return new Date(
    from.getTime() +
      computeGireveRetryDelaySeconds(attemptCount, options) * 1000,
  );
}
