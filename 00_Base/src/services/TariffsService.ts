// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { Service } from 'typedi';
import type { TariffDTO } from '../model/DTO/tariffs/TariffDTO.js';
import type { PutTariffRequest } from '../model/DTO/tariffs/PutTariffRequest.js';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../model/PaginatedResponse.js';
import { OcpiHeaders } from '../model/OcpiHeaders.js';
import { PaginatedParams } from '../controllers/param/PaginatedParams.js';
import type {
  CreateOrUpdateTariffMutationResult,
  CreateOrUpdateTariffMutationVariables,
  CreateOrUpdatePartnerTariffMutationResult,
  CreateOrUpdatePartnerTariffMutationVariables,
  DeleteTariffByPartnerMutationResult,
  DeleteTariffByPartnerMutationVariables,
  GetTariffByKeyQueryResult,
  GetTariffByKeyQueryVariables,
  GetTariffByOcpiIdQueryResult,
  GetTariffByOcpiIdQueryVariables,
  GetTariffByPartnerQueryResult,
  GetTariffByPartnerQueryVariables,
  GetTariffsQueryResult,
  GetTariffsQueryVariables,
  GetTenantPartnerIdByCountryPartyQueryResult,
  GetTenantPartnerIdByCountryPartyQueryVariables,
  Tariffs_Bool_Exp,
} from '../graphql/index.js';
import {
  CREATE_OR_UPDATE_TARIFF_MUTATION,
  CREATE_OR_UPDATE_PARTNER_TARIFF_MUTATION,
  DELETE_TARIFF_BY_PARTNER_MUTATION,
  GET_TARIFF_BY_KEY_QUERY,
  GET_TARIFF_BY_OCPI_ID_QUERY,
  GET_TARIFF_BY_PARTNER_QUERY,
  GET_TARIFFS_QUERY,
  GET_TENANT_PARTNER_ID_BY_COUNTRY_PARTY,
  OcpiGraphqlClient,
  GET_TARIFF_ID_BY_OCPI_ID_QUERY,
  DELETE_TARIFF_ELEMENTS_MUTATION,
} from '../graphql/index.js';
import { NotFoundException } from '../exception/NotFoundException.js';
import { TariffMapper, type TariffMapInput } from '../mapper/index.js';

@Service()
export class TariffsService {
  constructor(private readonly ocpiGraphqlClient: OcpiGraphqlClient) {}

  async getTariffByKey(key: {
    id: number;
    countryCode: string;
    partyId: string;
  }): Promise<TariffDTO | undefined> {
    const result = await this.ocpiGraphqlClient.request<
      GetTariffByKeyQueryResult,
      GetTariffByKeyQueryVariables
    >(GET_TARIFF_BY_KEY_QUERY, key);
    const tariff = result.Tariffs?.[0];
    if (tariff) {
      return TariffMapper.mapForSender(tariff as TariffMapInput);
    }
    return undefined;
  }

  /**
   * Receiver GET: retrieve a tariff by its OCPI id (CiString(36)).
   * When the country_code/party_id identify a TenantPartner (CPO source),
   * we filter via the TenantPartner relationship instead of Tenant.
   */
  async getTariffByOcpiId(
    countryCode: string,
    partyId: string,
    tariffId: string,
    isPartnerLookup = false,
  ): Promise<TariffDTO | undefined> {
    if (isPartnerLookup) {
      const tpResult = await this.ocpiGraphqlClient.request<
        GetTenantPartnerIdByCountryPartyQueryResult,
        GetTenantPartnerIdByCountryPartyQueryVariables
      >(GET_TENANT_PARTNER_ID_BY_COUNTRY_PARTY, { countryCode, partyId });
      const tenantPartnerId = tpResult.TenantPartners?.[0]?.id;
      if (tenantPartnerId === undefined) {
        return undefined;
      }
      const result = await this.ocpiGraphqlClient.request<
        GetTariffByPartnerQueryResult,
        GetTariffByPartnerQueryVariables
      >(GET_TARIFF_BY_PARTNER_QUERY, {
        ocpiTariffId: tariffId,
        tenantPartnerId,
      });
      const tariff = result.Tariffs?.[0];
      if (tariff) {
        return TariffMapper.mapForReceiver(tariff as TariffMapInput);
      }
      return undefined;
    }

    const result = await this.ocpiGraphqlClient.request<
      GetTariffByOcpiIdQueryResult,
      GetTariffByOcpiIdQueryVariables
    >(GET_TARIFF_BY_OCPI_ID_QUERY, {
      ocpiTariffId: tariffId,
      countryCode,
      partyId,
    });
    const tariff = result.Tariffs?.[0];
    if (tariff) {
      return TariffMapper.mapForReceiver(tariff as TariffMapInput);
    }
    return undefined;
  }

  /**
   * Sender GET: returns our own tariffs only (tenantPartnerId IS NULL).
   * Tariffs received from partner CPOs are excluded from the Sender interface.
   */
  async getTariffs(
    ocpiHeaders: OcpiHeaders,
    paginationParams?: PaginatedParams,
  ): Promise<{ data: TariffDTO[]; count: number }> {
    const limit = paginationParams?.limit ?? DEFAULT_LIMIT;
    const offset = paginationParams?.offset ?? DEFAULT_OFFSET;
    const where = {
      Tenant: {
        countryCode: { _eq: ocpiHeaders.toCountryCode },
        partyId: { _eq: ocpiHeaders.toPartyId },
      },
      tenantPartnerId: { _is_null: true },
    } as unknown as Tariffs_Bool_Exp;
    const dateFilters: any = {};
    if (paginationParams?.dateFrom)
      dateFilters._gte = paginationParams.dateFrom.toISOString();
    if (paginationParams?.dateTo)
      dateFilters._lte = paginationParams?.dateTo.toISOString();
    if (Object.keys(dateFilters).length > 0) {
      where.updatedAt = dateFilters;
    }
    const variables = {
      limit,
      offset,
      where,
    };
    const result = await this.ocpiGraphqlClient.request<
      GetTariffsQueryResult,
      GetTariffsQueryVariables
    >(GET_TARIFFS_QUERY, variables);
    const mappedTariffs: TariffDTO[] = [];
    for (const tariff of result.Tariffs) {
      mappedTariffs.push(TariffMapper.mapForSender(tariff as TariffMapInput));
    }
    return {
      data: mappedTariffs,
      count: result.Tariffs.length,
    };
  }

  async createOrUpdateTariff(
    tariffRequest: PutTariffRequest,
    tenantId?: number,
    tenantPartnerId?: number,
  ): Promise<TariffDTO> {
    const { coreTariff, TariffElements } = TariffMapper.mapFromOcpi(
      tariffRequest,
      tenantId,
      tenantPartnerId,
    );

    const object = {
      ...coreTariff,
      TariffElements: {
        data: TariffElements,
      },
    };

    if (tenantPartnerId !== undefined) {
      // Delete existing elements first to avoid accumulation on repeated PUTs
      const existing = await this.ocpiGraphqlClient.request<any, any>(
        GET_TARIFF_ID_BY_OCPI_ID_QUERY,
        { ocpiTariffId: tariffRequest.id, tenantPartnerId },
      );
      const existingId = existing?.Tariffs?.[0]?.id;
      if (existingId) {
        await this.ocpiGraphqlClient.request<any, any>(
          DELETE_TARIFF_ELEMENTS_MUTATION,
          { tariffId: existingId },
        );
      }
    }

    if (tenantPartnerId !== undefined) {
      const result = await this.ocpiGraphqlClient.request<
        CreateOrUpdatePartnerTariffMutationResult,
        CreateOrUpdatePartnerTariffMutationVariables
      >(CREATE_OR_UPDATE_PARTNER_TARIFF_MUTATION, { object });
      if (!result.insert_Tariffs_one) {
        throw new Error(
          `Failed to create or update tariff ${tariffRequest.id}`,
        );
      }
      return TariffMapper.mapForReceiver(
        result.insert_Tariffs_one as TariffMapInput,
      );
    }

    const result = await this.ocpiGraphqlClient.request<
      CreateOrUpdateTariffMutationResult,
      CreateOrUpdateTariffMutationVariables
    >(CREATE_OR_UPDATE_TARIFF_MUTATION, { object });
    if (!result.insert_Tariffs_one) {
      throw new Error(`Failed to create or update tariff ${tariffRequest.id}`);
    }
    return TariffMapper.mapForSender(
      result.insert_Tariffs_one as TariffMapInput,
    );
  }

  async deleteTariff(
    countryCode: string,
    partyId: string,
    tariffId: string,
    isPartnerLookup = false,
  ): Promise<void> {
    if (isPartnerLookup) {
      const tpResult = await this.ocpiGraphqlClient.request<
        GetTenantPartnerIdByCountryPartyQueryResult,
        GetTenantPartnerIdByCountryPartyQueryVariables
      >(GET_TENANT_PARTNER_ID_BY_COUNTRY_PARTY, { countryCode, partyId });
      const tenantPartnerId = tpResult.TenantPartners?.[0]?.id;
      if (tenantPartnerId === undefined) {
        throw new NotFoundException(
          `Tariff ${tariffId} not found for ${countryCode}/${partyId}`,
        );
      }
      const result = await this.ocpiGraphqlClient.request<
        DeleteTariffByPartnerMutationResult,
        DeleteTariffByPartnerMutationVariables
      >(DELETE_TARIFF_BY_PARTNER_MUTATION, {
        ocpiTariffId: tariffId,
        tenantPartnerId,
      });
      if (!result.delete_Tariffs?.affected_rows) {
        throw new NotFoundException(
          `Tariff ${tariffId} not found for ${countryCode}/${partyId}`,
        );
      }
      return;
    }

    const tariff = await this.getTariffByOcpiId(
      countryCode,
      partyId,
      tariffId,
      false,
    );
    if (!tariff) {
      throw new NotFoundException(
        `Tariff ${tariffId} not found for ${countryCode}/${partyId}`,
      );
    }
  }
}
