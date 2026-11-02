// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { OcpiEmptyResponseSchema } from '../OcpiEmptyResponse';
import { OcpiResponseStatusCode } from '../OcpiResponse';

describe('OcpiEmptyResponseSchema', () => {
  it('accepts a response with an empty data object', () => {
    const result = OcpiEmptyResponseSchema.safeParse({
      data: {},
      status_code: 1000,
      timestamp: '2026-11-02T10:00:00Z',
    });

    expect(result.success).toBe(true);
    expect(result.data?.status_code).toBe(
      OcpiResponseStatusCode.GenericSuccessCode,
    );
  });

  it('accepts a response without data', () => {
    const result = OcpiEmptyResponseSchema.safeParse({
      status_code: 1000,
      timestamp: '2026-11-02T10:00:00Z',
    });

    expect(result.success).toBe(true);
  });
});
