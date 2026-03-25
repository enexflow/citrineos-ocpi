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
import type {
  ConnectorDTO,
  ConnectorResponse,
} from '../model/DTO/ConnectorDTO.js';
import {
  buildOcpiResponse,
  OcpiResponseStatusCode,
} from '../model/OcpiResponse.js';
import { buildOcpiErrorResponse } from '../model/OcpiErrorResponse.js';
import { NotFoundException } from '../exception/NotFoundException.js';
import type {
  GetEvseByOcpiIdAndPartnerIdQueryResult,
  GetEvseByOcpiIdAndPartnerIdQueryVariables,
  GetLocationByIdQueryResult,
  GetLocationByIdQueryVariables,
  GetLocationByIdAndPartnerIdQueryResult,
  GetLocationByIdAndPartnerIdQueryVariables,
  // GetConnectorByOcpiIdAndEvseIdQueryResult,
  // GetConnectorByOcpiIdAndEvseIdQueryVariables,
  // UpsertConnectorMutationResult,
  // UpsertConnectorMutationVariables,
  UpsertLocationMutationResult,
  UpsertLocationMutationVariables,
  GetChargingStationByLocationAndOwnerPartnerQueryResult,
  GetChargingStationByLocationAndOwnerPartnerQueryVariables,
  InsertChargingStationMutationResult,
  InsertChargingStationMutationVariables,
  UpsertEvseMutationResult,
  UpsertEvseMutationVariables,
  GetPartnerEvseByOcpiIdsQueryResult,
  GetPartnerEvseByOcpiIdsQueryVariables,
  GetPartnerLocationByOcpiIdQueryResult,
  GetPartnerLocationByOcpiIdQueryVariables,
} from '../graphql/operations.js';
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
      console.log(
        'variables GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY ',
        variables,
      );
      const response = await this.ocpiGraphqlClient.request<
        GetLocationByIdAndPartnerIdQueryResult,
        GetLocationByIdAndPartnerIdQueryVariables
      >(GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY, variables);
      console.log(
        'response GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY Graphql receiver',
        response,
      );
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
      const response = await this.ocpiGraphqlClient.request<
        GetEvseByOcpiIdAndPartnerIdQueryResult,
        GetEvseByOcpiIdAndPartnerIdQueryVariables
      >(GET_EVSE_BY_OCPI_ID_AND_PARTNER_ID_QUERY, variables);
      console.log(
        'response GET_EVSE_BY_OCPI_ID_AND_PARTNER_ID_QUERY Graphql receiver',
        response,
      );
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
      if (!tenantPartner.id) {
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
        any
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

  async upsertReceivedLocation(
    countryCode: string,
    partyId: string,
    location: LocationDTO,
    locationId: string,
    tenantPartner: TenantPartnerDto,
  ): Promise<void> {
    this.logger.info(
      `IN IT Receiver INSERT location ${countryCode}/${partyId} body=${JSON.stringify(location)}`,
    );

    if(!tenantPartner.id) {
      throw new UnauthorizedException('Credentials not found for given token');
    }

    const stationId = `${tenantPartner.id}-${location.id}-${Math.random().toString(36).substring(2, 15)}`;

    const coordinates = {
      type: 'Point',
      coordinates: [
        Number(location.coordinates?.longitude ?? 0),
        Number(location.coordinates?.latitude ?? 0),
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

    if(!response.insert_Locations_one?.id) {
      throw new Error('Failed to create location');
    }

    const stationIdVariables = {
      locationId: response.insert_Locations_one?.id ?? 0,
      partnerId: tenantPartner.id,
    };
    let idChargingStationAssociatedWithLocation = null;

    const stationIdFoundResponse = await this.ocpiGraphqlClient.request<
      GetChargingStationByLocationAndOwnerPartnerQueryResult,
      GetChargingStationByLocationAndOwnerPartnerQueryVariables
    >(
      GET_CHARGING_STATION_BY_LOCATION_ID_AND_OWNER_PARTNER_ID,
      stationIdVariables,
    );

    if (stationIdFoundResponse.ChargingStations.length === 0) {
      const responseCreateVirtualChargingStation =
        await this.createVirtualChargingforLocation(
          response.insert_Locations_one?.id?.toString() ?? '',
          tenantPartner,
        );
      idChargingStationAssociatedWithLocation =
        responseCreateVirtualChargingStation?.insert_ChargingStations_one?.id ??
        null;
    } else {
      idChargingStationAssociatedWithLocation =
        stationIdFoundResponse.ChargingStations[0].id ?? null;
    }

    for (const evse of location.evses ?? []) {
      await this.upsertReceivedEvse(
        location.id,
        tenantPartner,
        evse.uid,
        evse,
        idChargingStationAssociatedWithLocation,
      );
    }
  }
  async syncLocationFromPartner(
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
    const response = await this.ocpiGraphqlClient.request<
      GetLocationByIdAndPartnerIdQueryResult,
      GetLocationByIdAndPartnerIdQueryVariables
    >(GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY, variables);

    await this.upsertReceivedLocation(
      countryCode,
      partyId,
      location,
      locationId,
      tenantPartner,
    );

    return buildOcpiResponse(
      OcpiResponseStatusCode.GenericSuccessCode,
      location,
    ) as LocationResponse;
  }

  async createVirtualChargingforLocation(
    locationId: string,
    tenantPartner: TenantPartnerDto,
  ): Promise<any> {
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
    return response;
  }

  async upsertReceivedConnector(
    locationId: string,
    tenantPartner: TenantPartnerDto,
    connector: any,
    evseId: string,
    stationId: string,
    status: EvseStatus,
  ): Promise<void> {
    const response = await this.ocpiGraphqlClient.request<
      any,
      any
    >(UPSERT_CONNECTOR_MUTATION, {
      object: {
        ocpiId: connector.id, // ← ADD
        stationId,
        evseId: Number(evseId),
        connectorId: Number(evseId) * 1000 + (Number(connector.id) || 1),
        type: connector.standard,
        format: connector.format,
        powerType: connector.power_type ?? null, // ← ADD
        tenantId: tenantPartner.tenantId,
        maximumAmperage: connector.max_amperage ?? null,
        maximumVoltage: connector.max_voltage ?? null, // ← ADD
        maximumPowerWatts: connector.max_electric_power ?? null,
        termsAndConditionsUrl: connector.terms_and_conditions ?? null,
        timestamp: connector.last_updated ?? new Date().toISOString(), // ← ADD
        createdAt: new Date(),
        updatedAt: connector.last_updated ?? new Date(),
      },
    });
  }

  async upsertReceivedEvse(
    locationId: string,
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
        ocpiStatus: evse.status ?? null,
        tenantId: tenantPartner.tenantId,
        createdAt: new Date(),
        updatedAt: evse.last_updated ?? new Date(),
      },
    });

    const insertedEvseId = response?.insert_Evses_one?.id;
    if (insertedEvseId != null && evse.connectors?.length) {
      for (const connector of evse.connectors) {
        await this.upsertReceivedConnector(
          locationId,
          tenantPartner,
          connector,
          String(insertedEvseId),
          stationId,
          evse.status as EvseStatus,
        );
      }
    }
  }

  async syncEvseFromPartner(
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

    const variables = { id: locationId, partnerId: tenantPartner.id };
    const response = await this.ocpiGraphqlClient.request<
      GetLocationByIdAndPartnerIdQueryResult,
      GetLocationByIdAndPartnerIdQueryVariables
    >(GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY, variables);

    if (!response.Locations || response.Locations.length === 0) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientUnknownLocation, // 2003
        'Unknown location',
      ) as LocationResponse;
    }

    const evseVariables = {
      partnerId: tenantPartner.id,
      locationId: locationId,
      evseId: evseUid,
    };
    console.log('evseVariables!!!!! ', evseVariables);
    // const evseResponse = await this.ocpiGraphqlClient.request<
    //   GetEvseByOcpiIdAndPartnerIdQueryResult,
    //   GetEvseByOcpiIdAndPartnerIdQueryVariables
    // >(GET_EVSE_BY_LOCATION_ID_AND_OWNER_PARTNER_ID, evseVariables);
    // const location_id = evseResponse.Evses[0].id;

    // // no charging station
    // if (evseResponse.Evses[0].connectors.length === 0) {
    //   await this.createVirtualChargingforLocation(
    //     locationId,
    //     tenantPartner,
    //   );
    // } else if (
    //   evseResponse.Evses[0].connectors.length >= 1 &&
    //   evseResponse.Evses[0].connectors[0].length === 0
    // ) {
    //   await this.upsertReceivedEvse(
    //     locationId,
    //     tenantPartner,
    //     evseUid,
    //     evse,
    //     evseResponse.Locations[0].chargingPool[0].id,
    //   );
    // } else if (
    //   evseResponse.Locations[0].chargingPool.length > 1 &&
    //   evseResponse.Locations[0].chargingPool[0].evses.length > 0
    // ) {
    // }

    // await this.ocpiGraphqlClient.request<any, any>(
    //   UPDATE_LOCATION_PATCH_MUTATION,
    //   { id: location_id, changes: { updatedAt: evse.last_updated } },
    // );

    return buildOcpiResponse(
      OcpiResponseStatusCode.GenericSuccessCode,
      evse,
    ) as LocationResponse;
  }

  async syncConnectorFromPartner(
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
    const lookupResponse = await this.ocpiGraphqlClient.request<GetEvseByOcpiIdAndPartnerIdQueryResult, GetEvseByOcpiIdAndPartnerIdQueryVariables>(
      GET_EVSE_BY_OCPI_ID_AND_PARTNER_ID_QUERY,
      variables,
    );

    console.log('lookupResponse CHANGED again!!!', lookupResponse);
    console.log('lookupResponse.Evses ', lookupResponse.Evses);
    console.log(
      'lookupResponse.ChargingStation ',
      lookupResponse?.Evses[0]?.ChargingStation,
    );

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
    connector.id = connectorId;

    await this.upsertReceivedConnector(
      locationId,
      tenantPartner,
      connector,
      String(evse.id),
      chargingStation.id,
      EvseStatus.UNKNOWN,
    );

    // 3) cascade timestamps to parents
    await this.ocpiGraphqlClient.request<any, any>(UPDATE_EVSE_PATCH_MUTATION, {
      id: evse.id,
      changes: { updatedAt: ts },
    });

    await this.ocpiGraphqlClient.request<any, any>(
      UPDATE_LOCATION_PATCH_MUTATION,
      { id: location.id, changes: { updatedAt: ts } },
    );

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

  async applyLocationPatchFromPartner(
    countryCode: string,
    partyId: string,
    locationId: string,
    location: Partial<LocationDTO>,
    tenantPartner: TenantPartnerDto,
  ): Promise<LocationResponse> {
    this.logger.info(
      `Receiver PATCH location ${countryCode}/${partyId}/${locationId} body=${JSON.stringify(location)}`,
    );

    if(!tenantPartner.id) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientInvalidOrMissingParameters,
        'Tenant partner not found',
      ) as LocationResponse;
    }

    if (!location.last_updated) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientInvalidOrMissingParameters,
        'PATCH requires last_updated',
      ) as LocationResponse;
    }

    const variables = { partnerId: tenantPartner.id, locationId };
    const response = await this.ocpiGraphqlClient.request<GetPartnerLocationByOcpiIdQueryResult, GetPartnerLocationByOcpiIdQueryVariables>(
      GET_PARTNER_LOCATION_BY_OCPI_ID,
      variables,
    );
    console.log('response GET_PARTNER_LOCATION_BY_OCPI_ID ', response);

    if (!response.Locations || response.Locations.length === 0) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientUnknownLocation, // 2003
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

    if (has(input, 'status')) out.status = input.status ?? null;
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

    if (has(input, 'last_updated'))
      out.updatedAt = new Date(input.last_updated as any);

    return out;
  }

  async applyEvsePatchFromPartner(
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

    if (!evse.last_updated) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientInvalidOrMissingParameters,
        'PATCH requires last_updated',
      ) as LocationResponse;
    }

    if(!tenantPartner.id) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientInvalidOrMissingParameters,
        'Tenant partner not found',
      ) as LocationResponse;
    }

    const lookupResponse = await this.ocpiGraphqlClient.request<GetPartnerEvseByOcpiIdsQueryResult, GetPartnerEvseByOcpiIdsQueryVariables>(
      GET_PARTNER_EVSE_BY_OCPI_ID,
      {
        partnerId: tenantPartner.id,
        locationId: locationId, // OCPI string: "LOC1"
        evseUid: evseUid, // OCPI string: "3256"
      },
    );

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

    const dbEvseId = evses[0].id; // DB integer
    const dbLocationId = lookupResponse.Locations[0].id; // DB integer
    const evsePatch = this.mapEvsePatch(evse);
    const responseUpdateEvse = await this.ocpiGraphqlClient.request<any, any>(
      UPDATE_EVSE_PATCH_MUTATION,
      {
        id: dbEvseId,
        changes: evsePatch,
      },
    );
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
  async applyConnectorPatchFromPartner(
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

    if (!connector.last_updated) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientInvalidOrMissingParameters,
        'PATCH requires last_updated',
      ) as LocationResponse;
    }

    const lookupResponse = await this.ocpiGraphqlClient.request<
      any,
      any
    >(
      GET_CONNECTOR_BY_OCPI_ID_AND_EVSE_ID,
      {
        partnerId: tenantPartner,
        locationId,
        evseUid,
        connectorId,
      },
    );
    if (!lookupResponse.Connectors || lookupResponse.Connectors.length === 0) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientUnknownLocation,
        'Unknown location',
      ) as LocationResponse;
    }
    const locationNode = lookupResponse.Connectors[0];
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
    // 2) Build partial patch object
    const connectorPatch = this.mapConnectorPatch(connector); // add helper like mapEvsePatch
    // 3) Patch connector row
    await this.ocpiGraphqlClient.request<any, any>(
      UPDATE_CONNECTOR_PATCH_MUTATION,
      {
        id: dbConnectorId,
        changes: connectorPatch,
      },
    );
    // 4) Cascade parent timestamps per OCPI spec
    const ts = new Date(connector.last_updated as any);
    await this.ocpiGraphqlClient.request<any, any>(UPDATE_EVSE_PATCH_MUTATION, {
      id: dbEvseId,
      changes: { updatedAt: ts },
    });
    await this.ocpiGraphqlClient.request<any, any>(
      UPDATE_LOCATION_PATCH_MUTATION,
      {
        id: dbLocationId,
        changes: { updatedAt: ts },
      },
    );
    return buildOcpiResponse(
      OcpiResponseStatusCode.GenericSuccessCode,
      connector,
    ) as LocationResponse;
  }
}
