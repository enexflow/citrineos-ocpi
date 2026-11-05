// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { AuthorizationInfoResponseSchema } from '../AuthorizationInfo';
import { AuthorizationInfoAllowed } from '../AuthorizationInfoAllowed';

// Real-time authorization answer as sent by Alphya: no authorization_reference,
// which OCPI 2.2.1 allows (cardinality ?).
const alphyaAnswer = {
  status_code: 1000,
  timestamp: '2026-11-05T15:12:37.074Z',
  data: {
    allowed: 'ALLOWED',
    token: {
      country_code: 'FR',
      party_id: 'Q47',
      uid: '0a1b2c3d4e5f60',
      type: 'RFID',
      contract_id: 'FR-Q47-RFID-test-001',
      issuer: 'Alphya',
      valid: true,
      whitelist: 'ALLOWED',
      last_updated: '2026-08-20T07:28:15.404Z',
    },
    location: {
      location_id: '1786',
      evse_uids: ['ocpicp::2', 'ocpicp::1'],
    },
  },
};

describe('AuthorizationInfoResponseSchema', () => {
  it('accepts an answer without authorization_reference', () => {
    const result = AuthorizationInfoResponseSchema.parse(alphyaAnswer);

    expect(result.data?.allowed).toBe(AuthorizationInfoAllowed.Allowed);
    expect(result.data?.authorization_reference).toBeUndefined();
    expect(result.data?.location?.evse_uids).toEqual([
      'ocpicp::2',
      'ocpicp::1',
    ]);
  });

  it('accepts a null authorization_reference', () => {
    const result = AuthorizationInfoResponseSchema.parse({
      ...alphyaAnswer,
      data: { ...alphyaAnswer.data, authorization_reference: null },
    });

    expect(result.data?.authorization_reference).toBeNull();
  });

  it('accepts null info and location', () => {
    const result = AuthorizationInfoResponseSchema.parse({
      ...alphyaAnswer,
      data: { ...alphyaAnswer.data, info: null, location: null },
    });

    expect(result.data?.info).toBeNull();
    expect(result.data?.location).toBeNull();
  });

  it('accepts a location without evse_uids', () => {
    const result = AuthorizationInfoResponseSchema.parse({
      ...alphyaAnswer,
      data: { ...alphyaAnswer.data, location: { location_id: '1786' } },
    });

    expect(result.data?.location).toEqual({ location_id: '1786' });
  });

  it('still rejects an authorization_reference over 36 characters', () => {
    expect(() =>
      AuthorizationInfoResponseSchema.parse({
        ...alphyaAnswer,
        data: { ...alphyaAnswer.data, authorization_reference: 'x'.repeat(37) },
      }),
    ).toThrow();
  });
});
