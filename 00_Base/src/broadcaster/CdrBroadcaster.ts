// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { BaseBroadcaster } from './BaseBroadcaster.js';
import { Service } from 'typedi';
import { CdrsClientApi } from '../trigger/CdrsClientApi.js';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import type { CdrDTO } from '../model/DTO/CdrDTO.js';
import { ModuleId } from '../model/ModuleId.js';
import { InterfaceRole } from '../model/InterfaceRole.js';
import type { TransactionDto } from '@zetra/citrineos-base';
import { HttpMethod } from '@zetra/citrineos-base';
import { CdrMapper } from '../mapper/index.js';
import {
  OcpiEmptyResponseSchema,
  type OcpiEmptyResponse,
} from '../model/OcpiEmptyResponse.js';
import { OcpiResponseStatusCode } from '../model/OcpiResponse.js';
import {
  getOcpiToFromAuthorization,
  tokenOwnerPartnerFilter,
  type AuthWithPartners,
} from '../util/helpers.js';
import { CdrsService } from '../services/CdrsService.js';

@Service()
export class CdrBroadcaster extends BaseBroadcaster {
  constructor(
    readonly logger: Logger<ILogObj>,
    readonly cdrMapper: CdrMapper,
    readonly cdrsClientApi: CdrsClientApi,
    readonly cdrsService: CdrsService,
  ) {
    super();
  }

  async broadcastPostCdr(transactionDto: TransactionDto): Promise<void> {
    const cdrs: CdrDTO[] = await this.cdrMapper.mapTransactionsToCdrs([
      transactionDto,
    ]);
    if (cdrs.length === 0) {
      this.logger.warn(
        `No CDRs generated for Transaction: ${transactionDto.transactionId}`,
      );
      return;
    }
    const cdrDto = cdrs[0];
    const tokenOwnerTenantPartnerId =
      transactionDto.authorization?.tenantPartner?.id;
    if (tokenOwnerTenantPartnerId == null) {
      this.logger.debug('No token owner partner, skipping CDR broadcast');
      return;
    }
    const { ocpiToCountryCode, ocpiToPartyId } = getOcpiToFromAuthorization(
      transactionDto.authorization,
    );

    const auth = transactionDto.authorization as AuthWithPartners & {
      roamingPartnerId?: number | null;
    };
    const tenantId = transactionDto.authorization?.tenantPartner?.tenant?.id;
    let sentCdrId: number;
    try {
      sentCdrId = await this.cdrsService.insertSentCdr(
        transactionDto.authorization!.tenantPartner!,
        cdrDto,
        {
          tenantId: tenantId!,
          roamingPartnerId:
            auth.roamingPartner?.id ?? auth.roamingPartnerId ?? null,
          transactionId: transactionDto.id ?? null,
        },
      );
    } catch (e) {
      this.logger.error(
        `broadcastPostCdr failed to insert CDR ${cdrDto.id}`,
        e,
      );
      throw e;
    }

    try {
      const response = (await this.cdrsClientApi.broadcastToClients({
        cpoCountryCode: cdrDto.country_code!,
        cpoPartyId: cdrDto.party_id!,
        moduleId: ModuleId.Cdrs,
        interfaceRole: InterfaceRole.RECEIVER,
        httpMethod: HttpMethod.Post,
        schema: OcpiEmptyResponseSchema,
        body: cdrDto,
        partnerFilter: tokenOwnerPartnerFilter(tokenOwnerTenantPartnerId),
        ocpiToCountryCode,
        ocpiToPartyId,
      })) as unknown as OcpiEmptyResponse[];
      // we only send a CDR to one partner, so we expect exactly one response
      // with an OCPI-level success status_code
      const delivered =
        response.length === 1 &&
        response[0]?.status_code === OcpiResponseStatusCode.GenericSuccessCode;
      if (delivered) {
        await this.cdrsService.markCdrAsSent(
          sentCdrId,
          new Date().toISOString(),
        );
      } else {
        this.logger.error(
          `broadcastPostCdr not delivered for CDR ${cdrDto.id}`,
          response,
        );
      }
    } catch (e) {
      this.logger.error(`broadcastPostCdr failed for CDR ${cdrDto.id}`, e);
    }
  }
}
