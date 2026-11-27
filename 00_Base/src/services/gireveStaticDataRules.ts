// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// Rules from Gireve "How to read the Static Data Error Report" v1.1 (10/2025).
// Codes are a contract with the ocpi-monitor UI: deprecate them, never rename them.

import type { LocationDTO } from '../model/DTO/LocationDTO.js';
import type { EvseDTO } from '../model/DTO/EvseDTO.js';
import type { ConnectorDTO } from '../model/DTO/ConnectorDTO.js';
import type {
  ComplianceCounts,
  ComplianceIssue,
  ComplianceLevel,
} from '../model/DTO/GireveComplianceDTO.js';
import { Capability } from '../model/Capability.js';
import { ConnectorFormat } from '../model/ConnectorFormat.js';
import { ConnectorType } from '../model/ConnectorType.js';
import { EvseStatus } from '../model/EvseStatus.js';
import { PowerType } from '../model/PowerType.js';

export const GIREVE_RULES_VERSION = 'gireve-static-data-error-report-1.1';

type RuleDefinition = { level: ComplianceLevel; ref: string };

export const GIREVE_RULES = {
  LOCATION_MAPPING_FAILED: {
    level: 'ERROR',
    ref: 'internal: location could not be mapped to OCPI',
  },
  COORDINATES_MISSING: { level: 'ERROR', ref: 'Empty Coordinate' },
  COORDINATES_ZERO: { level: 'ERROR', ref: 'Empty Coordinate' },
  COORDINATES_OUT_OF_RANGE: { level: 'ERROR', ref: 'Bad Coordinate' },
  COORDINATES_PRECISION: {
    level: 'ERROR',
    ref: 'Bad Coordinate (OCPI GeoLocation: 5 to 7 decimals)',
  },
  EVSE_ID_MISSING: { level: 'ERROR', ref: "Missing 'evse_id'" },
  EVSE_ID_NOT_EMI3: {
    level: 'ERROR',
    ref: "Invalid 'evse_id' / EMI3 Mismatch",
  },
  EVSE_ID_DUPLICATE: { level: 'ERROR', ref: 'EMI3 Duplication' },
  EVSE_CAPABILITY_MISSING: {
    level: 'ERROR',
    ref: 'No AuthMode / No PayMode',
  },
  EVSE_NO_VALID_CONNECTOR: { level: 'ERROR', ref: 'No valid Connector Type' },
  EVSE_DUPLICATE_CONNECTOR_STANDARD: {
    level: 'ERROR',
    ref: 'No valid Connector Type (2 same types on one EVSE)',
  },
  CONNECTOR_DC_STANDARD: {
    level: 'ERROR',
    ref: 'No valid Connector Type (DC: CHADEMO or IEC_62196_T2_COMBO)',
  },
  CONNECTOR_COMBO_SOCKET: {
    level: 'ERROR',
    ref: 'No valid Connector Type (Combo cannot be a SOCKET)',
  },
  CONNECTOR_POWER_INCONSISTENT: {
    level: 'ERROR',
    ref: 'Electrical Error (max_electric_power above calculated power)',
  },
  CONNECTOR_INVALID: {
    level: 'WARNING',
    ref: 'internal: connector dropped from the published EVSE',
  },
  CONNECTOR_TARIFF_MISSING: {
    level: 'WARNING',
    ref: "Missing 'evses.connectors.tariff_id'",
  },
  CONNECTOR_MAX_POWER_MISSING: {
    level: 'WARNING',
    ref: 'Electrical Warning (max_electric_power of 0)',
  },
  CONNECTOR_DC_AMPERAGE_LOW: {
    level: 'WARNING',
    ref: 'Electrical Warning (DC amperage below 32)',
  },
  LOCATION_OWNER_NAME_MISSING: {
    level: 'WARNING',
    ref: "Missing 'owner.name'",
  },
  LOCATION_OPENING_TIMES_MISSING: { level: 'WARNING', ref: 'Hours missing' },
  LOCATION_REGULAR_HOURS_TOO_MANY_SLOTS: {
    level: 'WARNING',
    ref: 'Too many slots',
  },
  EVSE_FLOOR_LEVEL_NOT_INTEGER: {
    level: 'WARNING',
    ref: 'Non-Numeric Floor Level',
  },
  EVSE_STATUS_PLANNED: { level: 'WARNING', ref: 'Planned' },
  LOCATION_TIME_ZONE_NOT_PARIS: {
    level: 'INFO',
    ref: 'internal: French location not in Europe/Paris',
  },
  LOCATION_PARKING_TYPE_MISSING: {
    level: 'INFO',
    ref: 'internal: parking_type not set',
  },
  EVSE_STATUS_REMOVED: {
    level: 'INFO',
    ref: 'Disappeared (REMOVED EVSEs are not checked)',
  },
} as const satisfies Record<string, RuleDefinition>;

export type GireveRuleCode = keyof typeof GIREVE_RULES;

export interface RejectedConnectorProblem {
  field: string;
  reason: 'missing' | 'unknown_value';
  raw?: unknown;
}

export interface RejectedConnector {
  evseUid: string;
  connectorId: string;
  problems: RejectedConnectorProblem[];
}

export interface LocationComplianceInput {
  // Coordinates are absent when the location has none in the database.
  location: Omit<LocationDTO, 'coordinates'> & {
    coordinates?: LocationDTO['coordinates'];
  };
  rejectedConnectors: RejectedConnector[];
  // OCPI-disabled locations have all their EVSEs REMOVED: check them as if roaming were on.
  checkRemovedEvses: boolean;
}

const AUTH_OR_PAYMENT_CAPABILITIES: ReadonlySet<string> = new Set([
  Capability.RFID_READER,
  Capability.REMOTE_START_STOP_CAPABLE,
  Capability.CREDIT_CARD_PAYABLE,
  Capability.DEBIT_CARD_PAYABLE,
  Capability.PED_TERMINAL,
  Capability.CHIP_CARD_SUPPORT,
  Capability.CONTACTLESS_CARD_SUPPORT,
]);
const DC_STANDARDS: ReadonlySet<string> = new Set([
  ConnectorType.IEC_62196_T2_COMBO,
  ConnectorType.CHADEMO,
]);
const COMBO_STANDARDS: ReadonlySet<string> = new Set([
  ConnectorType.IEC_62196_T1_COMBO,
  ConnectorType.IEC_62196_T2_COMBO,
]);
const LATITUDE_PATTERN = /^-?\d{1,2}\.\d{5,7}$/;
const LONGITUDE_PATTERN = /^-?\d{1,3}\.\d{5,7}$/;
const INTEGER_PATTERN = /^-?\d+$/;
const LEVEL_ORDER: Record<ComplianceLevel, number> = {
  ERROR: 0,
  WARNING: 1,
  INFO: 2,
};

type IssueContext = Pick<
  ComplianceIssue,
  'evseUid' | 'evseId' | 'connectorId' | 'field' | 'value'
>;

function issue(
  code: GireveRuleCode,
  message: string,
  context: IssueContext = {},
): ComplianceIssue {
  return { level: GIREVE_RULES[code].level, code, message, ...context };
}

// AC voltage is line-to-neutral (230 V), so multi-phase power multiplies by the phase count.
function phaseCount(powerType: PowerType): number {
  if (powerType === PowerType.AC_3_PHASE) return 3;
  if (
    powerType === PowerType.AC_2_PHASE ||
    powerType === PowerType.AC_2_PHASE_SPLIT
  ) {
    return 2;
  }
  return 1;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function emi3Pattern(countryCode?: string, partyId?: string): RegExp {
  const country = countryCode ? escapeRegExp(countryCode) : '[A-Z]{2}';
  const party = partyId ? escapeRegExp(partyId) : '[A-Z0-9]{3}';
  return new RegExp(
    `^${country}\\*?${party}\\*?E[A-Z0-9][A-Z0-9*]{0,30}$`,
    'i',
  );
}

function checkCoordinates(
  coordinates: LocationDTO['coordinates'] | null | undefined,
  context: IssueContext,
): ComplianceIssue[] {
  if (!coordinates) {
    return [issue('COORDINATES_MISSING', 'No coordinates', context)];
  }
  const value = `${coordinates.latitude},${coordinates.longitude}`;
  const latitude = Number(coordinates.latitude);
  const longitude = Number(coordinates.longitude);
  if (latitude === 0 && longitude === 0) {
    return [
      issue('COORDINATES_ZERO', 'Coordinates are 0,0', { ...context, value }),
    ];
  }
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return [
      issue('COORDINATES_OUT_OF_RANGE', `Invalid coordinates ${value}`, {
        ...context,
        value,
      }),
    ];
  }
  if (
    !LATITUDE_PATTERN.test(coordinates.latitude) ||
    !LONGITUDE_PATTERN.test(coordinates.longitude)
  ) {
    return [
      issue(
        'COORDINATES_PRECISION',
        `Coordinates ${value} must have 5 to 7 decimals`,
        { ...context, value },
      ),
    ];
  }
  return [];
}

function describeRejected(rejected: RejectedConnector): string {
  const problems = rejected.problems.map((problem) =>
    problem.reason === 'missing'
      ? `${problem.field} missing`
      : `${problem.field} unknown (${JSON.stringify(problem.raw)})`,
  );
  return `connector ${rejected.connectorId}: ${problems.join(', ')}`;
}

function checkConnector(
  connector: ConnectorDTO,
  context: IssueContext,
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const isDc = connector.power_type === PowerType.DC;
  if (!connector.tariff_ids?.length) {
    issues.push(issue('CONNECTOR_TARIFF_MISSING', 'No tariff_ids', context));
  }
  if (isDc && !DC_STANDARDS.has(connector.standard)) {
    issues.push(
      issue(
        'CONNECTOR_DC_STANDARD',
        `DC connector with standard ${connector.standard}`,
        { ...context, field: 'standard', value: connector.standard },
      ),
    );
  }
  if (
    COMBO_STANDARDS.has(connector.standard) &&
    connector.format === ConnectorFormat.SOCKET
  ) {
    issues.push(
      issue('CONNECTOR_COMBO_SOCKET', `${connector.standard} as a SOCKET`, {
        ...context,
        field: 'format',
        value: connector.format,
      }),
    );
  }
  if (!connector.max_electric_power) {
    issues.push(
      issue('CONNECTOR_MAX_POWER_MISSING', 'max_electric_power missing or 0', {
        ...context,
        field: 'max_electric_power',
      }),
    );
  } else {
    const ratedWatts =
      connector.max_voltage *
      connector.max_amperage *
      phaseCount(connector.power_type);
    if (connector.max_electric_power > ratedWatts) {
      issues.push(
        issue(
          'CONNECTOR_POWER_INCONSISTENT',
          `max_electric_power ${connector.max_electric_power} W above ` +
            `${connector.max_voltage} V x ${connector.max_amperage} A ` +
            `(${connector.power_type}) = ${ratedWatts} W`,
          {
            ...context,
            field: 'max_electric_power',
            value: connector.max_electric_power,
          },
        ),
      );
    }
  }
  if (isDc && connector.max_amperage < 32) {
    issues.push(
      issue(
        'CONNECTOR_DC_AMPERAGE_LOW',
        `DC amperage ${connector.max_amperage} A below 32 A`,
        { ...context, field: 'max_amperage', value: connector.max_amperage },
      ),
    );
  }
  return issues;
}

function checkEvse(
  evse: EvseDTO,
  location: LocationComplianceInput['location'],
  rejectedConnectors: RejectedConnector[],
): ComplianceIssue[] {
  const context: IssueContext = {
    evseUid: evse.uid,
    evseId: evse.evse_id ?? null,
  };
  const issues: ComplianceIssue[] = [];

  if (evse.status === EvseStatus.PLANNED) {
    issues.push(
      issue('EVSE_STATUS_PLANNED', 'EVSE status is PLANNED', context),
    );
  }
  if (!evse.evse_id) {
    issues.push(issue('EVSE_ID_MISSING', 'No evse_id', context));
  } else if (
    !emi3Pattern(location.country_code, location.party_id).test(evse.evse_id)
  ) {
    issues.push(
      issue(
        'EVSE_ID_NOT_EMI3',
        `evse_id ${evse.evse_id} is not eMI3 ` +
          `(expected ${location.country_code}*${location.party_id}*E...)`,
        { ...context, field: 'evse_id', value: evse.evse_id },
      ),
    );
  }
  if (
    !(evse.capabilities ?? []).some((capability) =>
      AUTH_OR_PAYMENT_CAPABILITIES.has(capability),
    )
  ) {
    issues.push(
      issue(
        'EVSE_CAPABILITY_MISSING',
        'No authorization or payment capability',
        { ...context, field: 'capabilities' },
      ),
    );
  }
  if (evse.floor_level != null && !INTEGER_PATTERN.test(evse.floor_level)) {
    issues.push(
      issue(
        'EVSE_FLOOR_LEVEL_NOT_INTEGER',
        `floor_level ${evse.floor_level} is not an integer`,
        { ...context, field: 'floor_level', value: evse.floor_level },
      ),
    );
  }
  if (evse.coordinates) {
    issues.push(
      ...checkCoordinates(evse.coordinates, {
        ...context,
        field: 'evses[].coordinates',
      }),
    );
  }

  const connectors = evse.connectors ?? [];
  const rejected = rejectedConnectors.filter((r) => r.evseUid === evse.uid);
  if (connectors.length === 0) {
    const reasons = rejected.map(describeRejected);
    issues.push(
      issue(
        'EVSE_NO_VALID_CONNECTOR',
        reasons.length
          ? `No publishable connector (${reasons.join('; ')})`
          : 'No connector configured',
        context,
      ),
    );
  } else {
    for (const r of rejected) {
      issues.push(
        issue('CONNECTOR_INVALID', `Not published: ${describeRejected(r)}`, {
          ...context,
          connectorId: r.connectorId,
        }),
      );
    }
  }

  const standardCounts = new Map<string, number>();
  for (const connector of connectors) {
    standardCounts.set(
      connector.standard,
      (standardCounts.get(connector.standard) ?? 0) + 1,
    );
  }
  for (const [standard, count] of standardCounts) {
    if (count > 1) {
      issues.push(
        issue(
          'EVSE_DUPLICATE_CONNECTOR_STANDARD',
          `${count} connectors with standard ${standard} on one EVSE`,
          { ...context, field: 'connectors[].standard', value: standard },
        ),
      );
    }
  }

  for (const connector of connectors) {
    issues.push(
      ...checkConnector(connector, { ...context, connectorId: connector.id }),
    );
  }
  return issues;
}

export function checkLocation(
  input: LocationComplianceInput,
): ComplianceIssue[] {
  const { location } = input;
  const issues: ComplianceIssue[] = [
    ...checkCoordinates(location.coordinates, { field: 'coordinates' }),
  ];

  if (!location.owner?.name?.trim()) {
    issues.push(
      issue('LOCATION_OWNER_NAME_MISSING', 'No owner.name', {
        field: 'owner.name',
      }),
    );
  }
  const openingTimes = location.opening_times;
  if (!openingTimes) {
    issues.push(
      issue(
        'LOCATION_OPENING_TIMES_MISSING',
        'No opening_times (neither 24/7 nor regular hours)',
        { field: 'opening_times' },
      ),
    );
  } else if (!openingTimes.twentyfourseven) {
    const slotsPerWeekday = new Map<number, number>();
    for (const slot of openingTimes.regular_hours ?? []) {
      slotsPerWeekday.set(
        slot.weekday,
        (slotsPerWeekday.get(slot.weekday) ?? 0) + 1,
      );
    }
    for (const [weekday, slots] of slotsPerWeekday) {
      if (slots > 2) {
        issues.push(
          issue(
            'LOCATION_REGULAR_HOURS_TOO_MANY_SLOTS',
            `${slots} opening slots on weekday ${weekday} (Gireve keeps 2)`,
            { field: 'opening_times.regular_hours', value: weekday },
          ),
        );
      }
    }
  }
  if (location.country === 'FRA' && location.time_zone !== 'Europe/Paris') {
    issues.push(
      issue(
        'LOCATION_TIME_ZONE_NOT_PARIS',
        `time_zone is ${location.time_zone}`,
        { field: 'time_zone', value: location.time_zone },
      ),
    );
  }
  if (!location.parking_type) {
    issues.push(
      issue('LOCATION_PARKING_TYPE_MISSING', 'No parking_type', {
        field: 'parking_type',
      }),
    );
  }

  for (const evse of location.evses ?? []) {
    if (evse.status === EvseStatus.REMOVED && !input.checkRemovedEvses) {
      issues.push(
        issue('EVSE_STATUS_REMOVED', 'EVSE is REMOVED and not checked', {
          evseUid: evse.uid,
          evseId: evse.evse_id ?? null,
        }),
      );
      continue;
    }
    issues.push(...checkEvse(evse, location, input.rejectedConnectors));
  }
  return sortIssues(issues);
}

export interface DuplicateCheckEntry {
  locationId: number;
  location: Pick<LocationDTO, 'evses'>;
  checkRemovedEvses: boolean;
}

export function findDuplicateEvseIds(
  entries: DuplicateCheckEntry[],
): Map<number, ComplianceIssue[]> {
  const occurrences = new Map<
    string,
    Array<{ locationId: number; evseUid: string; evseId: string }>
  >();
  for (const entry of entries) {
    for (const evse of entry.location.evses ?? []) {
      if (!evse.evse_id) continue;
      if (evse.status === EvseStatus.REMOVED && !entry.checkRemovedEvses) {
        continue;
      }
      // Gireve compares eMI3 ids ignoring separators and case.
      const key = evse.evse_id.replace(/\*/g, '').toUpperCase();
      const list = occurrences.get(key) ?? [];
      list.push({
        locationId: entry.locationId,
        evseUid: evse.uid,
        evseId: evse.evse_id,
      });
      occurrences.set(key, list);
    }
  }

  const byLocation = new Map<number, ComplianceIssue[]>();
  for (const list of occurrences.values()) {
    if (list.length < 2) continue;
    for (const current of list) {
      const others = list
        .filter((other) => other !== current)
        .map((other) => `EVSE ${other.evseUid} (location ${other.locationId})`);
      const issues = byLocation.get(current.locationId) ?? [];
      issues.push(
        issue(
          'EVSE_ID_DUPLICATE',
          `evse_id ${current.evseId} is also used by ${others.join(', ')}`,
          {
            evseUid: current.evseUid,
            evseId: current.evseId,
            field: 'evse_id',
            value: current.evseId,
          },
        ),
      );
      byLocation.set(current.locationId, issues);
    }
  }
  return byLocation;
}

export function sortIssues(issues: ComplianceIssue[]): ComplianceIssue[] {
  return [...issues].sort(
    (a, b) =>
      LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
      Number(a.evseUid !== undefined) - Number(b.evseUid !== undefined) ||
      (a.evseUid ?? '').localeCompare(b.evseUid ?? '') ||
      (a.connectorId ?? '').localeCompare(b.connectorId ?? ''),
  );
}

export function countIssues(issues: ComplianceIssue[]): ComplianceCounts {
  return {
    error: issues.filter((i) => i.level === 'ERROR').length,
    warning: issues.filter((i) => i.level === 'WARNING').length,
    info: issues.filter((i) => i.level === 'INFO').length,
  };
}
