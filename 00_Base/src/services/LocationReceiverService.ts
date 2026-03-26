// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { UnauthorizedException } from '@citrineos/base';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import { Service } from 'typedi';
import { EvseStatus } from '../model/EvseStatus.js';

import type {
  LocationResponse,
  PaginatedLocationResponse,
} from '../model/DTO/LocationDTO.js';
import type { EvseResponse } from '../model/DTO/EvseDTO.js';
import type {
  ConnectorDTO,
  ConnectorResponse,
} from '../model/DTO/ConnectorDTO.js';
import { PaginatedParams } from '../controllers/param/PaginatedParams.js';
import {
  buildOcpiPaginatedResponse,
  DEFAULT_LIMIT,
  DEFAULT_OFFSET,
} from '../model/PaginatedResponse.js';
import {
  buildOcpiResponse,
  OcpiResponseStatusCode,
} from '../model/OcpiResponse.js';
import { buildOcpiErrorResponse } from '../model/OcpiErrorResponse.js';
import { OcpiHeaders } from '../model/OcpiHeaders.js';
import { NotFoundException } from '../exception/NotFoundException.js';
import type {
  InsertChargingStationMutationResult,
  InsertChargingStationMutationVariables,
  UpsertLocationMutationResult,
  UpsertLocationMutationVariables,
  UpsertEvseMutationResult,
  UpsertEvseMutationVariables,
  GetLocationByOcpiIdAndPartnerIdQueryResult,
  GetLocationByOcpiIdAndPartnerIdQueryVariables,
  UpsertConnectorMutationVariables,
  GetEvseByLocationAndOwnerPartnerQueryResult,
  GetEvseByLocationAndOwnerPartnerQueryVariables,
  UpdateLocationPatchMutationVariables,
  UpdateLocationPatchMutationResult,
  GetEvseByOcpiIdAndPartnerIdQueryResult,
  GetEvseByOcpiIdAndPartnerIdQueryVariables,
  UpdateEvsePatchMutationResult,
  UpdateEvsePatchMutationVariables,
  GetPartnerLocationByOcpiIdQueryResult,
  GetPartnerLocationByOcpiIdQueryVariables,
  GetPartnerConnectorByOcpiIdAndEvseIdQueryResult,
  GetPartnerConnectorByOcpiIdAndEvseIdQueryVariables,
  UpdateConnectorPatchMutationVariables,
  UpdateConnectorPatchMutationResult,
  GetPartnerEvseByOcpiIdsQueryVariables,
  GetPartnerEvseByOcpiIdsQueryResult,
} from '../graphql/index.js';
import {
  OcpiGraphqlClient,
  GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY,
  GET_EVSE_BY_LOCATION_ID_AND_OWNER_PARTNER_ID,
  UPSERT_EVSE_MUTATION,
  UPSERT_CONNECTOR_MUTATION,
  INSERT_CHARGING_STATION_MUTATION,
  UPSERT_LOCATION_MUTATION,
  GET_CHARGING_STATION_BY_LOCATION_ID_AND_OWNER_PARTNER_ID,
  GET_PARTNER_LOCATION_BY_OCPI_ID,
  UPDATE_LOCATION_PATCH_MUTATION,
  UPDATE_EVSE_PATCH_MUTATION,
  GET_PARTNER_EVSE_BY_OCPI_ID,
  GET_PARTNER_CONNECTOR_BY_OCPI_ID_AND_EVSE_ID,
  GET_CONNECTOR_BY_OCPI_ID_AND_EVSE_ID,
  UPDATE_CONNECTOR_PATCH_MUTATION,
  GET_EVSE_BY_OCPI_ID_AND_PARTNER_ID_QUERY,
} from '../graphql/index.js';
import {
  ConnectorMapper,
  EvseMapper,
  LocationMapper,
} from '../mapper/index.js';
import type {
  ChargingStationDto,
  ConnectorDto,
  EvseDto,
  LocationDto,
  TenantPartnerDto,
} from '@citrineos/base';

import type { LocationDTO, LocationEvseDTO } from '../model/DTO/LocationDTO.js';

@Service()
export class LocationReceiverService {
  constructor(
    private logger: Logger<ILogObj>,
    private ocpiGraphqlClient: OcpiGraphqlClient,
  ) {}

  async getLocationByCountryPartyAndId(
    countryCode: string,
    partyId: string,
    locationId: string,
    tenantPartner: TenantPartnerDto,
  ): Promise<LocationResponse> {
    this.logger.debug(
      `Getting location ${locationId} by country ${countryCode} and party ${partyId}`,
    );
    try {
      if (!tenantPartner.id) {
        throw new UnauthorizedException(
          'Credentials not found for given token',
        );
      }
      const variables = {
        id: locationId,
        partnerId: tenantPartner.id,
      };
      const response = await this.ocpiGraphqlClient.request<
        GetLocationByOcpiIdAndPartnerIdQueryResult,
        GetLocationByOcpiIdAndPartnerIdQueryVariables
      >(GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY, variables);
      const location = LocationMapper.fromGraphqlReceiver(
        response.Locations[0] as LocationDto, // TODO: add proper types
      );
      return buildOcpiResponse(
        OcpiResponseStatusCode.GenericSuccessCode,
        location,
      ) as LocationResponse;
    } catch (e) {
      const statusCode =
        e instanceof NotFoundException
          ? OcpiResponseStatusCode.ClientUnknownLocation
          : OcpiResponseStatusCode.ClientGenericError;
      return buildOcpiErrorResponse(
        statusCode,
        (e as Error).message,
      ) as LocationResponse;
    }
  }

  async getEvseByCountryPartyAndId(
    countryCode: string,
    partyId: string,
    locationId: string,
    evseUid: string,
    tenantPartner: TenantPartnerDto,
  ): Promise<LocationResponse> {
    this.logger.debug(
      `Getting location ${locationId} by country ${countryCode} and party ${partyId}`,
    );
    try {
      if (!tenantPartner.id) {
        throw new UnauthorizedException(
          'Credentials not found for given token',
        );
      }
      const variables = {
        locationId: locationId,
        partnerId: tenantPartner.id,
        evseUid: evseUid,
      };
      console.log(
        'variables GET_EVSE_BY_OCPI_ID_AND_PARTNER_ID_QUERY ',
        variables,
      );
      const response = await this.ocpiGraphqlClient.request<
        GetEvseByOcpiIdAndPartnerIdQueryResult,
        GetEvseByOcpiIdAndPartnerIdQueryVariables
      >(GET_EVSE_BY_OCPI_ID_AND_PARTNER_ID_QUERY, variables);
      const evse = EvseMapper.fromGraphqlReceiver(
        response.Evses[0].ChargingStation as ChargingStationDto,
        response.Evses[0] as EvseDto,
      );
      return buildOcpiResponse(
        OcpiResponseStatusCode.GenericSuccessCode,
        evse,
      ) as LocationResponse;
    } catch (e) {
      const statusCode =
        e instanceof NotFoundException
          ? OcpiResponseStatusCode.ClientUnknownLocation
          : OcpiResponseStatusCode.ClientGenericError;
      return buildOcpiErrorResponse(
        statusCode,
        (e as Error).message,
      ) as LocationResponse;
    }
  }

  async getConnectorByCountryPartyAndId(
    countryCode: string,
    partyId: string,
    locationId: string,
    evseUid: string,
    connectorId: string,
    tenantPartner: TenantPartnerDto,
  ): Promise<LocationResponse> {
    this.logger.debug(
      `Getting location ${locationId} by country ${countryCode} and party ${partyId}`,
    );
    try {
      if (!tenantPartner) {
        throw new UnauthorizedException(
          'Credentials not found for given token',
        );
      }
      const variables = {
        locationId: locationId,
        partnerId: tenantPartner.id,
        evseUid: evseUid,
        connectorId: connectorId,
      };
      console.log(
        'variables GET_CONNECTOR_BY_OCPI_ID_AND_PARTNER_ID_QUERY ',
        variables,
      );
      const response = await this.ocpiGraphqlClient.request<
        any,
        any // TODO: add proper types
      >(GET_CONNECTOR_BY_OCPI_ID_AND_EVSE_ID, variables);
      console.log(
        'response GET_CONNECTOR_BY_OCPI_ID_AND_PARTNER_ID_QUERY Graphql receiver',
        response,
      );
      const connector = ConnectorMapper.fromGraphqlReceiver(
        response.Connectors[0] as ConnectorDto,
      );
      return buildOcpiResponse(
        OcpiResponseStatusCode.GenericSuccessCode,
        connector,
      ) as LocationResponse;
    } catch (e) {
      const statusCode =
        e instanceof NotFoundException
          ? OcpiResponseStatusCode.ClientUnknownLocation
          : OcpiResponseStatusCode.ClientGenericError;
      return buildOcpiErrorResponse(
        statusCode,
        (e as Error).message,
      ) as LocationResponse;
    }
  }

  async upsertLocationForPartner(
    location: LocationDTO,
    locationId: string,
    tenantPartner: TenantPartnerDto,
  ): Promise<void> {
    const coordinates = {
      type: 'Point',
      coordinates: [
        Number(location.coordinates.longitude),
        Number(location.coordinates.latitude),
      ],
    };
    const response = await this.ocpiGraphqlClient.request<
      UpsertLocationMutationResult,
      UpsertLocationMutationVariables
    >(UPSERT_LOCATION_MUTATION, {
      object: {
        ocpiId: locationId,
        ownerTenantPartnerId: tenantPartner.id,
        tenantId: tenantPartner.tenantId,
        coordinates: coordinates,
        name: location.name,
        address: location.address,
        city: location.city,
        country: location.country,
        postalCode: location.postal_code,
        state: location.state ?? null,
        parkingType: location.parking_type ?? null,
        timeZone: location.time_zone ?? null,
        operator: location.operator ?? null,
        suboperator: location.suboperator ?? null,
        owner: location.owner ?? null,
        chargingWhenClosed: location.charging_when_closed ?? null,
        relatedLocations: location.related_locations ?? null,
        publishUpstream: location.publish ?? false,
        energyMix: location.energy_mix ?? null,
        openingHours: location.opening_times ?? null,
        facilities: location.facilities ?? null,
        images: location.images ?? null,
        directions: location.directions ?? null,
        createdAt: new Date(),
        updatedAt: location.last_updated ?? new Date(),
      },
    });

    if (!response.insert_Locations_one?.id) {
      throw new Error('Failed to insert location');
    }

    const stationIdVariables = {
      locationId: response.insert_Locations_one.id,
      partnerId: tenantPartner.id,
    };

    let idChargingStationAssociatedWithLocation = null;
    console.log(
      'BEFORE CREATE VIRTUAL CHARGING STATION I AM HERE !!!',
      response,
    );
    const stationIdFoundResponse = await this.ocpiGraphqlClient.request<
      any,
      any
    >(
      GET_CHARGING_STATION_BY_LOCATION_ID_AND_OWNER_PARTNER_ID,
      stationIdVariables,
    );
    console.log('stationIdFoundResponse ', stationIdFoundResponse);

    if (stationIdFoundResponse.ChargingStations.length === 0) {
      console.log(
        'creating virtual charging station for partner ',
        tenantPartner.id,
        ' and location ',
        locationId,
      );
      const responseCreateVirtualChargingStation =
        await this.createVirtualChargingStationForPartnerAndLocation(
          response.insert_Locations_one.id.toString(),
          tenantPartner,
        );
      idChargingStationAssociatedWithLocation =
        responseCreateVirtualChargingStation?.insert_ChargingStations_one?.id ??
        null;
    } else {
      idChargingStationAssociatedWithLocation =
        stationIdFoundResponse.ChargingStations[0].id ?? null;
    }
    console.log(
      'idChargingStationAssociatedWithLocation ',
      idChargingStationAssociatedWithLocation,
    );

    for (const evse of location.evses ?? []) {
      await this.upsertEvseForPartner(
        tenantPartner,
        evse.uid,
        evse,
        idChargingStationAssociatedWithLocation,
      );
    }
  }

  async putLocationByCountryPartyAndId(
    countryCode: string,
    partyId: string,
    location: LocationDTO,
    locationId: string,
    tenantPartner: TenantPartnerDto,
  ): Promise<LocationResponse> {
    this.logger.info(
      `Receiver PUT location ${countryCode}/${partyId} body=${JSON.stringify(location)}`,
    );

    if (!tenantPartner.id) {
      throw new UnauthorizedException('Credentials not found for given token');
    }

    const variables = { id: locationId, partnerId: tenantPartner.id };
    console.log('variables ', variables);
    const response = await this.ocpiGraphqlClient.request<
      GetLocationByOcpiIdAndPartnerIdQueryResult,
      GetLocationByOcpiIdAndPartnerIdQueryVariables
    >(GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY, variables);
    console.log(
      'response GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY ',
      response,
    );

    await this.upsertLocationForPartner(location, locationId, tenantPartner);

    return buildOcpiResponse(
      OcpiResponseStatusCode.GenericSuccessCode,
      location,
    ) as LocationResponse;
  }

  async createVirtualChargingStationForPartnerAndLocation(
    locationId: string,
    tenantPartner: TenantPartnerDto,
  ): Promise<InsertChargingStationMutationResult> {
    console.log(
      'creating virtual charging station for partner ',
      tenantPartner.id,
      ' and location ',
      locationId,
    );
    console.log('tenantPartner.tenantId ', tenantPartner.tenantId);
    console.log('!!! location ', locationId);
    const response = await this.ocpiGraphqlClient.request<
      InsertChargingStationMutationResult,
      InsertChargingStationMutationVariables
    >(INSERT_CHARGING_STATION_MUTATION, {
      object: {
        id: `${tenantPartner.id}-${locationId}-${Math.random().toString(36).substring(2, 15)}`,
        locationId: Number(locationId),
        tenantId: tenantPartner.tenantId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    console.log('response CREATE VIRTUAL CHARGING STATION ', response);
    return response;
  }

  async upsertConnectorForPartnerAndEvse(
    tenantPartner: TenantPartnerDto,
    connector: any,
    evseId: string,
    stationId: string,
    status: EvseStatus,
  ): Promise<void> {
    const response = await this.ocpiGraphqlClient.request<
      UpsertLocationMutationResult,
      UpsertConnectorMutationVariables
    >(UPSERT_CONNECTOR_MUTATION, {
      object: {
        ocpiId: connector.id,
        stationId,
        evseId: Number(evseId),
        connectorId: Number(evseId) * 1000 + (Number(connector.id) || 1),
        type: connector.standard,
        format: connector.format,
        powerType: connector.power_type ?? null,
        tenantId: tenantPartner.tenantId,
        maximumAmperage: connector.max_amperage ?? null,
        maximumVoltage: connector.max_voltage ?? null,
        maximumPowerWatts: connector.max_electric_power ?? null,
        termsAndConditionsUrl: connector.terms_and_conditions ?? null,
        timestamp: connector.last_updated ?? new Date().toISOString(),
        status: status,
        createdAt: new Date(),
        updatedAt: connector.last_updated ?? new Date(),
      },
    });
    console.log('response ', response);
  }

  async upsertEvseForPartner(
    tenantPartner: TenantPartnerDto,
    evseUid: string,
    evse: LocationEvseDTO,
    stationId: string,
  ): Promise<void> {
    const response = await this.ocpiGraphqlClient.request<
      UpsertEvseMutationResult,
      UpsertEvseMutationVariables
    >(UPSERT_EVSE_MUTATION, {
      object: {
        ocpiUid: evse.uid,
        evseId: evse.evse_id ?? '',
        stationId: stationId,
        physicalReference: evse.physical_reference?.toString() ?? null,
        capabilities: evse.capabilities ?? null,
        floorLevel: evse.floor_level ?? null,
        ocpiStatus: evse.status ?? null,
        coordinates: evse.coordinates
          ? {
              type: 'Point',
              coordinates: [
                Number(evse.coordinates.longitude),
                Number(evse.coordinates.latitude),
              ],
            }
          : null,
        parkingRestrictions: evse.parking_restrictions ?? null,
        statusSchedule: evse.status_schedule ?? null,
        images: evse.images ?? null,
        directions: evse.directions ?? null,
        tenantId: tenantPartner.tenantId,
        createdAt: new Date(),
        updatedAt: evse.last_updated ?? new Date(),
      },
    });

    const insertedEvseId = response?.insert_Evses_one?.id;

    if (!insertedEvseId) {
      throw new Error('Failed to insert evse');
    }

    if (insertedEvseId != null && evse.connectors?.length) {
      for (const connector of evse.connectors) {
        await this.upsertConnectorForPartnerAndEvse(
          tenantPartner,
          connector,
          String(insertedEvseId),
          stationId,
          evse.status as EvseStatus,
        );
      }
    }
  }

  async putEvseByCountryPartyAndId(
    countryCode: string,
    partyId: string,
    locationId: string,
    evseUid: string,
    evse: LocationEvseDTO,
    tenantPartner: TenantPartnerDto,
  ): Promise<LocationResponse> {
    this.logger.info(
      `Receiver PUT evse ${countryCode}/${partyId}/${locationId}/${evseUid} body=${JSON.stringify(evse)}`,
    );
    if (!tenantPartner.id) {
      throw new UnauthorizedException('Credentials not found for given token');
    }

    // const variables = { tenantPartnerId: tenantPartner.id, locationId };
    const variables = { id: locationId, partnerId: tenantPartner.id };
    console.log('variables ', variables);
    const response = await this.ocpiGraphqlClient.request<
      GetLocationByOcpiIdAndPartnerIdQueryResult,
      GetLocationByOcpiIdAndPartnerIdQueryVariables
    >(GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY, variables);
    console.log('response ', response);

    if (!response.Locations || response.Locations.length === 0) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientUnknownLocation,
        'Unknown location',
      ) as LocationResponse;
    }

    const evseVariables = {
      partnerId: tenantPartner.id,
      locationId: locationId,
      evseId: evseUid,
    };
    console.log('evse Var !', evseVariables);
    const evseResponse = await this.ocpiGraphqlClient.request<
      GetEvseByLocationAndOwnerPartnerQueryResult,
      GetEvseByLocationAndOwnerPartnerQueryVariables
    >(GET_EVSE_BY_LOCATION_ID_AND_OWNER_PARTNER_ID, evseVariables);
    const location_id = evseResponse.Locations[0].id;

    // if there is no charging station we create a virtual one (there should always be one as they are created when the location is created)
    if (evseResponse.Locations[0].chargingPool.length === 0) {
      await this.createVirtualChargingStationForPartnerAndLocation(
        locationId,
        tenantPartner,
      );
    }
    // if there is a charging station we insert the evse into the charging station (the first one as there should always be only one)
    else {
      await this.upsertEvseForPartner(
        tenantPartner,
        evseUid,
        evse,
        evseResponse.Locations[0].chargingPool[0].id,
      );
    }

    await this.ocpiGraphqlClient.request<
      UpdateLocationPatchMutationResult,
      UpdateLocationPatchMutationVariables
    >(UPDATE_LOCATION_PATCH_MUTATION, {
      id: location_id,
      changes: { updatedAt: evse.last_updated },
    });

    return buildOcpiResponse(
      OcpiResponseStatusCode.GenericSuccessCode,
      evse,
    ) as LocationResponse;
  }

  async putConnectorByCountryPartyAndId(
    countryCode: string,
    partyId: string,
    locationId: string,
    evseUid: string,
    connectorId: string,
    connector: ConnectorDTO,
    tenantPartner: TenantPartnerDto,
  ): Promise<LocationResponse> {
    this.logger.info(
      `Receiver PUT connector ${countryCode}/${partyId}/${locationId}/${evseUid}/${connectorId} body=${JSON.stringify(connector)}`,
    );

    if (!tenantPartner.id) {
      throw new UnauthorizedException('Credentials not found for given token');
    }

    const variables = {
      locationId: locationId,
      partnerId: tenantPartner.id,
      evseUid: evseUid,
    };
    console.log('variables ', variables);
    const lookupResponse = await this.ocpiGraphqlClient.request<
      GetEvseByOcpiIdAndPartnerIdQueryResult,
      GetEvseByOcpiIdAndPartnerIdQueryVariables
    >(GET_EVSE_BY_OCPI_ID_AND_PARTNER_ID_QUERY, variables);

    const chargingStation = lookupResponse?.Evses[0]?.ChargingStation;
    const evse = lookupResponse?.Evses[0];
    const location = chargingStation?.location;

    if (!location) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientUnknownLocation,
        'Unknown location',
      ) as LocationResponse;
    }

    // const connectors = evses[0]?.connectors ?? [];

    if (!evse) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientUnknownLocation,
        'Unknown EVSE',
      ) as LocationResponse;
    }

    const ts = new Date(connector.last_updated as any);

    await this.ocpiGraphqlClient.request(UPSERT_CONNECTOR_MUTATION, {
      object: {
        ocpiId: connector.id,
        evseId: evse.id, // DB integer id from Evses[0].id
        stationId: chargingStation.id, // from Evses[0].ChargingStation.id
        connectorId: evse.id * 1000 + (Number(connector.id) || 1),
        type: connector.standard, // ← still has enum mismatch issue
        format: connector.format,
        powerType: connector.power_type ?? null,
        maximumVoltage: connector.max_voltage ?? null,
        maximumAmperage: connector.max_amperage ?? null,
        maximumPowerWatts: connector.max_electric_power ?? null,
        termsAndConditionsUrl: connector.terms_and_conditions ?? null,
        tenantId: tenantPartner.tenantId,
        timestamp: connector.last_updated,
        updatedAt: connector.last_updated ?? new Date(),
        createdAt: new Date(),
      },
    });

    // 3) cascade timestamps to parents
    await this.ocpiGraphqlClient.request<
      UpdateEvsePatchMutationResult,
      UpdateEvsePatchMutationVariables
    >(UPDATE_EVSE_PATCH_MUTATION, {
      id: evse.id,
      changes: { updatedAt: ts },
    });

    await this.ocpiGraphqlClient.request<
      UpdateLocationPatchMutationResult,
      UpdateLocationPatchMutationVariables
    >(UPDATE_LOCATION_PATCH_MUTATION, {
      id: location.id,
      changes: { updatedAt: ts },
    });

    return buildOcpiResponse(
      OcpiResponseStatusCode.GenericSuccessCode,
      connector,
    ) as LocationResponse;
  }

  mapLocationPatch(input: Partial<LocationDTO>): any {
    const out: any = {};

    const has = (obj: any, key: string) =>
      Object.prototype.hasOwnProperty.call(obj, key);

    if (has(input, 'name')) out.name = input.name ?? null;
    if (has(input, 'address')) out.address = input.address ?? null;
    if (has(input, 'city')) out.city = input.city ?? null;
    if (has(input, 'postal_code')) out.postalCode = input.postal_code ?? null;
    if (has(input, 'state')) out.state = input.state ?? null;
    if (has(input, 'country')) out.country = input.country ?? null;

    if (has(input, 'coordinates')) {
      out.coordinates = input.coordinates
        ? {
            type: 'Point',
            coordinates: [
              Number(input.coordinates.longitude),
              Number(input.coordinates.latitude),
            ],
          }
        : null;
    }

    if (has(input, 'parking_type'))
      out.parkingType = input.parking_type ?? null;
    if (has(input, 'time_zone')) out.timeZone = input.time_zone ?? null;
    if (has(input, 'operator')) out.operator = input.operator ?? null;
    if (has(input, 'suboperator')) out.suboperator = input.suboperator ?? null;
    if (has(input, 'owner')) out.owner = input.owner ?? null;
    if (has(input, 'related_locations'))
      out.relatedLocations = input.related_locations ?? null;
    if (has(input, 'charging_when_closed'))
      out.chargingWhenClosed = input.charging_when_closed ?? null;

    if (has(input, 'last_updated'))
      out.updatedAt = new Date(input.last_updated as any);

    return out;
  }

  async patchLocationByCountryPartyAndId(
    countryCode: string,
    partyId: string,
    locationId: string,
    location: Partial<LocationDTO>,
    tenantPartner: TenantPartnerDto,
  ): Promise<LocationResponse> {
    this.logger.info(
      `Receiver PATCH location ${countryCode}/${partyId}/${locationId} body=${JSON.stringify(location)}`,
    );

    if (!tenantPartner.id) {
      throw new UnauthorizedException('Credentials not found for given token');
    }

    if (!location.last_updated) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientInvalidOrMissingParameters,
        'PATCH requires last_updated',
      ) as LocationResponse;
    }

    const variables = { partnerId: tenantPartner.id, locationId };
    const response = await this.ocpiGraphqlClient.request<
      GetPartnerLocationByOcpiIdQueryResult,
      GetPartnerLocationByOcpiIdQueryVariables
    >(GET_PARTNER_LOCATION_BY_OCPI_ID, variables);
    console.log('response GET_PARTNER_LOCATION_BY_OCPI_ID ', response);

    if (!response.Locations || response.Locations.length === 0) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientUnknownLocation,
        'Unknown location',
      ) as LocationResponse;
    }

    const dbLocationId = response.Locations[0].id;
    const locationPatch = this.mapLocationPatch(location);
    const responseUpdateLocation = await this.ocpiGraphqlClient.request<
      any,
      any
    >(UPDATE_LOCATION_PATCH_MUTATION, {
      id: dbLocationId,
      changes: locationPatch,
    });
    console.log(
      'response UPDATE_LOCATION_PATCH_MUTATION ',
      responseUpdateLocation,
    );

    return buildOcpiResponse(
      OcpiResponseStatusCode.GenericSuccessCode,
      location,
    ) as LocationResponse;
  }

  mapEvsePatch(input: Partial<LocationEvseDTO>) {
    const out: any = {};

    const has = (obj: any, key: string) =>
      Object.prototype.hasOwnProperty.call(obj, key);

    if (has(input, 'status_schedule'))
      out.statusSchedule = input.status_schedule ?? null;
    if (has(input, 'capabilities'))
      out.capabilities = input.capabilities ?? null;

    if (has(input, 'evse_id')) out.evseId = input.evse_id ?? null;
    if (has(input, 'physical_reference'))
      out.physicalReference = input.physical_reference?.toString() ?? null;
    if (has(input, 'floor_level')) out.floorLevel = input.floor_level ?? null;

    if (has(input, 'coordinates')) {
      out.coordinates = input.coordinates
        ? {
            type: 'Point',
            coordinates: [
              Number(input.coordinates.longitude),
              Number(input.coordinates.latitude),
            ],
          }
        : null;
    }

    if (has(input, 'parking_restrictions'))
      out.parkingRestrictions = input.parking_restrictions ?? null;
    if (has(input, 'images')) out.images = input.images ?? null;
    if (has(input, 'directions')) out.directions = input.directions ?? null;
    if (has(input, 'status')) out.ocpiStatus = input.status ?? null;
    if (has(input, 'last_updated'))
      out.updatedAt = new Date(input.last_updated as any);

    return out;
  }

  async patchEvseByCountryPartyAndId(
    countryCode: string,
    partyId: string,
    locationId: string,
    evseUid: string,
    evse: Partial<LocationEvseDTO>,
    tenantPartner: TenantPartnerDto,
  ): Promise<LocationResponse> {
    this.logger.info(
      `Receiver PATCH evse ${countryCode}/${partyId}/${locationId}/${evseUid} body=${JSON.stringify(evse)}`,
    );
    if (!tenantPartner.id) {
      throw new UnauthorizedException('Credentials not found for given token');
    }

    if (!evse.last_updated) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientInvalidOrMissingParameters,
        'PATCH requires last_updated',
      ) as LocationResponse;
    }

    const lookupResponse = await this.ocpiGraphqlClient.request<
      GetPartnerEvseByOcpiIdsQueryResult,
      GetPartnerEvseByOcpiIdsQueryVariables
    >(GET_PARTNER_EVSE_BY_OCPI_ID, {
      partnerId: tenantPartner.id,
      locationId: locationId,
      evseUid: evseUid,
    });

    if (!lookupResponse.Locations || lookupResponse.Locations.length === 0) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientUnknownLocation,
        'Unknown location',
      ) as LocationResponse;
    }

    const evses = lookupResponse.Locations[0]?.chargingPool?.[0]?.evses ?? [];
    if (evses.length === 0) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientUnknownLocation,
        'Unknown EVSE',
      ) as LocationResponse;
    }

    const dbEvseId = evses[0].id;
    const dbLocationId = lookupResponse.Locations[0].id;
    const evsePatch = this.mapEvsePatch(evse);
    const responseUpdateEvse = await this.ocpiGraphqlClient.request<
      UpdateEvsePatchMutationResult,
      UpdateEvsePatchMutationVariables
    >(UPDATE_EVSE_PATCH_MUTATION, {
      id: dbEvseId,
      changes: evsePatch,
    });
    console.log('response UPDATE_EVSE_PATCH_MUTATION ', responseUpdateEvse);
    const responseUpdateLocation = await this.ocpiGraphqlClient.request<
      any,
      any
    >(UPDATE_LOCATION_PATCH_MUTATION, {
      id: dbLocationId,
      changes: { updatedAt: new Date(evse.last_updated as any) },
    });
    console.log(
      'response UPDATE_LOCATION_PATCH_MUTATION ',
      responseUpdateLocation,
    );

    return buildOcpiResponse(
      OcpiResponseStatusCode.GenericSuccessCode,
      evse,
    ) as LocationResponse;
  }

  mapConnectorPatch(input: Partial<ConnectorDTO>) {
    const out: any = {};

    const has = (obj: any, key: string) =>
      Object.prototype.hasOwnProperty.call(obj, key);

    if (has(input, 'standard')) out.type = input.standard ?? null;
    if (has(input, 'format')) out.format = input.format ?? null;
    if (has(input, 'power_type')) out.powerType = input.power_type ?? null;

    if (has(input, 'max_voltage'))
      out.maximumVoltage = input.max_voltage ?? null;
    if (has(input, 'max_amperage'))
      out.maximumAmperage = input.max_amperage ?? null;
    if (has(input, 'max_electric_power'))
      out.maximumPowerWatts = input.max_electric_power ?? null;

    if (has(input, 'terms_and_conditions'))
      out.termsAndConditionsUrl = input.terms_and_conditions ?? null;
    if (has(input, 'tariff_ids')) out.tariffIds = input.tariff_ids ?? null; // if column exists

    if (has(input, 'last_updated')) {
      out.timestamp = input.last_updated;
      out.updatedAt = new Date(input.last_updated as any);
    }

    return out;
  }
  async patchConnectorByCountryPartyAndId(
    countryCode: string,
    partyId: string,
    locationId: string,
    evseUid: string,
    connectorId: string,
    connector: Partial<ConnectorDTO>,
    tenantPartner: TenantPartnerDto,
  ): Promise<LocationResponse> {
    this.logger.info(
      `Receiver PATCH connector ${countryCode}/${partyId}/${locationId}/${evseUid}/${connectorId} body=${JSON.stringify(connector)}`,
    );

    if (!tenantPartner.id) {
      throw new UnauthorizedException('Credentials not found for given token');
    }

    if (!connector.last_updated) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientInvalidOrMissingParameters,
        'PATCH requires last_updated',
      ) as LocationResponse;
    }

    const lookupResponse = await this.ocpiGraphqlClient.request<
      GetPartnerConnectorByOcpiIdAndEvseIdQueryResult,
      GetPartnerConnectorByOcpiIdAndEvseIdQueryVariables
    >(GET_PARTNER_CONNECTOR_BY_OCPI_ID_AND_EVSE_ID, {
      partnerId: tenantPartner.id,
      locationId,
      evseUid,
      connectorId,
    });
    if (!lookupResponse.Locations || lookupResponse.Locations.length === 0) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientUnknownLocation,
        'Unknown location',
      ) as LocationResponse;
    }
    const locationNode = lookupResponse.Locations[0];
    const chargingPool = locationNode.chargingPool ?? [];
    const evses = chargingPool[0]?.evses ?? [];
    const connectors = evses[0]?.connectors ?? [];
    if (evses.length === 0) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientUnknownLocation,
        'Unknown EVSE',
      ) as LocationResponse;
    }
    if (connectors.length === 0) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientUnknownLocation,
        'Unknown connector',
      ) as LocationResponse;
    }
    const dbLocationId = locationNode.id;
    const dbEvseId = evses[0].id;
    const dbConnectorId = connectors[0].id;
    const connectorPatch = this.mapConnectorPatch(connector);
    await this.ocpiGraphqlClient.request<
      UpdateConnectorPatchMutationResult,
      UpdateConnectorPatchMutationVariables
    >(UPDATE_CONNECTOR_PATCH_MUTATION, {
      id: dbConnectorId,
      changes: connectorPatch,
    });
    // 4) Cascade parent timestamps per OCPI spec
    const ts = new Date(connector.last_updated as any);
    await this.ocpiGraphqlClient.request<
      UpdateEvsePatchMutationResult,
      UpdateEvsePatchMutationVariables
    >(UPDATE_EVSE_PATCH_MUTATION, {
      id: dbEvseId,
      changes: { updatedAt: ts },
    });
    await this.ocpiGraphqlClient.request<
      UpdateLocationPatchMutationResult,
      UpdateLocationPatchMutationVariables
    >(UPDATE_LOCATION_PATCH_MUTATION, {
      id: dbLocationId,
      changes: { updatedAt: ts },
    });
    return buildOcpiResponse(
      OcpiResponseStatusCode.GenericSuccessCode,
      connector,
    ) as LocationResponse;
  }
}
