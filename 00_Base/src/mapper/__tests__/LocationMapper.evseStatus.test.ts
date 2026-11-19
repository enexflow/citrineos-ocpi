// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// @zetra/citrineos-base is ESM-only and Jest's CJS runtime cannot parse it
// (see SessionMapper.test.ts): stub the enums LocationMapper uses.
jest.mock('@zetra/citrineos-base', () => ({
  ConnectorStatusEnum: {
    Available: 'Available',
    Occupied: 'Occupied',
    Preparing: 'Preparing',
    Charging: 'Charging',
    SuspendedEVSE: 'SuspendedEVSE',
    SuspendedEV: 'SuspendedEV',
    Finishing: 'Finishing',
    Reserved: 'Reserved',
    Unavailable: 'Unavailable',
    Faulted: 'Faulted',
    Unknown: 'Unknown',
  },
  ChargingStationCapabilityEnum: {},
  ChargingStationParkingRestrictionEnum: {},
  ConnectorFormatEnum: {},
  ConnectorPowerTypeEnum: {},
  ConnectorTypeEnum: {},
  LocationFacilityEnum: {},
  LocationParkingEnum: {},
  LocationHours: class {},
}));

import type { ConnectorDto } from '@zetra/citrineos-base';
import { EvseMapper } from '../LocationMapper';
import { EvseStatus } from '../../model/EvseStatus';

const connector = (
  id: number,
  status: string,
  disableOCPI?: boolean | null,
): ConnectorDto =>
  ({ id, evseId: 1, status, disableOCPI }) as unknown as ConnectorDto;

describe('EvseMapper connector disableOCPI', () => {
  describe('isConnectorOcpiEnabled', () => {
    it('treats null / undefined / false as enabled', () => {
      expect(EvseMapper.isConnectorOcpiEnabled(connector(1, 'Available'))).toBe(
        true,
      );
      expect(
        EvseMapper.isConnectorOcpiEnabled(connector(1, 'Available', null)),
      ).toBe(true);
      expect(
        EvseMapper.isConnectorOcpiEnabled(connector(1, 'Available', false)),
      ).toBe(true);
    });

    it('treats true as disabled', () => {
      expect(
        EvseMapper.isConnectorOcpiEnabled(connector(1, 'Available', true)),
      ).toBe(false);
    });
  });

  describe('mapEvseStatusFromConnectors', () => {
    it('ignores a disabled connector that would otherwise win (Charging)', () => {
      // phantom connector 1 stuck in Charging, real connector 11 Available
      const status = EvseMapper.mapEvseStatusFromConnectors([
        connector(1, 'Charging', true),
        connector(11, 'Available'),
      ]);
      expect(status).toBe(EvseStatus.AVAILABLE);
    });

    it('ignores a disabled Available connector next to a Faulted real one', () => {
      const status = EvseMapper.mapEvseStatusFromConnectors([
        connector(1, 'Available', true),
        connector(11, 'Faulted', false),
      ]);
      expect(status).toBe(EvseStatus.OUTOFORDER);
    });

    it('returns UNKNOWN when every connector is disabled', () => {
      const status = EvseMapper.mapEvseStatusFromConnectors([
        connector(1, 'Available', true),
        connector(2, 'Available', true),
      ]);
      expect(status).toBe(EvseStatus.UNKNOWN);
    });

    it('still uses connectors without the flag (column not selected)', () => {
      const status = EvseMapper.mapEvseStatusFromConnectors([
        connector(11, 'Charging'),
        connector(12, 'Available', null),
      ]);
      expect(status).toBe(EvseStatus.CHARGING);
    });

    it('does not count an active transaction on a disabled connector', () => {
      const status = EvseMapper.mapEvseStatusFromConnectors(
        [connector(1, 'Occupied', true), connector(11, 'Unavailable')],
        new Set([1]),
      );
      expect(status).toBe(EvseStatus.INOPERATIVE);
    });
  });
});
