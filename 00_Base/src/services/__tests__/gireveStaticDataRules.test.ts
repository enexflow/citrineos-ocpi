// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { ConnectorDTO } from '../../model/DTO/ConnectorDTO';
import type { EvseDTO } from '../../model/DTO/EvseDTO';
import { Capability } from '../../model/Capability';
import { ConnectorFormat } from '../../model/ConnectorFormat';
import { ConnectorType } from '../../model/ConnectorType';
import { EvseStatus } from '../../model/EvseStatus';
import { ParkingType } from '../../model/ParkingType';
import { PowerType } from '../../model/PowerType';
import type { LocationComplianceInput } from '../gireveStaticDataRules';
import {
  checkLocation,
  countIssues,
  findDuplicateEvseIds,
  GIREVE_RULES,
} from '../gireveStaticDataRules';

type Location = LocationComplianceInput['location'];

const aConnector = (overrides: Partial<ConnectorDTO> = {}): ConnectorDTO => ({
  id: '11',
  standard: ConnectorType.IEC_62196_T2_COMBO,
  format: ConnectorFormat.CABLE,
  power_type: PowerType.DC,
  max_voltage: 1000,
  max_amperage: 600,
  max_electric_power: 200000,
  tariff_ids: ['FRZETT0001'],
  last_updated: new Date('2026-11-27T00:00:00Z'),
  ...overrides,
});

const anEvse = (overrides: Partial<EvseDTO> = {}): EvseDTO => ({
  uid: 'SN1::1',
  evse_id: 'FR*ZET*ESN1*1',
  status: EvseStatus.AVAILABLE,
  capabilities: [Capability.RFID_READER],
  connectors: [aConnector()],
  last_updated: new Date('2026-11-27T00:00:00Z'),
  ...overrides,
});

const aLocation = (overrides: Partial<Location> = {}): Location =>
  ({
    id: '1',
    country_code: 'FR',
    party_id: 'ZET',
    publish: true,
    name: 'Station',
    address: '1 rue X',
    city: 'Paris',
    postal_code: '75009',
    country: 'FRA',
    coordinates: { latitude: '48.876060', longitude: '2.327178' },
    time_zone: 'Europe/Paris',
    parking_type: ParkingType.PARKING_LOT,
    opening_times: { twentyfourseven: true },
    owner: { name: 'Zetra' },
    evses: [anEvse()],
    last_updated: new Date('2026-11-27T00:00:00Z'),
    ...overrides,
  }) as Location;

const check = (
  location: Location,
  extra: Partial<LocationComplianceInput> = {},
) =>
  checkLocation({
    location,
    rejectedConnectors: [],
    checkRemovedEvses: false,
    ...extra,
  });

const codes = (location: Location, extra?: Partial<LocationComplianceInput>) =>
  check(location, extra).map((issue) => issue.code);

describe('checkLocation', () => {
  it('reports nothing for a compliant location', () => {
    expect(check(aLocation())).toEqual([]);
  });

  it.each([
    ['missing', undefined, 'COORDINATES_MISSING'],
    [
      'at 0,0',
      { latitude: '0.00000', longitude: '0.00000' },
      'COORDINATES_ZERO',
    ],
    [
      'out of range',
      { latitude: '91.00000', longitude: '2.00000' },
      'COORDINATES_OUT_OF_RANGE',
    ],
    [
      'with 4 decimals',
      { latitude: '48.8760', longitude: '2.32717' },
      'COORDINATES_PRECISION',
    ],
    [
      'with 8 decimals',
      { latitude: '48.87606012', longitude: '2.32717' },
      'COORDINATES_PRECISION',
    ],
  ])('rejects coordinates %s', (_label, coordinates, code) => {
    expect(codes(aLocation({ coordinates }))).toEqual([code]);
  });

  it.each(['48.87606', '48.8760601'])(
    'accepts a latitude of %s (5 to 7 decimals)',
    (latitude) => {
      expect(
        codes(aLocation({ coordinates: { latitude, longitude: '2.32717' } })),
      ).toEqual([]);
    },
  );

  it('checks EVSE coordinates and ties the issue to the EVSE', () => {
    const issues = check(
      aLocation({
        evses: [
          anEvse({ coordinates: { latitude: '48.8', longitude: '2.3' } }),
        ],
      }),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'COORDINATES_PRECISION',
        evseUid: 'SN1::1',
        field: 'evses[].coordinates',
      }),
    ]);
  });

  it.each(['FR*ZET*ESN1*1', 'FRZETESN11', 'fr*zet*esn1*1'])(
    'accepts the eMI3 evse_id %s',
    (evseId) => {
      expect(
        codes(aLocation({ evses: [anEvse({ evse_id: evseId })] })),
      ).toEqual([]);
    },
  );

  it.each([
    ['without the E marker', 'FR*ZET*SN1*1'],
    ['with another party', 'FR*ABC*ESN1*1'],
    ['with an underscore', 'FR*ZET*EV_395_01'],
  ])('rejects an evse_id %s', (_label, evseId) => {
    expect(codes(aLocation({ evses: [anEvse({ evse_id: evseId })] }))).toEqual([
      'EVSE_ID_NOT_EMI3',
    ]);
  });

  it('reports a missing evse_id', () => {
    expect(codes(aLocation({ evses: [anEvse({ evse_id: null })] }))).toEqual([
      'EVSE_ID_MISSING',
    ]);
  });

  it('takes the eMI3 prefix from the location tenant', () => {
    const location = aLocation({
      country_code: 'BE',
      party_id: 'ABC',
      evses: [anEvse({ evse_id: 'BE*ABC*E1' })],
    });
    expect(codes(location)).toEqual([]);
  });

  it('requires an authorization or payment capability', () => {
    expect(
      codes(
        aLocation({
          evses: [anEvse({ capabilities: [Capability.RESERVABLE] })],
        }),
      ),
    ).toEqual(['EVSE_CAPABILITY_MISSING']);
  });

  it('reports an EVSE without publishable connector with the reasons', () => {
    const issues = check(aLocation({ evses: [anEvse({ connectors: [] })] }), {
      rejectedConnectors: [
        {
          evseUid: 'SN1::1',
          connectorId: '42',
          problems: [
            { field: 'max_voltage', reason: 'missing' },
            { field: 'standard', reason: 'unknown_value', raw: 'Type2x' },
          ],
        },
      ],
    });
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'EVSE_NO_VALID_CONNECTOR',
        level: 'ERROR',
        message: expect.stringContaining(
          'connector 42: max_voltage missing, standard unknown ("Type2x")',
        ),
      }),
    ]);
  });

  it('only warns about a dropped connector when the EVSE keeps a valid one', () => {
    const issues = check(aLocation(), {
      rejectedConnectors: [
        {
          evseUid: 'SN1::1',
          connectorId: '42',
          problems: [{ field: 'format', reason: 'missing' }],
        },
      ],
    });
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'CONNECTOR_INVALID',
        level: 'WARNING',
        connectorId: '42',
      }),
    ]);
  });

  it('rejects a DC connector that is neither COMBO nor CHAdeMO', () => {
    expect(
      codes(
        aLocation({
          evses: [
            anEvse({
              connectors: [
                aConnector({ standard: ConnectorType.IEC_62196_T1_COMBO }),
              ],
            }),
          ],
        }),
      ),
    ).toEqual(['CONNECTOR_DC_STANDARD']);
  });

  it('rejects a COMBO connector declared as a socket', () => {
    expect(
      codes(
        aLocation({
          evses: [
            anEvse({
              connectors: [aConnector({ format: ConnectorFormat.SOCKET })],
            }),
          ],
        }),
      ),
    ).toEqual(['CONNECTOR_COMBO_SOCKET']);
  });

  it.each([
    [
      'DC above V x A',
      PowerType.DC,
      400,
      181,
      300000,
      ['CONNECTOR_POWER_INCONSISTENT'],
    ],
    ['DC at V x A', PowerType.DC, 920, 300, 276000, []],
    ['AC 3 phases at V x A x 3', PowerType.AC_3_PHASE, 230, 32, 22080, []],
    [
      'AC 3 phases above V x A x 3',
      PowerType.AC_3_PHASE,
      230,
      32,
      22081,
      ['CONNECTOR_POWER_INCONSISTENT'],
    ],
    [
      'AC 2 phases split above V x A x 2',
      PowerType.AC_2_PHASE_SPLIT,
      120,
      40,
      9601,
      ['CONNECTOR_POWER_INCONSISTENT'],
    ],
  ])(
    'checks the power: %s',
    (_label, powerType, voltage, amperage, watts, expected) => {
      const standard =
        powerType === PowerType.DC
          ? ConnectorType.IEC_62196_T2_COMBO
          : ConnectorType.IEC_62196_T2;
      const connector = aConnector({
        standard,
        power_type: powerType,
        max_voltage: voltage,
        max_amperage: amperage,
        max_electric_power: watts,
      });
      expect(
        codes(aLocation({ evses: [anEvse({ connectors: [connector] })] })),
      ).toEqual(expected);
    },
  );

  it('rejects two connectors of the same standard on one EVSE', () => {
    expect(
      codes(
        aLocation({
          evses: [
            anEvse({ connectors: [aConnector(), aConnector({ id: '12' })] }),
          ],
        }),
      ),
    ).toEqual(['EVSE_DUPLICATE_CONNECTOR_STANDARD']);
  });

  it.each([
    ['no tariff', { tariff_ids: [] }, 'CONNECTOR_TARIFF_MISSING'],
    [
      'no max_electric_power',
      { max_electric_power: undefined },
      'CONNECTOR_MAX_POWER_MISSING',
    ],
    [
      'a DC amperage below 32 A',
      { max_amperage: 30, max_electric_power: 30000 },
      'CONNECTOR_DC_AMPERAGE_LOW',
    ],
  ])('warns about %s', (_label, overrides, code) => {
    const issues = check(
      aLocation({ evses: [anEvse({ connectors: [aConnector(overrides)] })] }),
    );
    expect(issues).toEqual([
      expect.objectContaining({ code, level: 'WARNING', connectorId: '11' }),
    ]);
  });

  it('warns about a missing owner name and missing opening times', () => {
    expect(
      codes(aLocation({ owner: undefined, opening_times: undefined })),
    ).toEqual([
      'LOCATION_OWNER_NAME_MISSING',
      'LOCATION_OPENING_TIMES_MISSING',
    ]);
  });

  it('warns about more than 2 opening slots on a weekday', () => {
    const slot = (begin: string, end: string) => ({
      weekday: 1,
      period_begin: begin,
      period_end: end,
    });
    const location = aLocation({
      opening_times: {
        twentyfourseven: false,
        regular_hours: [
          slot('06:00', '08:00'),
          slot('10:00', '12:00'),
          slot('14:00', '16:00'),
        ],
      },
    });
    expect(codes(location)).toEqual(['LOCATION_REGULAR_HOURS_TOO_MANY_SLOTS']);
  });

  it.each([
    ['1', []],
    ['-1', []],
    ['1A', ['EVSE_FLOOR_LEVEL_NOT_INTEGER']],
  ])('checks floor_level %s', (floorLevel, expected) => {
    expect(
      codes(aLocation({ evses: [anEvse({ floor_level: floorLevel })] })),
    ).toEqual(expected);
  });

  it('warns about a PLANNED EVSE', () => {
    expect(
      codes(aLocation({ evses: [anEvse({ status: EvseStatus.PLANNED })] })),
    ).toEqual(['EVSE_STATUS_PLANNED']);
  });

  it('skips a REMOVED EVSE unless asked to check it', () => {
    const location = aLocation({
      evses: [anEvse({ status: EvseStatus.REMOVED, evse_id: null })],
    });
    expect(codes(location)).toEqual(['EVSE_STATUS_REMOVED']);
    expect(codes(location, { checkRemovedEvses: true })).toEqual([
      'EVSE_ID_MISSING',
    ]);
  });

  it('notes a French location outside Europe/Paris and a missing parking type', () => {
    expect(
      codes(aLocation({ time_zone: 'UTC', parking_type: undefined })),
    ).toEqual([
      'LOCATION_TIME_ZONE_NOT_PARIS',
      'LOCATION_PARKING_TYPE_MISSING',
    ]);
  });

  it('sorts errors first, location-level issues before EVSE ones', () => {
    const issues = check(
      aLocation({
        time_zone: 'UTC',
        coordinates: undefined,
        evses: [anEvse({ evse_id: null })],
      }),
    );
    expect(issues.map((i) => i.code)).toEqual([
      'COORDINATES_MISSING',
      'EVSE_ID_MISSING',
      'LOCATION_TIME_ZONE_NOT_PARIS',
    ]);
  });
});

describe('findDuplicateEvseIds', () => {
  it('reports an evse_id used twice, ignoring separators and case', () => {
    const duplicates = findDuplicateEvseIds([
      {
        locationId: 1,
        location: aLocation({ evses: [anEvse({ evse_id: 'FR*ZET*ESN1*1' })] }),
        checkRemovedEvses: false,
      },
      {
        locationId: 2,
        location: aLocation({
          evses: [anEvse({ uid: 'SN2::1', evse_id: 'frzetesn11' })],
        }),
        checkRemovedEvses: true,
      },
    ]);
    expect(duplicates.get(1)).toEqual([
      expect.objectContaining({
        code: 'EVSE_ID_DUPLICATE',
        evseUid: 'SN1::1',
        message: expect.stringContaining('EVSE SN2::1 (location 2)'),
      }),
    ]);
    expect(duplicates.get(2)).toEqual([
      expect.objectContaining({ code: 'EVSE_ID_DUPLICATE', evseUid: 'SN2::1' }),
    ]);
  });

  it('ignores REMOVED EVSEs of a location whose removed EVSEs are not checked', () => {
    const duplicates = findDuplicateEvseIds([
      { locationId: 1, location: aLocation(), checkRemovedEvses: false },
      {
        locationId: 2,
        location: aLocation({
          evses: [anEvse({ uid: 'SN2::1', status: EvseStatus.REMOVED })],
        }),
        checkRemovedEvses: false,
      },
    ]);
    expect(duplicates.size).toBe(0);
  });
});

describe('countIssues', () => {
  it('counts issues per level', () => {
    const issues = check(
      aLocation({
        time_zone: 'UTC',
        owner: undefined,
        evses: [anEvse({ evse_id: null })],
      }),
    );
    expect(countIssues(issues)).toEqual({ error: 1, warning: 1, info: 1 });
  });

  it('gives every rule a level', () => {
    for (const rule of Object.values(GIREVE_RULES)) {
      expect(['ERROR', 'WARNING', 'INFO']).toContain(rule.level);
    }
  });
});
