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
import type { ConnectorDTO, ConnectorResponse } from '../model/DTO/ConnectorDTO.js';
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
  GetConnectorByIdQueryResult,
  GetConnectorByIdQueryVariables,
  GetEvseByIdQueryResult,
  GetEvseByIdQueryVariables,
  GetLocationByIdQueryResult,
  GetLocationByIdQueryVariables,
  GetLocationsQueryResult,
  GetLocationsQueryVariables,
  Locations_Bool_Exp,
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
  GET_LOCATION_BY_COUNTRY_PARTY_AND_ID_QUERY,
  GET_EVSE_BY_OCPI_ID_AND_PARTNER_ID_QUERY
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
    ctx: any,
  ): Promise<LocationResponse> {
    this.logger.debug(`Getting location ${locationId} by country ${countryCode} and party ${partyId}`);
    try {
      if(!ctx.state.tenantPartner) {
        throw new UnauthorizedException('Credentials not found for given token');
      }
      const variables = { id: locationId, partnerId: ctx.state.tenantPartner.id };
      console.log('variables GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY ', variables)
      const response = await this.ocpiGraphqlClient.request<
        any,
        any // TODO: add proper types
      >(GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY, variables);
      console.log('response GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY Graphql receiver', response)
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
    ctx: any,
  ): Promise<LocationResponse> {
    this.logger.debug(`Getting location ${locationId} by country ${countryCode} and party ${partyId}`);
    try {
      if(!ctx.state.tenantPartner) {
        throw new UnauthorizedException('Credentials not found for given token');
      }
      const variables = { locationId: locationId, partnerId: ctx.state.tenantPartner.id, evseUid: evseUid };
      console.log('variables GET_EVSE_BY_OCPI_ID_AND_PARTNER_ID_QUERY ', variables)
      const response = await this.ocpiGraphqlClient.request<
        any,
        any // TODO: add proper types
      >(GET_EVSE_BY_OCPI_ID_AND_PARTNER_ID_QUERY, variables);
      console.log('response GET_EVSE_BY_OCPI_ID_AND_PARTNER_ID_QUERY Graphql receiver', response)
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
    ctx: any,
  ): Promise<LocationResponse> {
    this.logger.debug(`Getting location ${locationId} by country ${countryCode} and party ${partyId}`);
    try {
      if(!ctx.state.tenantPartner) {
        throw new UnauthorizedException('Credentials not found for given token');
      }
      const variables = { locationId: locationId, partnerId: ctx.state.tenantPartner.id, evseUid: evseUid, connectorId: connectorId };
      console.log('variables GET_CONNECTOR_BY_OCPI_ID_AND_PARTNER_ID_QUERY ', variables)
      const response = await this.ocpiGraphqlClient.request<
        any,
        any // TODO: add proper types
      >(GET_CONNECTOR_BY_OCPI_ID_AND_EVSE_ID, variables);
      console.log('response GET_CONNECTOR_BY_OCPI_ID_AND_PARTNER_ID_QUERY Graphql receiver', response)
      const connector = ConnectorMapper.fromGraphqlReceiver(
        response.Connectors[0] as ConnectorDto,
      );
      return buildOcpiResponse(OcpiResponseStatusCode.GenericSuccessCode, connector) as LocationResponse;
    } catch (e) {
      const statusCode = e instanceof NotFoundException ? OcpiResponseStatusCode.ClientUnknownLocation : OcpiResponseStatusCode.ClientGenericError;
      return buildOcpiErrorResponse(statusCode, (e as Error).message) as LocationResponse;
    }

  }
  

async upsertLocationForPartnerAndCountryParty(
    countryCode: string,
    partyId: string,
    location: LocationDTO,
    locationId: string,
    tenantPartner: TenantPartnerDto,
  ): Promise<void> {
    this.logger.info(
      `IN IT Receiver INSERT location ${countryCode}/${partyId} body=${JSON.stringify(location)}`
    );

    const stationId = `${tenantPartner.id}-${location.id}-${Math.random().toString(36).substring(2, 15)}`;
    
    const coordinates = {
      type: 'Point',
      coordinates: [Number(location.coordinates.longitude), Number(location.coordinates.latitude)],
    };
    const response = await this.ocpiGraphqlClient.request<any, any>(UPSERT_LOCATION_MUTATION, {
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
          publishUpstream: false,
          createdAt: new Date(),
          updatedAt: location.last_updated ?? new Date(),
        },
      });

    const stationIdVariables = { locationId: response.insert_Locations_one.id, partnerId: tenantPartner.id };
    let idChargingStationAssociatedWithLocation = null
    console.log('BEFORE CREATE VIRTUAL CHARGING STATION I AM HERE !!!', response)
    const stationIdFoundResponse = await this.ocpiGraphqlClient.request<any, any>(
      GET_CHARGING_STATION_BY_LOCATION_ID_AND_OWNER_PARTNER_ID,
      stationIdVariables,
    );
    console.log('stationIdFoundResponse ', stationIdFoundResponse)

    if(stationIdFoundResponse.ChargingStations.length === 0) {
      console.log('creating virtual charging station for partner ', tenantPartner.id, ' and location ', locationId)
      const responseCreateVirtualChargingStation = await this.createVirtualChargingStationForPartnerAndLocation(response.insert_Locations_one.id, tenantPartner)
      idChargingStationAssociatedWithLocation = responseCreateVirtualChargingStation?.insert_ChargingStations_one?.id ?? null;
    }
    else {
      idChargingStationAssociatedWithLocation = stationIdFoundResponse.ChargingStations[0].id ?? null;
    }
    console.log('idChargingStationAssociatedWithLocation ', idChargingStationAssociatedWithLocation)
    
    for (const evse of location.evses ?? []) {
      await this.upsertEvseForPartnerAndLocation(location.id, tenantPartner, evse.uid, evse, idChargingStationAssociatedWithLocation);
    }  
  }
  async putLocationByCountryPartyAndId(
    countryCode: string,
    partyId: string,
    location: LocationDTO,
    locationId: string,
    ctx: any,
  ): Promise<LocationResponse> {
    this.logger.info(
      `Receiver PUT location ${countryCode}/${partyId} body=${JSON.stringify(location)}`
    );

    console.log('ctx state ', ctx.state)
    if(!ctx.state.tenantPartner) {
      throw new UnauthorizedException('Credentials not found for given token');
    }

    const variables = { id: locationId, partnerId: ctx.state.tenantPartner.id };
    console.log('variables ', variables)
    const response = await this.ocpiGraphqlClient.request<any, any>(
      GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY,
      variables,
    );
    console.log('response GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY ', response)

    
    await this.upsertLocationForPartnerAndCountryParty(countryCode, partyId, location, locationId, ctx.state.tenantPartner);

    return buildOcpiResponse(
        OcpiResponseStatusCode.GenericSuccessCode,
        location,
    ) as LocationResponse;
  }

  async createVirtualChargingStationForPartnerAndLocation (
    locationId: string,
    tenantPartner: TenantPartnerDto
  ):
  Promise<any> {
    console.log('creating virtual charging station for partner ', tenantPartner.id, ' and location ', locationId)
    console.log('tenantPartner.tenantId ', tenantPartner.tenantId)
    console.log('!!! location ', locationId)
    const response = await this.ocpiGraphqlClient.request<any, any>(INSERT_CHARGING_STATION_MUTATION, {
      object: {
        id: `${tenantPartner.id}-${locationId}-${Math.random().toString(36).substring(2, 15)}`,
        locationId: Number(locationId),
        tenantId: tenantPartner.tenantId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    console.log('response ', response)
    return response
  }

  async upsertConnectorForPartnerAndEvse(
    locationId: string,
    tenantPartner: TenantPartnerDto,
    connector: any,
    evseId: string,
    stationId: string,
    status: EvseStatus,
  ): Promise<void> {
    const response = await this.ocpiGraphqlClient.request<any, any>(UPSERT_CONNECTOR_MUTATION, {
      object: {
        ocpiId: connector.id,                              // ← ADD
        stationId,
        evseId: Number(evseId),
        connectorId: Number(evseId) * 1000 + (Number(connector.id) || 1),
        type: connector.standard,
        format: connector.format,
        powerType: connector.power_type ?? null,           // ← ADD
        tenantId: tenantPartner.tenantId,
        maximumAmperage: connector.max_amperage ?? null,
        maximumVoltage: connector.max_voltage ?? null,     // ← ADD
        maximumPowerWatts: connector.max_electric_power ?? null,
        termsAndConditionsUrl: connector.terms_and_conditions ?? null,
        timestamp: connector.last_updated ?? new Date().toISOString(), // ← ADD
        status: status,
        createdAt: new Date(),
        updatedAt: connector.last_updated ?? new Date(),
      }
    });
    console.log('response ', response)
  }

  async upsertEvseForPartnerAndLocation(
    locationId: string,
    tenantPartner: TenantPartnerDto,
    evseUid: string,
    evse: LocationEvseDTO,
    stationId: string,
  ): Promise<void> {
    console.log('inserting evse for partner ', tenantPartner.id, ' and location ', locationId, ' and evse uid ', evseUid)
    console.log('tenantPartner.tenantId ', tenantPartner.tenantId)
    console.log('!!! evse CHANGED again!!! ', evse)
    const response = await this.ocpiGraphqlClient.request<any, any>(UPSERT_EVSE_MUTATION, {
      object: {
        ocpiUid: evse.uid,
        evseId: evse.evse_id ?? '',
        stationId: stationId,
        physicalReference: evse.physical_reference?.toString() ?? null,
        capabilities: evse.capabilities ?? null,
        floorLevel: evse.floor_level ?? null,
        coordinates: evse.coordinates ? {
          type: 'Point',
          coordinates: [Number(evse.coordinates.longitude), Number(evse.coordinates.latitude)]
        } : null,
        parkingRestrictions: evse.parking_restrictions ?? null,
        statusSchedule: evse.status_schedule ?? null,
        images: evse.images ?? null,
        directions: evse.directions ?? null,
        tenantId: tenantPartner.tenantId,
        createdAt: new Date(),
        updatedAt: evse.last_updated ?? new Date(), 
      }
    });
    
    const insertedEvseId = response?.insert_Evses_one?.id;
    console.log('insertedEvseId ', insertedEvseId)
    if (insertedEvseId != null && evse.connectors?.length) {
      for (const connector of evse.connectors) {
        await this.upsertConnectorForPartnerAndEvse(
          locationId,
          tenantPartner,
          connector,
          String(insertedEvseId),
          stationId,
          evse.status as EvseStatus,
        );
      }
    }
    console.log('response ', response)
  }

  async putEvseByCountryPartyAndId(
    countryCode: string,
    partyId: string,
    locationId: string,
    evseUid: string,
    evse: LocationEvseDTO,
    ctx: any,
  ): Promise<LocationResponse> {
    this.logger.info(
      `Receiver PUT evse ${countryCode}/${partyId}/${locationId}/${evseUid} body=${JSON.stringify(evse)}`
    );
    console.log('ctx state ', ctx.state)
    if(!ctx.state.tenantPartner) {
      throw new UnauthorizedException('Credentials not found for given token');
    }

    // const variables = { tenantPartnerId: ctx.state.tenantPartner.id, locationId };
    const variables = { id: locationId, partnerId: ctx.state.tenantPartner.id };
    console.log('variables ', variables)
    const response = await this.ocpiGraphqlClient.request<any, any>(
      GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY,
      variables,
    );
    console.log('response ', response)

    if (!response.Locations || response.Locations.length === 0) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientUnknownLocation, // 2003
        'Unknown location',
      ) as LocationResponse;
    }

    const evseVariables = { partnerId: ctx.state.tenantPartner.id, locationId: locationId, evseId: evseUid };
    console.log('evse Var !', evseVariables)
    const evseResponse = await this.ocpiGraphqlClient.request<any, any>(
      GET_EVSE_BY_LOCATION_ID_AND_OWNER_PARTNER_ID,
      evseVariables,
    );
    const location_id = evseResponse.Locations[0].id;
    console.log('location_id ', location_id)
    console.log('evseResponse ', evseResponse)

    console.log('evseResponse.Locations[0].chargingPool ', evseResponse.Locations[0].chargingPool.length)
    console.log('evseResponse.Locations[0].chargingPool[0] ', evseResponse.Locations[0].chargingPool[0])

    console.log('evseResponse.Locations[0].chargingPool[0].evses ', evseResponse.Locations[0].chargingPool[0].evses.length)

    // no charging station
    if(evseResponse.Locations[0].chargingPool.length === 0) {
      console.log('creating virtual charging station for partner ', ctx.state.tenantPartner.id, ' and location ', locationId)
      await this.createVirtualChargingStationForPartnerAndLocation(locationId, ctx.state.tenantPartner)
    }
    else if(evseResponse.Locations[0].chargingPool.length >= 1 && evseResponse.Locations[0].chargingPool[0].evses.length === 0) {
      console.log('inserting evse for partner ', ctx.state.tenantPartner.id, ' and location ', locationId, ' and evse uid ', evseUid)
      console.log('charging station ', evseResponse.Locations[0].chargingPool[0])
      await this.upsertEvseForPartnerAndLocation(locationId, ctx.state.tenantPartner, evseUid, evse, evseResponse.Locations[0].chargingPool[0].id)
    }
    else if(evseResponse.Locations[0].chargingPool.length > 1 && evseResponse.Locations[0].chargingPool[0].evses.length > 0) {
      console.log('updating evse for partner ', ctx.state.tenantPartner.id, ' and location ', locationId, ' and evse uid ', evseUid)
      console.log('multiple charging stations found, and evses found')
    }

    await this.ocpiGraphqlClient.request<any, any>(
      UPDATE_LOCATION_PATCH_MUTATION,
      { id: location_id, changes: { updatedAt: evse.last_updated } },
    );

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
    ctx: any,
  ): Promise<LocationResponse> {
    this.logger.info(
      `Receiver PUT connector ${countryCode}/${partyId}/${locationId}/${evseUid}/${connectorId} body=${JSON.stringify(connector)}`
    );
  
    if (!ctx.state?.tenantPartner) {
      throw new UnauthorizedException('Credentials not found for given token');
    }
  
    const variables = { locationId: locationId, partnerId: ctx.state.tenantPartner.id, evseUid: evseUid };
    console.log('variables ', variables)
    const lookupResponse = await this.ocpiGraphqlClient.request<any, any>(
      GET_EVSE_BY_OCPI_ID_AND_PARTNER_ID_QUERY,
      variables,
    );

    console.log('lookupResponse CHANGED again!!!', lookupResponse)
    console.log('lookupResponse.Locations ', lookupResponse.Locations)
    console.log('lookupResponse.ChargingStation ', lookupResponse?.Evses[0]?.ChargingStation)

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
        evseId: evse.id,               // DB integer id from Evses[0].id
        stationId: chargingStation.id, // from Evses[0].ChargingStation.id
        connectorId: evse.id * 1000 + (Number(connector.id) || 1),
        type: connector.standard,      // ← still has enum mismatch issue
        format: connector.format,
        powerType: connector.power_type ?? null,
        maximumVoltage: connector.max_voltage ?? null,
        maximumAmperage: connector.max_amperage ?? null,
        maximumPowerWatts: connector.max_electric_power ?? null,
        termsAndConditionsUrl: connector.terms_and_conditions ?? null,
        tenantId: ctx.state.tenantPartner.tenantId,
        timestamp: connector.last_updated,
        updatedAt: connector.last_updated ?? new Date(),
        createdAt: new Date(),
      }
    })

    // 3) cascade timestamps to parents
    await this.ocpiGraphqlClient.request<any, any>(
      UPDATE_EVSE_PATCH_MUTATION,
      { id: evse.id, changes: { updatedAt: ts } },
    );
  
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
            coordinates: [Number(input.coordinates.longitude), Number(input.coordinates.latitude)],
          }
        : null;
    }
  
    if (has(input, 'parking_type')) out.parkingType = input.parking_type ?? null;
    if (has(input, 'time_zone')) out.timeZone = input.time_zone ?? null;
    if (has(input, 'operator')) out.operator = input.operator ?? null;
    if (has(input, 'suboperator')) out.suboperator = input.suboperator ?? null;
    if (has(input, 'owner')) out.owner = input.owner ?? null;
    if (has(input, 'related_locations')) out.relatedLocations = input.related_locations ?? null;
    if (has(input, 'charging_when_closed')) out.chargingWhenClosed = input.charging_when_closed ?? null;
  
    if (has(input, 'last_updated')) out.updatedAt = new Date(input.last_updated as any);
  
    return out;
  }

  async patchLocationByCountryPartyAndId(
    countryCode: string,
    partyId: string,
    locationId: string,
    location: Partial<LocationDTO>,
    ctx: any,
  ): Promise<LocationResponse> {
    this.logger.info(
      `Receiver PATCH location ${countryCode}/${partyId}/${locationId} body=${JSON.stringify(location)}`
    );

    if (!location.last_updated) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientInvalidOrMissingParameters,
        'PATCH requires last_updated',
      ) as LocationResponse;
    }

    const variables = { partnerId: ctx.state.tenantPartner.id, locationId };
    const response = await this.ocpiGraphqlClient.request<any, any>(
      GET_PARTNER_LOCATION_BY_OCPI_ID,
      variables,
    );
    console.log('response GET_PARTNER_LOCATION_BY_OCPI_ID ', response)

    if (!response.Locations || response.Locations.length === 0) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientUnknownLocation, // 2003
        'Unknown location',
      ) as LocationResponse;
    }

    const dbLocationId = response.Locations[0].id;
    const locationPatch = this.mapLocationPatch(location);
    const responseUpdateLocation = await this.ocpiGraphqlClient.request<any, any>(
      UPDATE_LOCATION_PATCH_MUTATION,
      {
        id: dbLocationId,
        changes: locationPatch,
      },
    );
    console.log('response UPDATE_LOCATION_PATCH_MUTATION ', responseUpdateLocation)

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
    if (has(input, 'status_schedule')) out.statusSchedule = input.status_schedule ?? null;
    if (has(input, 'capabilities')) out.capabilities = input.capabilities ?? null;
  
    if (has(input, 'evse_id')) out.evseId = input.evse_id ?? null;
    if (has(input, 'physical_reference')) out.physicalReference = input.physical_reference?.toString() ?? null;
    if (has(input, 'floor_level')) out.floorLevel = input.floor_level ?? null;
  
    if (has(input, 'coordinates')) {
      out.coordinates = input.coordinates
        ? {
            type: 'Point',
            coordinates: [Number(input.coordinates.longitude), Number(input.coordinates.latitude)],
          }
        : null;
    }
  
    if (has(input, 'parking_restrictions')) out.parkingRestrictions = input.parking_restrictions ?? null;
    if (has(input, 'images')) out.images = input.images ?? null;
    if (has(input, 'directions')) out.directions = input.directions ?? null;
  
    if (has(input, 'last_updated')) out.updatedAt = new Date(input.last_updated as any);
  
    return out;
  }

  async patchEvseByCountryPartyAndId(
    countryCode: string,
    partyId: string,
    locationId: string,
    evseUid: string,
    evse: Partial<LocationEvseDTO>,
    ctx: any,
  ): Promise<LocationResponse> {
    this.logger.info(
      `Receiver PATCH evse ${countryCode}/${partyId}/${locationId}/${evseUid} body=${JSON.stringify(evse)}`
    );

    if (!evse.last_updated) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientInvalidOrMissingParameters,
        'PATCH requires last_updated',
      ) as LocationResponse;
    }

const lookupResponse = await this.ocpiGraphqlClient.request<any, any>(
  GET_PARTNER_EVSE_BY_OCPI_ID,
  {
    partnerId: ctx.state.tenantPartner.id,
    locationId: locationId,       // OCPI string: "LOC1"
    evseUid: evseUid,             // OCPI string: "3256"
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

    const dbEvseId = evses[0].id;             // DB integer
    const dbLocationId = lookupResponse.Locations[0].id;  // DB integer
    const evsePatch = this.mapEvsePatch(evse);
    const responseUpdateEvse = await this.ocpiGraphqlClient.request<any, any>(
      UPDATE_EVSE_PATCH_MUTATION,
      {
        id: dbEvseId,
        changes: evsePatch,
      },
    );
    console.log('response UPDATE_EVSE_PATCH_MUTATION ', responseUpdateEvse)
    const responseUpdateLocation = await this.ocpiGraphqlClient.request<any, any>(
      UPDATE_LOCATION_PATCH_MUTATION,
      {
        id: dbLocationId,
        changes: { updatedAt: new Date(evse.last_updated as any) },
      },
    );
    console.log('response UPDATE_LOCATION_PATCH_MUTATION ', responseUpdateLocation)

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
  
    if (has(input, 'max_voltage')) out.maximumVoltage = input.max_voltage ?? null;
    if (has(input, 'max_amperage')) out.maximumAmperage = input.max_amperage ?? null;
    if (has(input, 'max_electric_power')) out.maximumPowerWatts = input.max_electric_power ?? null;
  
    if (has(input, 'terms_and_conditions')) out.termsAndConditionsUrl = input.terms_and_conditions ?? null;
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
    connector: Partial<ConnectorDTO>, // or Partial<LocationConnectorDTO> depending your DTOs
    ctx: any,
  ): Promise<LocationResponse> {
    this.logger.info(
      // `Receiver PATCH connector ${countryCode}/${partyId}/${locationId}/${connectorUid} body=${JSON.stringify(connector)}`
      `Receiver PATCH connector ${countryCode}/${partyId}/${locationId}/${evseUid}/${connectorId} body=${JSON.stringify(connector)}`
    );

    if (!connector.last_updated) {
      return buildOcpiErrorResponse(
        OcpiResponseStatusCode.ClientInvalidOrMissingParameters,
        'PATCH requires last_updated',
      ) as LocationResponse;
    }
  // 1) Resolve by OCPI ids + partner
  const lookupResponse = await this.ocpiGraphqlClient.request<any, any>(
    GET_PARTNER_CONNECTOR_BY_OCPI_ID_AND_EVSE_ID, // create this query
    {
      partnerId: ctx.state.tenantPartner.id,
      locationId,
      evseUid,
      connectorId,
    },
  );
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
  await this.ocpiGraphqlClient.request<any, any>(
    UPDATE_EVSE_PATCH_MUTATION,
    {
      id: dbEvseId,
      changes: { updatedAt: ts },
    },
  );
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