// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import {
  buildOcpiObjectId,
  getOcpiCdrId,
  getOcpiSessionId,
  OcpiObjectIdType,
  parseOcpiObjectId,
} from '../OcpiObjectId';

describe('buildOcpiObjectId', () => {
  it('builds {country}*{party}*{letter}{number} with the number on 6 digits at least', () => {
    expect(buildOcpiObjectId('FR', 'ZET', OcpiObjectIdType.SESSION, 9876)).toBe(
      'FR*ZET*R009876',
    );
    expect(buildOcpiObjectId('FR', 'ZET', OcpiObjectIdType.CDR, 9876)).toBe(
      'FR*ZET*F009876',
    );
  });

  it('does not truncate a number longer than 6 digits', () => {
    expect(
      buildOcpiObjectId('FR', 'ZET', OcpiObjectIdType.SESSION, 12345678),
    ).toBe('FR*ZET*R12345678');
  });

  it('fits the 36 characters OCPI allows for Session.id and CDR.id', () => {
    expect(
      buildOcpiObjectId('FR', 'ZET', OcpiObjectIdType.CDR, 2_147_483_647)
        .length,
    ).toBeLessThanOrEqual(36);
  });

  it.each([
    [undefined, 'ZET'],
    ['FR', undefined],
    ['', 'ZET'],
    ['FR', null],
  ])(
    'refuses a missing prefix (country %p, party %p)',
    (countryCode, partyId) => {
      expect(() =>
        buildOcpiObjectId(countryCode, partyId, OcpiObjectIdType.SESSION, 1),
      ).toThrow('missing country code or party id');
    },
  );

  it.each([undefined, null, -1, 1.5, Number.NaN])(
    'refuses an invalid number %p',
    (number) => {
      expect(() =>
        buildOcpiObjectId('FR', 'ZET', OcpiObjectIdType.SESSION, number),
      ).toThrow('invalid number');
    },
  );
});

describe('parseOcpiObjectId', () => {
  it('reads back an id it built', () => {
    expect(
      parseOcpiObjectId('FR*ZET*R009876', OcpiObjectIdType.SESSION),
    ).toEqual({
      countryCode: 'FR',
      partyId: 'ZET',
      type: OcpiObjectIdType.SESSION,
      number: 9876,
    });
  });

  it('accepts a number without zero padding', () => {
    expect(
      parseOcpiObjectId('FR*ZET*R42', OcpiObjectIdType.SESSION)?.number,
    ).toBe(42);
  });

  it.each([
    // Old session id: the station's OCPP transactionId
    '1234',
    'd7b597b5-e322-4137-88d7-9bed52e4e3fb',
    // Old CDR id, with the location suffix
    'FR*ZET*F9876*42',
    // Another type
    'FR*ZET*F009876',
    'FR*ZET*R',
    'FR*ZET*R00A876',
    'fr*zet*R009876',
    ' FR*ZET*R009876',
    // Above a Postgres integer: cannot be a Transactions.id
    'FR*ZET*R2147483648',
  ])('returns undefined for %p', (id) => {
    expect(parseOcpiObjectId(id, OcpiObjectIdType.SESSION)).toBeUndefined();
  });
});

describe('getOcpiSessionId / getOcpiCdrId', () => {
  const transaction = {
    id: 9876,
    transactionId: '1234',
    tenant: { countryCode: 'FR', partyId: 'ZET' },
  };

  it('gives a session and its CDR the same number, Transactions.id', () => {
    expect(getOcpiSessionId(transaction)).toBe('FR*ZET*R009876');
    expect(getOcpiCdrId(transaction)).toBe('FR*ZET*F009876');
  });

  it('refuses a transaction without its tenant', () => {
    expect(() => getOcpiSessionId({ id: 9876 })).toThrow(
      'missing country code or party id',
    );
  });
});
