// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type {
  AuthorizationDto,
  LocationDto,
  TariffDto,
  TransactionDto,
} from '@zetra/citrineos-base';
import type { TokenDTO } from '../model/DTO/TokenDTO.js';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import type { Price } from '../model/Price.js';
import type { Session } from '../model/Session.js';
import type { Tariff as OcpiTariff } from '../model/Tariff.js';
import type { LocationDTO } from '../model/DTO/LocationDTO.js';
import { LocationsService } from '../services/LocationsService.js';
import type {
  GetAuthorizationByIdQueryResult,
  GetAuthorizationByIdQueryVariables,
  GetOurLocationByIdQueryResult,
  GetOurLocationByIdQueryVariables,
  GetTariffByKeyQueryResult,
  GetTariffByKeyQueryVariables,
} from '../graphql/index.js';
import {
  GET_AUTHORIZATION_BY_ID,
  GET_OUR_LOCATION_BY_ID_QUERY,
  GET_TARIFF_BY_KEY_QUERY,
  OcpiGraphqlClient,
} from '../graphql/index.js';
import { LocationMapper } from './LocationMapper.js';
import { TokensMapper } from './TokensMapper.js';
import { TariffMapper } from './TariffMapper.js';
import { TariffDimensionType } from '../model/TariffDimensionType.js';
import { getOcpiSessionId } from '../util/OcpiObjectId.js';

export abstract class BaseTransactionMapper {
  protected constructor(
    protected logger: Logger<ILogObj>,
    protected locationsService: LocationsService,
    protected ocpiGraphqlClient: OcpiGraphqlClient,
  ) {}

  public async getLocationDTOsForTransactions(
    transactions: TransactionDto[],
  ): Promise<Map<string, LocationDTO>> {
    const sessionIdToLocationMap: Map<string, LocationDTO> = new Map();
    for (const transaction of transactions) {
      if (!transaction.location && transaction.locationId) {
        const result = await this.ocpiGraphqlClient.request<
          GetOurLocationByIdQueryResult,
          GetOurLocationByIdQueryVariables
        >(GET_OUR_LOCATION_BY_ID_QUERY, { id: transaction.locationId });
        transaction.location = result.Locations[0] as unknown as LocationDto;
      }
      const location = transaction.location;
      if (!location) {
        this.logger.debug(
          `Skipping transaction ${transaction.id} location ${transaction.locationId}`,
        );
        continue;
      }

      const locationDto = LocationMapper.fromGraphql(location);

      sessionIdToLocationMap.set(getOcpiSessionId(transaction), locationDto);
    }
    return sessionIdToLocationMap;
  }

  protected async getTokensForTransactions(
    transactions: TransactionDto[],
  ): Promise<Map<string, TokenDTO>> {
    const sessionIdToTokenMap: Map<string, TokenDTO> = new Map();

    for (const transaction of transactions) {
      if (!transaction.authorization && transaction.authorizationId) {
        const result = await this.ocpiGraphqlClient.request<
          GetAuthorizationByIdQueryResult,
          GetAuthorizationByIdQueryVariables
        >(GET_AUTHORIZATION_BY_ID, { id: transaction.authorizationId });
        if (result.Authorizations_by_pk) {
          transaction.authorization =
            result.Authorizations_by_pk as AuthorizationDto;
        }
      }
      if (transaction.authorization) {
        const tokenDto = TokensMapper.toDto(transaction.authorization);
        if (tokenDto) {
          sessionIdToTokenMap.set(getOcpiSessionId(transaction), tokenDto);
        } else {
          this.logger.debug(`Unmapped token for transaction ${transaction.id}`);
        }
      } else {
        this.logger.debug(`No token for transaction ${transaction.id}`);
      }
    }

    return sessionIdToTokenMap;
  }

  protected async getTariffsForTransactions(
    transactions: TransactionDto[],
  ): Promise<Map<string, TariffDto>> {
    const sessionIdToTariffMap = new Map<string, TariffDto>();
    for (const transaction of transactions) {
      if (!transaction.tariff && transaction.tariffId) {
        const result = await this.ocpiGraphqlClient.request<
          GetTariffByKeyQueryResult,
          GetTariffByKeyQueryVariables
        >(GET_TARIFF_BY_KEY_QUERY, {
          id: transaction.tariffId,
          countryCode: transaction.tenant!.countryCode!,
          partyId: transaction.tenant!.partyId!,
        });
        if (result.Tariffs[0]) {
          transaction.tariff = result.Tariffs[0] as unknown as TariffDto;
          // transaction.tariff = result.Tariffs[0] as TariffDto;
        }
      }
      const tariff = transaction.tariff;
      if (tariff) {
        sessionIdToTariffMap.set(getOcpiSessionId(transaction), tariff);
      } else {
        this.logger.debug(`No tariff for ${transaction.id}`);
      }
    }
    return sessionIdToTariffMap;
  }

  protected async getOcpiTariffsForTransactions(
    sessions: Session[],
    sessionIdToTariffMap: Map<string, TariffDto>,
  ): Promise<Map<string, OcpiTariff>> {
    const sessionIdToOcpiTariffMap = new Map<string, OcpiTariff>();
    await Promise.all(
      sessions
        .filter((session) => sessionIdToTariffMap.get(session.id))
        .map(async (session) => {
          const tariffVariables = {
            id: sessionIdToTariffMap.get(session.id)!.id!,
            // TODO: Ensure CPO Country Code, Party ID exists for the tariff in question
            countryCode: session.country_code,
            partyId: session.party_id,
          };
          const result = await this.ocpiGraphqlClient.request<
            GetTariffByKeyQueryResult,
            GetTariffByKeyQueryVariables
          >(GET_TARIFF_BY_KEY_QUERY, tariffVariables);
          // const tariff = result.Tariffs[0] as TariffDto;
          const tariff = result.Tariffs[0] as unknown as TariffDto;

          if (tariff) {
            sessionIdToOcpiTariffMap.set(
              session.id,
              TariffMapper.mapForSender(tariff),
            );
          }
        }),
    );
    return sessionIdToOcpiTariffMap;
  }

  protected calculateTotalCost(totalKwh: number, tariff: TariffDto): Price {
    // const tariffElement = tariff.TariffElements?.[0];
    const tariffElement = (
      tariff as unknown as {
        TariffElements?: Array<{
          priceComponents?: Array<{
            type: string;
            price?: number;
            vat?: number;
          }>;
        }>;
      }
    ).TariffElements?.[0];

    if (tariffElement) {
      const energyComponent = tariffElement.priceComponents?.find(
        (component) => component.type === TariffDimensionType.ENERGY,
      );

      const pricePerKwh = energyComponent?.price ?? 0;

      if (pricePerKwh > 0 || totalKwh === 0) {
        const priceExclVat = Math.round(totalKwh * pricePerKwh * 100) / 100;
        return { excl_vat: priceExclVat };
      } else {
        this.logger.error('No price per kwh found for tariff element', {
          tariffElement,
        });
        return {
          excl_vat: 0,
        };
      }
    } else {
      this.logger.error('No tariff element found for tariff', { tariff });
      return {
        excl_vat: 0,
      };
    }
  }
}
