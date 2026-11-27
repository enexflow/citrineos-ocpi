// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import { Service } from 'typedi';
import type { ConnectorDto, LocationDto } from '@zetra/citrineos-base';
import type {
  GetOurLocationsQueryResult,
  GetOurLocationsQueryVariables,
} from '../graphql/index.js';
import {
  GET_OUR_LOCATIONS_QUERY,
  OcpiGraphqlClient,
} from '../graphql/index.js';
import { ConnectorMapper, LocationMapper } from '../mapper/index.js';
import { UID_FORMAT } from '../model/DTO/EvseDTO.js';
import type {
  ComplianceIssue,
  GireveComplianceReport,
  LocationCompliance,
} from '../model/DTO/GireveComplianceDTO.js';
import { buildOurLocationsWhere } from './ourLocationsWhere.js';
import {
  checkLocation,
  countIssues,
  findDuplicateEvseIds,
  GIREVE_RULES,
  GIREVE_RULES_VERSION,
  sortIssues,
} from './gireveStaticDataRules.js';
import type {
  LocationComplianceInput,
  RejectedConnector,
  RejectedConnectorProblem,
} from './gireveStaticDataRules.js';

type RawLocation = GetOurLocationsQueryResult['Locations'][number];
type RawConnector = NonNullable<
  NonNullable<
    NonNullable<RawLocation['chargingPool']>[number]['evses']
  >[number]['connectors']
>[number];

interface EvaluatedLocation {
  raw: RawLocation;
  location?: LocationComplianceInput['location'];
  checkRemovedEvses: boolean;
  issues: ComplianceIssue[];
}

// Raw columns behind the connector fields that ConnectorMapper maps from an enum.
const ENUM_FIELD_SOURCES: Record<string, keyof RawConnector> = {
  standard: 'type',
  format: 'format',
  power_type: 'powerType',
};

@Service()
export class GireveComplianceService {
  static readonly PAGE_SIZE = 100;

  constructor(
    private logger: Logger<ILogObj>,
    private ocpiGraphqlClient: OcpiGraphqlClient,
  ) {}

  async getReport(): Promise<GireveComplianceReport> {
    const startedAt = Date.now();
    const evaluated = (await this.fetchAllOurLocations()).map((raw) =>
      this.evaluate(raw),
    );
    const duplicates = findDuplicateEvseIds(
      evaluated.flatMap((e) =>
        e.location
          ? [
              {
                locationId: e.raw.id,
                location: e.location,
                checkRemovedEvses: e.checkRemovedEvses,
              },
            ]
          : [],
      ),
    );
    const locations = evaluated.map((e) =>
      this.toLocationCompliance(e, duplicates.get(e.raw.id) ?? []),
    );
    this.logger.info(
      `Gireve compliance report built for ${locations.length} locations in ${Date.now() - startedAt} ms`,
    );
    return {
      generatedAt: new Date().toISOString(),
      rulesVersion: GIREVE_RULES_VERSION,
      locations,
    };
  }

  private async fetchAllOurLocations(): Promise<RawLocation[]> {
    const where = buildOurLocationsWhere({ includeOcpiDisabled: true });
    const locations: RawLocation[] = [];
    for (let offset = 0; ; offset += GireveComplianceService.PAGE_SIZE) {
      const response = await this.ocpiGraphqlClient.request<
        GetOurLocationsQueryResult,
        GetOurLocationsQueryVariables
      >(GET_OUR_LOCATIONS_QUERY, {
        limit: GireveComplianceService.PAGE_SIZE,
        offset,
        where,
      });
      locations.push(...response.Locations);
      if (response.Locations.length < GireveComplianceService.PAGE_SIZE) {
        return locations;
      }
    }
  }

  private evaluate(raw: RawLocation): EvaluatedLocation {
    const checkRemovedEvses = raw.disableOCPI === true;
    try {
      const hasCoordinates =
        Array.isArray(raw.coordinates?.coordinates) &&
        raw.coordinates.coordinates.length >= 2;
      // LocationMapper dereferences coordinates: map with a placeholder, then report them missing.
      const mappable = hasCoordinates
        ? raw
        : { ...raw, coordinates: { type: 'Point', coordinates: [0, 0] } };
      const dto = LocationMapper.fromGraphql(
        mappable as unknown as LocationDto,
      );
      const location: LocationComplianceInput['location'] = hasCoordinates
        ? dto
        : { ...dto, coordinates: undefined };
      return {
        raw,
        location,
        checkRemovedEvses,
        issues: checkLocation({
          location,
          rejectedConnectors: this.findRejectedConnectors(raw),
          checkRemovedEvses,
        }),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Gireve compliance: location ${raw.id} could not be mapped: ${reason}`,
      );
      return {
        raw,
        checkRemovedEvses,
        issues: [
          {
            level: GIREVE_RULES.LOCATION_MAPPING_FAILED.level,
            code: 'LOCATION_MAPPING_FAILED',
            message: `Location could not be mapped to OCPI: ${reason}`,
          },
        ],
      };
    }
  }

  private findRejectedConnectors(raw: RawLocation): RejectedConnector[] {
    const rejected: RejectedConnector[] = [];
    for (const station of raw.chargingPool ?? []) {
      for (const evse of station.evses ?? []) {
        for (const connector of evse.connectors ?? []) {
          const partial = ConnectorMapper.toPartial(
            connector as unknown as ConnectorDto,
          );
          const missing = ConnectorMapper.missingRequiredFields(partial);
          if (missing.length === 0) continue;
          rejected.push({
            evseUid: UID_FORMAT(station.id, evse.evseTypeId!),
            connectorId: connector.id.toString(),
            problems: missing.map((field) =>
              this.describeProblem(field, connector),
            ),
          });
        }
      }
    }
    return rejected;
  }

  private describeProblem(
    field: string,
    connector: RawConnector,
  ): RejectedConnectorProblem {
    const source = ENUM_FIELD_SOURCES[field];
    const raw = source ? connector[source] : undefined;
    return raw != null && raw !== ''
      ? { field, reason: 'unknown_value', raw }
      : { field, reason: 'missing' };
  }

  private toLocationCompliance(
    evaluated: EvaluatedLocation,
    duplicateIssues: ComplianceIssue[],
  ): LocationCompliance {
    const issues = sortIssues([...evaluated.issues, ...duplicateIssues]);
    const evses = evaluated.location?.evses ?? [];
    return {
      locationId: evaluated.raw.id,
      name: evaluated.raw.name ?? null,
      disableOCPI: evaluated.raw.disableOCPI === true,
      countryCode: evaluated.raw.tenant?.countryCode ?? null,
      partyId: evaluated.raw.tenant?.partyId ?? null,
      evseCount: evses.length,
      connectorCount: evses.reduce(
        (total, evse) => total + (evse.connectors?.length ?? 0),
        0,
      ),
      counts: countIssues(issues),
      issues,
    };
  }
}
