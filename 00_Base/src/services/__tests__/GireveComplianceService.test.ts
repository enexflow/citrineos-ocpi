// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// The mappers need @zetra/citrineos-base (ESM-only under Jest): stub them and
// test the orchestration; the rules themselves are covered by gireveStaticDataRules.test.ts.
jest.mock('../../mapper/index', () => ({
  LocationMapper: { fromGraphql: jest.fn() },
  ConnectorMapper: { toPartial: jest.fn(), missingRequiredFields: jest.fn() },
}));
jest.mock('../../graphql/index', () => ({
  GET_OUR_LOCATIONS_QUERY: 'GET_OUR_LOCATIONS_QUERY',
  OcpiGraphqlClient: class {},
}));

import { Logger } from 'tslog';
import { ConnectorMapper, LocationMapper } from '../../mapper/index';
import { Capability } from '../../model/Capability';
import { ConnectorFormat } from '../../model/ConnectorFormat';
import { ConnectorType } from '../../model/ConnectorType';
import { EvseStatus } from '../../model/EvseStatus';
import { ParkingType } from '../../model/ParkingType';
import { PowerType } from '../../model/PowerType';
import { GireveComplianceService } from '../GireveComplianceService';

const fromGraphql = LocationMapper.fromGraphql as jest.Mock;
const toPartial = ConnectorMapper.toPartial as jest.Mock;
const missingRequiredFields =
  ConnectorMapper.missingRequiredFields as jest.Mock;

const rawLocation = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Location ${id}`,
  disableOCPI: false,
  coordinates: { type: 'Point', coordinates: [2.327178, 48.87606] },
  tenant: { countryCode: 'FR', partyId: 'ZET' },
  chargingPool: [
    {
      id: `SN${id}`,
      evses: [
        {
          evseTypeId: 1,
          connectors: [
            {
              id: id * 10,
              type: 'IEC62196T2COMBO',
              format: 'Cable',
              powerType: 'DC',
            },
          ],
        },
      ],
    },
  ],
  ...overrides,
});

// The DTO LocationMapper would produce for rawLocation(id): compliant by default.
const mappedLocation = (
  raw: any,
  evseOverrides: Record<string, unknown> = {},
) => ({
  id: String(raw.id),
  country_code: 'FR',
  party_id: 'ZET',
  country: 'FRA',
  coordinates: { latitude: '48.876060', longitude: '2.327178' },
  time_zone: 'Europe/Paris',
  parking_type: ParkingType.PARKING_LOT,
  opening_times: { twentyfourseven: true },
  owner: { name: 'Zetra' },
  evses: [
    {
      uid: `SN${raw.id}::1`,
      evse_id: `FR*ZET*ESN${raw.id}*1`,
      status: EvseStatus.AVAILABLE,
      capabilities: [Capability.RFID_READER],
      connectors: [
        {
          id: String(raw.id * 10),
          standard: ConnectorType.IEC_62196_T2_COMBO,
          format: ConnectorFormat.CABLE,
          power_type: PowerType.DC,
          max_voltage: 1000,
          max_amperage: 600,
          max_electric_power: 200000,
          tariff_ids: ['T1'],
        },
      ],
      ...evseOverrides,
    },
  ],
});

describe('GireveComplianceService', () => {
  let request: jest.Mock;
  let service: GireveComplianceService;

  const serve = (...pages: unknown[][]) => {
    for (const page of pages) {
      request.mockResolvedValueOnce({ Locations: page });
    }
  };

  beforeEach(() => {
    jest.resetAllMocks();
    request = jest.fn();
    service = new GireveComplianceService(new Logger({ type: 'hidden' }), {
      request,
    } as any);
    fromGraphql.mockImplementation((raw) => mappedLocation(raw));
    toPartial.mockReturnValue({});
    missingRequiredFields.mockReturnValue([]);
  });

  it('pages through all our locations, OCPI-disabled ones included', async () => {
    const firstPage = Array.from(
      { length: GireveComplianceService.PAGE_SIZE },
      (_, i) => rawLocation(i + 1),
    );
    serve(firstPage, [rawLocation(1000)]);

    const report = await service.getReport();

    expect(report.locations).toHaveLength(
      GireveComplianceService.PAGE_SIZE + 1,
    );
    expect(request).toHaveBeenCalledTimes(2);
    const variables = request.mock.calls[1][1];
    expect(variables.offset).toBe(GireveComplianceService.PAGE_SIZE);
    expect(variables.where).not.toHaveProperty('_or');
    expect(variables.where).not.toHaveProperty('Tenant');
    expect(variables.where).toMatchObject({
      ownerTenantPartnerId: { _is_null: true },
      roamingPartnerId: { _is_null: true },
      deletedAt: { _is_null: true },
    });
  });

  it('reports a compliant location with no issue and its published counts', async () => {
    serve([rawLocation(1, { disableOCPI: true })]);

    const [location] = (await service.getReport()).locations;

    expect(location).toMatchObject({
      locationId: 1,
      name: 'Location 1',
      disableOCPI: true,
      countryCode: 'FR',
      partyId: 'ZET',
      evseCount: 1,
      connectorCount: 1,
      counts: { error: 0, warning: 0, info: 0 },
      issues: [],
    });
  });

  it('maps a location without coordinates and still runs the other rules', async () => {
    serve([rawLocation(1, { coordinates: null })]);
    fromGraphql.mockImplementation((raw) =>
      mappedLocation(raw, { evse_id: null }),
    );

    const [location] = (await service.getReport()).locations;

    expect(fromGraphql.mock.calls[0][0].coordinates.coordinates).toEqual([
      0, 0,
    ]);
    expect(location.issues.map((i) => i.code)).toEqual([
      'COORDINATES_MISSING',
      'EVSE_ID_MISSING',
    ]);
  });

  it('turns a mapping failure into one issue without dropping the other locations', async () => {
    serve([rawLocation(1), rawLocation(2)]);
    fromGraphql.mockImplementationOnce(() => {
      throw new TypeError(
        "Cannot read properties of null (reading 'countryCode')",
      );
    });

    const report = await service.getReport();

    expect(report.locations).toHaveLength(2);
    expect(report.locations[0].issues).toEqual([
      expect.objectContaining({
        code: 'LOCATION_MAPPING_FAILED',
        level: 'ERROR',
        message: expect.stringContaining('countryCode'),
      }),
    ]);
    expect(report.locations[1].counts.error).toBe(0);
  });

  it('describes connectors the mapper drops, telling missing from unknown values', async () => {
    serve([rawLocation(1)]);
    fromGraphql.mockImplementation((raw) =>
      mappedLocation(raw, { connectors: [] }),
    );
    missingRequiredFields.mockReturnValue(['standard', 'max_voltage']);

    const [location] = (await service.getReport()).locations;

    expect(location.issues).toEqual([
      expect.objectContaining({
        code: 'EVSE_NO_VALID_CONNECTOR',
        evseUid: 'SN1::1',
        message: expect.stringContaining(
          'connector 10: standard unknown ("IEC62196T2COMBO"), max_voltage missing',
        ),
      }),
    ]);
  });

  it('checks REMOVED EVSEs of an OCPI-disabled location', async () => {
    serve([rawLocation(1, { disableOCPI: true })]);
    fromGraphql.mockImplementation((raw) =>
      mappedLocation(raw, { status: EvseStatus.REMOVED, evse_id: null }),
    );

    const [location] = (await service.getReport()).locations;

    expect(location.issues.map((i) => i.code)).toEqual(['EVSE_ID_MISSING']);
  });

  it('reports an evse_id duplicated between an enabled and a disabled location', async () => {
    serve([rawLocation(1), rawLocation(2, { disableOCPI: true })]);
    fromGraphql.mockImplementation((raw) =>
      mappedLocation(raw, { evse_id: 'FR*ZET*ESAME*1' }),
    );

    const report = await service.getReport();

    for (const location of report.locations) {
      expect(location.issues).toEqual([
        expect.objectContaining({ code: 'EVSE_ID_DUPLICATE' }),
      ]);
    }
  });
});
