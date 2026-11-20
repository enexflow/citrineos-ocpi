// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { LocationHours } from '@zetra/citrineos-base';
import { LocationMapper } from '../LocationMapper';
import { HoursSchema } from '../../model/Hours';

// mapLocationHours uses no runtime value from the core barrel, whose ESM dist jest cannot load.
jest.mock('@zetra/citrineos-base', () => ({}));

const hours = (value: Partial<LocationHours>): LocationHours =>
  value as LocationHours;

describe('LocationMapper.mapLocationHours', () => {
  it('maps regular hours to OCPI snake_case with an explicit twentyfourseven', () => {
    const result = LocationMapper.mapLocationHours(
      hours({
        twentyfourSeven: false,
        regularHours: [
          { weekday: 1, periodBegin: '08:00', periodEnd: '12:00' },
          { weekday: 1, periodBegin: '14:00', periodEnd: '23:59' },
        ],
      }),
    );

    expect(result).toEqual({
      twentyfourseven: false,
      regular_hours: [
        { weekday: 1, period_begin: '08:00', period_end: '12:00' },
        { weekday: 1, period_begin: '14:00', period_end: '23:59' },
      ],
      exceptional_openings: undefined,
      exceptional_closings: undefined,
    });
    expect(HoursSchema.safeParse(result).success).toBe(true);
  });

  it('drops regular hours when the location is open 24/7', () => {
    const result = LocationMapper.mapLocationHours(
      hours({
        twentyfourSeven: true,
        regularHours: [
          { weekday: 1, periodBegin: '08:00', periodEnd: '12:00' },
        ],
      }),
    );

    expect(result?.twentyfourseven).toBe(true);
    expect(result?.regular_hours).toBeUndefined();
    expect(HoursSchema.safeParse(result).success).toBe(true);
  });

  it.each([
    [
      'empty regular hours',
      hours({ twentyfourSeven: false, regularHours: [] }),
    ],
    ['no regular hours', hours({ twentyfourSeven: false })],
    ['missing twentyfourSeven', hours({})],
  ])(
    'omits opening_times rather than sending invalid Hours (%s)',
    (_, input) => {
      expect(LocationMapper.mapLocationHours(input)).toBeUndefined();
    },
  );

  it('treats a missing twentyfourSeven flag as false', () => {
    const result = LocationMapper.mapLocationHours(
      hours({
        regularHours: [
          { weekday: 7, periodBegin: '09:00', periodEnd: '17:00' },
        ],
      }),
    );

    expect(result?.twentyfourseven).toBe(false);
    expect(HoursSchema.safeParse(result).success).toBe(true);
  });

  it('keeps exceptional periods', () => {
    const begin = new Date('2026-12-24T18:00:00Z');
    const end = new Date('2026-12-26T06:00:00Z');

    const result = LocationMapper.mapLocationHours(
      hours({
        twentyfourSeven: true,
        exceptionalClosings: [{ periodBegin: begin, periodEnd: end }],
      }),
    );

    expect(result?.exceptional_closings).toEqual([
      { period_begin: begin, period_end: end },
    ]);
  });
});
