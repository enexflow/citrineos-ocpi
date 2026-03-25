// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import {
  Get,
  JsonController,
  Param,
  Put,
  Patch,
  Ctx,
  Body,
} from 'routing-controllers';
import {
  BodyWithSchema,
  LocationDTOSchema,
  LocationDTOSchemaName,
  buildOcpiEmptyResponse,
  buildOcpiResponse,
  OcpiResponseStatusCode,
  EvseDTOSchema,
  EvseDTOSchemaName,
  ConnectorDTOSchema,
  ConnectorDTOSchemaName,
  OcpiEmptyResponseSchema,
  OcpiEmptyResponseSchemaName,
  buildOcpiErrorResponse,
} from '@citrineos/ocpi-base';
import type { TenantPartnerDto } from '@citrineos/base';

import type { ILocationsModuleApi } from './ILocationsModuleApi.js';
import type {
  ConnectorResponse,
  EvseResponse,
  LocationEvseDTO,
  LocationDTO,
  LocationResponse,
  OcpiEmptyResponse,
  PaginatedLocationResponse,
  EvseDTO,
  ConnectorDTO,
} from '@citrineos/ocpi-base';
import {
  AsOcpiFunctionalEndpoint,
  BaseController,
  ConnectorResponseSchema,
  ConnectorResponseSchemaName,
  EvseResponseSchema,
  EvseResponseSchemaName,
  EXTRACT_EVSE_ID,
  EXTRACT_STATION_ID,
  FunctionalEndpointParams,
  generateMockForSchema,
  generateMockOcpiPaginatedResponse,
  LocationResponseSchema,
  LocationResponseSchemaName,
  LocationsService,
  LocationReceiverService,
  ModuleId,
  OcpiHeaders,
  Paginated,
  PaginatedLocationResponseSchema,
  PaginatedLocationResponseSchemaName,
  PaginatedParams,
  ResponseSchema,
  versionIdParam,
  VersionNumber,
  VersionNumberParam,
} from '@citrineos/ocpi-base';
import { Service } from 'typedi';
import { HttpStatus } from '@citrineos/base';

const MOCK_PAGINATED_LOCATION = await generateMockOcpiPaginatedResponse(
  PaginatedLocationResponseSchema,
  PaginatedLocationResponseSchemaName,
  new PaginatedParams(),
);
const MOCK_LOCATION = await generateMockForSchema(
  LocationResponseSchema,
  LocationResponseSchemaName,
);
const MOCK_EVSE = await generateMockForSchema(
  EvseResponseSchema,
  EvseResponseSchemaName,
);
const MOCK_CONNECTOR = await generateMockForSchema(
  ConnectorResponseSchema,
  ConnectorResponseSchemaName,
);

/**
 * Server API for the provisioning component.
 */
@JsonController(`/:${versionIdParam}/${ModuleId.Locations}`)
@Service()
export class LocationsModuleApi
  extends BaseController
  implements ILocationsModuleApi
{
  /**
   * Constructs a new instance of the class.
   *
   * @param {LocationsService} locationsService - The Locations service.
   * @param {AdminLocationsService} adminLocationsService - The Admin Locations service.
   */
  constructor(
    readonly locationsService: LocationsService,
    readonly locationsReceiverService: LocationReceiverService,
    // readonly adminLocationsService: AdminLocationsService,
  ) {
    super();
  }

  //-- Sender Interface ------------------------------------------------------//

  /**
   * Sender Interface: GET /locations
   */
  @Get()
  @AsOcpiFunctionalEndpoint()
  @ResponseSchema(
    PaginatedLocationResponseSchema,
    PaginatedLocationResponseSchemaName,
    {
      statusCode: HttpStatus.OK,
      description: 'Successful response',
      examples: {
        success: MOCK_PAGINATED_LOCATION,
      },
    },
  )
  async getLocations(
    @VersionNumberParam() version: VersionNumber,
    @FunctionalEndpointParams() ocpiHeaders: OcpiHeaders,
    @Paginated() paginatedParams?: PaginatedParams,
  ): Promise<PaginatedLocationResponse> {
    return this.locationsService.getLocations(ocpiHeaders, paginatedParams);
  }

  /**
   * Sender Interface: GET /locations/:location_id
   */
  @Get('/:location_id')
  @AsOcpiFunctionalEndpoint()
  @ResponseSchema(LocationResponseSchema, LocationResponseSchemaName, {
    statusCode: HttpStatus.OK,
    description: 'Successful response',
    examples: {
      success: MOCK_LOCATION,
    },
  })
  async getLocationById(
    @VersionNumberParam() version: VersionNumber,
    @Param('location_id') locationId: number,
  ): Promise<LocationResponse> {
    return this.locationsService.getLocationById(locationId);
  }

  /**
   * Sender Interface: GET /locations/:location_id/:evse_uid
   */
  @Get('/:location_id/:evse_uid')
  @AsOcpiFunctionalEndpoint()
  @ResponseSchema(EvseResponseSchema, EvseResponseSchemaName, {
    statusCode: HttpStatus.OK,
    description: 'Successful response',
    examples: {
      success: MOCK_EVSE,
    },
  })
  async getEvseById(
    @VersionNumberParam() version: VersionNumber,
    @Param('location_id') locationId: number,
    @Param('evse_uid') evseUid: string,
  ): Promise<EvseResponse> {
    const stationId = EXTRACT_STATION_ID(evseUid);
    const evseId = EXTRACT_EVSE_ID(evseUid);

    return this.locationsService.getEvseById(
      locationId,
      stationId,
      Number(evseId),
    );
  }

  /**
   * Sender Interface: GET /locations/:location_id/:evse_uid/:connector_id
   */
  @Get('/:location_id/:evse_uid/:connector_id')
  @AsOcpiFunctionalEndpoint()
  @ResponseSchema(ConnectorResponseSchema, ConnectorResponseSchemaName, {
    statusCode: HttpStatus.OK,
    description: 'Successful response',
    examples: {
      success: MOCK_CONNECTOR,
    },
  })
  async getConnectorById(
    @VersionNumberParam() version: VersionNumber,
    @Param('location_id') locationId: number,
    @Param('evse_uid') evseUid: string,
    @Param('connector_id') connectorId: string,
  ): Promise<ConnectorResponse> {
    const stationId = EXTRACT_STATION_ID(evseUid);
    const evseId = EXTRACT_EVSE_ID(evseUid);

    return this.locationsService.getConnectorById(
      locationId,
      stationId,
      Number(evseId),
      Number(connectorId),
    );
  }

  //-- Receiver Interface ------------------------------------------------------//

  /**
   * Receiver Interface: GET /locations/:country_code/:party_id/:location_id
   */

  @Get('/receiver/:country_code/:party_id/:location_id')
  @AsOcpiFunctionalEndpoint()
  @ResponseSchema(LocationResponseSchema, LocationResponseSchemaName, {
    statusCode: HttpStatus.OK,
    description: 'CPO retrieves location stored in eMSP system',
  })
  async getLocationByCountryPartyAndId(
    @VersionNumberParam() version: VersionNumber,
    @Param('country_code') countryCode: string,
    @Param('party_id') partyId: string,
    @Param('location_id') locationId: string,
    @Ctx() ctx: any,
  ): Promise<LocationResponse> {
    console.log(
      '\n \n \n \n locationId I AM IN HERE IT IS UPDATED ',
      locationId,
    );

    const tenantPartner = ctx!.state!.tenantPartner as TenantPartnerDto;
    return this.locationsReceiverService.getLocationByCountryPartyAndId(
      countryCode,
      partyId,
      locationId,
      tenantPartner,
    );
  }

  /**
   * Receiver Interface: GET /locations/:country_code/:party_id/:location_id/:evse_uid
   */
  @Get('/receiver/:country_code/:party_id/:location_id/:evse_uid')
  @AsOcpiFunctionalEndpoint()
  @ResponseSchema(EvseResponseSchema, EvseResponseSchemaName, {
    statusCode: HttpStatus.OK,
    description: 'CPO retrieves EVSE stored in eMSP system',
  })
  async getEvseByCountryParty(
    @VersionNumberParam() version: VersionNumber,
    @Param('country_code') countryCode: string,
    @Param('party_id') partyId: string,
    @Param('location_id') locationId: string,
    @Param('evse_uid') evseUid: string,
    @Ctx() ctx: any,
  ): Promise<EvseResponse> {
    const tenantPartner = ctx!.state!.tenantPartner as TenantPartnerDto;
    const response =
      await this.locationsReceiverService.getEvseByCountryPartyAndId(
        countryCode,
        partyId,
        locationId,
        evseUid,
        tenantPartner,
      );
    return response as EvseResponse;
  }

  /**
   * Receiver Interface: GET /locations/:country_code/:party_id/:location_id/:evse_uid/:connector_id
   */
  @Get('/receiver/:country_code/:party_id/:location_id/:evse_uid/:connector_id')
  @AsOcpiFunctionalEndpoint()
  @ResponseSchema(ConnectorResponseSchema, ConnectorResponseSchemaName, {
    statusCode: HttpStatus.OK,
    description: 'CPO retrieves connector stored in eMSP system',
  })
  async getConnectorByCountryParty(
    @VersionNumberParam() version: VersionNumber,
    @Param('country_code') countryCode: string,
    @Param('party_id') partyId: string,
    @Param('location_id') locationId: string,
    @Param('evse_uid') evseUid: string,
    @Param('connector_id') connectorId: string,
    @Ctx() ctx: any,
  ): Promise<ConnectorResponse> {
    const tenantPartner = ctx!.state!.tenantPartner as TenantPartnerDto;
    const response =
      await this.locationsReceiverService.getConnectorByCountryPartyAndId(
        countryCode,
        partyId,
        locationId,
        evseUid,
        connectorId,
        tenantPartner,
      );
    return response as ConnectorResponse;
  }

  /**
   * Receiver Interface: PUT /locations/:country_code/:party_id/:location_id
   */
  @Put('/receiver/:country_code/:party_id/:location_id')
  @AsOcpiFunctionalEndpoint()
  @ResponseSchema(OcpiEmptyResponseSchema, OcpiEmptyResponseSchemaName, {
    statusCode: HttpStatus.OK,
    description: 'CPO updates location stored in eMSP system',
  })
  async putLocationByCountryParty(
    @VersionNumberParam() version: VersionNumber,
    @Param('country_code') countryCode: string,
    @Param('party_id') partyId: string,
    @Param('location_id') locationId: string,
    @BodyWithSchema(LocationDTOSchema, LocationDTOSchemaName)
    location: LocationDTO,
    @Ctx() ctx: any,
  ): Promise<OcpiEmptyResponse> {
    this.logger.info(
      `PUT receiver location ${countryCode}/${partyId}/${locationId} body=${JSON.stringify(location)}`,
    );
    const tenantPartner = ctx!.state!.tenantPartner as TenantPartnerDto;
    const response =
      await this.locationsReceiverService.syncLocationFromPartner(
        countryCode,
        partyId,
        location,
        locationId,
        tenantPartner,
      );
    return response as OcpiEmptyResponse;
  }

  /**
   * Receiver Interface: PUT /locations/:country_code/:party_id/:location_id/:evse_uid
   */
  @Put('/receiver/:country_code/:party_id/:location_id/:evse_uid')
  @AsOcpiFunctionalEndpoint()
  @ResponseSchema(OcpiEmptyResponseSchema, OcpiEmptyResponseSchemaName, {
    statusCode: HttpStatus.OK,
    description: 'CPO updates evse stored in eMSP system',
  })
  async putEvseByCountryParty(
    @VersionNumberParam() version: VersionNumber,
    @Param('country_code') countryCode: string,
    @Param('party_id') partyId: string,
    @Param('location_id') locationId: string,
    @Param('evse_uid') evseUid: string,
    @BodyWithSchema(EvseDTOSchema, EvseDTOSchemaName)
    evse: EvseDTO,
    @Ctx() ctx: any,
  ): Promise<OcpiEmptyResponse> {
    this.logger.info(
      `PUT receiver evse ${countryCode}/${partyId}/${locationId}/${evseUid} body=${JSON.stringify(evse)}`,
    );
    const tenantPartner = ctx!.state!.tenantPartner as TenantPartnerDto;
    const response = await this.locationsReceiverService.syncEvseFromPartner(
      countryCode,
      partyId,
      locationId,
      evseUid,
      evse,
      tenantPartner,
    );
    return response as OcpiEmptyResponse;
  }

  /**
   * Receiver Interface: PUT /locations/:country_code/:party_id/:location_id/:evse_uid/:connector_id
   */
  @Put('/receiver/:country_code/:party_id/:location_id/:evse_uid/:connector_id')
  @AsOcpiFunctionalEndpoint()
  @ResponseSchema(OcpiEmptyResponseSchema, OcpiEmptyResponseSchemaName, {
    statusCode: HttpStatus.OK,
    description: 'CPO updates connector stored in eMSP system',
  })
  async putConnectorByCountryParty(
    @VersionNumberParam() version: VersionNumber,
    @Param('country_code') countryCode: string,
    @Param('party_id') partyId: string,
    @Param('location_id') locationId: string,
    @Param('evse_uid') evseUid: string,
    @Param('connector_id') connectorId: string,
    @BodyWithSchema(ConnectorDTOSchema, ConnectorDTOSchemaName)
    connector: ConnectorDTO,
    @Ctx() ctx: any,
  ): Promise<OcpiEmptyResponse> {
    this.logger.info(
      `PUT receiver connector ${countryCode}/${partyId}/${locationId}/${evseUid}/${connectorId} body=${JSON.stringify(connector)}`,
    );
    const tenantPartner = ctx!.state!.tenantPartner as TenantPartnerDto;
    const response =
      await this.locationsReceiverService.syncConnectorFromPartner(
        countryCode,
        partyId,
        locationId,
        evseUid,
        connectorId,
        connector,
        tenantPartner,
      );
    return response as OcpiEmptyResponse;
  }

  /**
   * Receiver Interface: PATCH /locations/:country_code/:party_id/:location_id
   */
  @Patch('/receiver/:country_code/:party_id/:location_id')
  @AsOcpiFunctionalEndpoint()
  @ResponseSchema(OcpiEmptyResponseSchema, OcpiEmptyResponseSchemaName, {
    statusCode: HttpStatus.OK,
    description: 'CPO updates location stored in eMSP system',
  })
  async patchLocationByCountryParty(
    @VersionNumberParam() version: VersionNumber,
    @Param('country_code') countryCode: string,
    @Param('party_id') partyId: string,
    @Param('location_id') locationId: string,
    @BodyWithSchema(LocationDTOSchema.partial(), 'LocationDTOSchemaPatch')
    location: Partial<LocationDTO>,
    @Ctx() ctx: any,
  ): Promise<OcpiEmptyResponse> {
    this.logger.info(
      `PATCH receiver location ${countryCode}/${partyId}/${locationId} body=${JSON.stringify(location)}`,
    );
    const tenantPartner = ctx!.state!.tenantPartner as TenantPartnerDto;
    const response =
      await this.locationsReceiverService.applyLocationPatchFromPartner(
        countryCode,
        partyId,
        locationId,
        location,
        tenantPartner,
      );
    return response as OcpiEmptyResponse;
  }

  /**
   * Receiver Interface: PATCH /locations/:country_code/:party_id/:location_id/:evse_uid
   */
  @Patch('/receiver/:country_code/:party_id/:location_id/:evse_uid')
  @AsOcpiFunctionalEndpoint()
  @ResponseSchema(OcpiEmptyResponseSchema, OcpiEmptyResponseSchemaName, {
    statusCode: HttpStatus.OK,
    description: 'CPO updates evse stored in eMSP system',
  })
  async patchEvseByCountryParty(
    @VersionNumberParam() version: VersionNumber,
    @Param('country_code') countryCode: string,
    @Param('party_id') partyId: string,
    @Param('location_id') locationId: string,
    @Param('evse_uid') evseUid: string,
    @BodyWithSchema(EvseDTOSchema.partial(), 'EvseDTOSchemaPatch')
    evse: Partial<EvseDTO>,
    @Ctx() ctx: any,
  ): Promise<OcpiEmptyResponse> {
    this.logger.info(
      `PATCH receiver evse ${countryCode}/${partyId}/${locationId}/${evseUid} body=${JSON.stringify(evse)}`,
    );
    const tenantPartner = ctx!.state!.tenantPartner as TenantPartnerDto;
    const response =
      await this.locationsReceiverService.applyEvsePatchFromPartner(
        countryCode,
        partyId,
        locationId,
        evseUid,
        evse,
        tenantPartner,
      );
    return response as OcpiEmptyResponse;
  }

  /**
   * Receiver Interface: PATCH /locations/:country_code/:party_id/:location_id/:evse_uid/:connector_id
   */
  @Patch(
    '/receiver/:country_code/:party_id/:location_id/:evse_uid/:connector_id',
  )
  @AsOcpiFunctionalEndpoint()
  @ResponseSchema(OcpiEmptyResponseSchema, OcpiEmptyResponseSchemaName, {
    statusCode: HttpStatus.OK,
    description: 'CPO updates connector stored in eMSP system',
  })
  async patchConnectorByCountryParty(
    @VersionNumberParam() version: VersionNumber,
    @Param('country_code') countryCode: string,
    @Param('party_id') partyId: string,
    @Param('location_id') locationId: string,
    @Param('evse_uid') evseUid: string,
    @Param('connector_id') connectorId: string,
    @BodyWithSchema(ConnectorDTOSchema.partial(), 'ConnectorDTOSchemaPatch')
    connector: Partial<ConnectorDTO>,
    @Ctx() ctx: any,
  ): Promise<OcpiEmptyResponse> {
    this.logger.info(
      `PATCH receiver connector ${countryCode}/${partyId}/${locationId}/${evseUid}/${connectorId} body=${JSON.stringify(connector)}`,
    );
    const tenantPartner = ctx!.state!.tenantPartner as TenantPartnerDto;
    const response =
      await this.locationsReceiverService.applyConnectorPatchFromPartner(
        countryCode,
        partyId,
        locationId,
        evseUid,
        connectorId,
        connector,
        tenantPartner,
      );
    return response as OcpiEmptyResponse;
  }
}
