// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { OcpiResponseSchema } from '../OcpiResponse';

const schema = OcpiResponseSchema(z.object({ id: z.string() }));
const timestamp = '2026-11-05T15:12:37.074Z';

// OCPI 2.2.1 envelope: status_message is ?, data is * or ?.
describe('OcpiResponseSchema', () => {
  it('accepts null status_message and data', () => {
    const result = schema.parse({
      status_code: 2001,
      status_message: null,
      timestamp,
      data: null,
    });

    expect(result.status_message).toBeNull();
    expect(result.data).toBeNull();
  });

  it('accepts a response without status_message and data', () => {
    const result = schema.parse({ status_code: 1000, timestamp });

    expect(result.status_message).toBeUndefined();
    expect(result.data).toBeUndefined();
  });

  it('still validates data when present', () => {
    expect(() =>
      schema.parse({ status_code: 1000, timestamp, data: { id: 42 } }),
    ).toThrow();
  });
});
