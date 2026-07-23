// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { BaseBroadcaster } from './BaseBroadcaster.js';
import { Service } from 'typedi';
import { SessionsClientApi } from '../trigger/SessionsClientApi.js';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import type { Session } from '../model/Session.js';
import { ModuleId } from '../model/ModuleId.js';
import { InterfaceRole } from '../model/InterfaceRole.js';
import type {
  MeterValueDto,
  TenantDto,
  TenantPartnerDto,
  TransactionDto,
} from '@zetra/citrineos-base';
import { HttpMethod } from '@zetra/citrineos-base';
import { SessionMapper } from '../mapper/index.js';
import { OcpiEmptyResponseSchema } from '../model/OcpiEmptyResponse.js';
import type { BroadcastParams } from '../trigger/BaseClientApi.js';
import { SessionBroadcastDedupeService } from '../services/SessionBroadcastDedupeService.js';
import {
  getOcpiToFromAuthorization,
  isGirevePartner,
  tokenOwnerPartnerFilter,
  getChargingPeriodsMode,
} from '../util/helpers.js';
import {
  getTokenOwnerFromAuthorization,
  type AuthWithPartners,
} from '../util/helpers.js';

import { ChargingPeriodsMode } from '../model/ChargingPeriod.js';

@Service()
export class SessionBroadcaster extends BaseBroadcaster {
  constructor(
    readonly logger: Logger<ILogObj>,
    readonly sessionsClientApi: SessionsClientApi,
    readonly sessionMapper: SessionMapper,
    readonly dedupeService: SessionBroadcastDedupeService,
  ) {
    super();
  }

  async broadcastPutSession(
    tenant: TenantDto,
    transactionDto: TransactionDto,
    tokenOwnerTenantPartnerId?: number | null,
  ): Promise<void> {
    if (!tokenOwnerTenantPartnerId) {
      this.logger.debug('No token owner partner, skipping session broadcast');
      return;
    }
    const session = await this.sessionMapper.mapTransactionToSession(
      transactionDto,
      ChargingPeriodsMode.Cumulative,
    );
    const path = `/${tenant.countryCode}/${tenant.partyId}/${session.id}`;
    const { ocpiToCountryCode, ocpiToPartyId } = getOcpiToFromAuthorization(
      transactionDto.authorization,
    );

    await this.broadcastSessionDeduped(
      session.id!,
      tokenOwnerTenantPartnerId,
      tenant,
      session,
      HttpMethod.Put,
      path,
      tokenOwnerPartnerFilter(tokenOwnerTenantPartnerId),
      ocpiToCountryCode,
      ocpiToPartyId,
    );
  }

  async broadcastPatchSession(
    tenant: TenantDto,
    transactionDto: TransactionDto,
    tokenOwnerTenantPartnerId?: number | null,
  ): Promise<void> {
    if (tokenOwnerTenantPartnerId == null) {
      this.logger.debug('No token owner partner, skipping session broadcast');
      return;
    }
    const { ocpiToCountryCode, ocpiToPartyId } = getOcpiToFromAuthorization(
      transactionDto.authorization,
    );
    const txId = transactionDto.transactionId!;

    const path = `/${tenant.countryCode}/${tenant.partyId}/${transactionDto.transactionId}`;
    // Standard partners: PATCH incremental

    const ownerId = tokenOwnerTenantPartnerId;
    const auth = (transactionDto.authorization ?? {}) as AuthWithPartners;
    const tokenOwner = getTokenOwnerFromAuthorization(auth);
    const mode = getChargingPeriodsMode(tokenOwner);
    if (mode === ChargingPeriodsMode.Cumulative) {
      const body = await this.sessionMapper.mapTransactionToSession(
        transactionDto,
        mode,
      );

      await this.broadcastSessionDeduped(
        txId,
        ownerId,
        tenant,
        body,
        HttpMethod.Put,
        path,
        (p) => p.id === ownerId && isGirevePartner(p),
        ocpiToCountryCode,
        ocpiToPartyId,
      );
    } else {
      const body =
        await this.sessionMapper.mapIncrementalSessionPatch(transactionDto);
      await this.broadcastSessionDeduped(
        txId,
        ownerId,
        tenant,
        body,
        HttpMethod.Patch,
        path,
        (p) => p.id === ownerId && !isGirevePartner(p),
        ocpiToCountryCode,
        ocpiToPartyId,
      );
    }
  }

  async broadcastPatchSessionChargingPeriod(
    tenant: TenantDto,
    meterValueDto: MeterValueDto,
    tokenOwnerTenantPartnerId?: number | null,
  ): Promise<void> {
    // const charging_periods = await this.sessionMapper.getChargingPeriods(
    //   [meterValueDto],
    //   meterValueDto.tariffId!.toString(),
    // );
    const charging_periods = this.sessionMapper.getChargingPeriods(
      {
        transactionId: meterValueDto.transactionId!,
        meterValues: [meterValueDto],
        totalKwh: undefined,
        // other TransactionDto fields unused by Append mapping for a single meter
      } as TransactionDto,
      meterValueDto.tariffId!.toString(),
      ChargingPeriodsMode.Append,
    );
    const path = `/${tenant.countryCode}/${tenant.partyId}/${meterValueDto.transactionId}`;
    await this.broadcastSession(
      tenant,
      { charging_periods },
      HttpMethod.Patch,
      path,
      tokenOwnerPartnerFilter(tokenOwnerTenantPartnerId!),
    );
  }

  private async broadcastSession(
    tenant: TenantDto,
    session: Partial<Session>,
    method: HttpMethod,
    path: string,
    partnerFilter?: BroadcastParams<
      typeof OcpiEmptyResponseSchema
    >['partnerFilter'],
    ocpiToCountryCode?: string | null,
    ocpiToPartyId?: string | null,
  ): Promise<void> {
    try {
      await this.sessionsClientApi.broadcastToClients({
        cpoCountryCode: tenant.countryCode!,
        cpoPartyId: tenant.partyId!,
        moduleId: ModuleId.Sessions,
        interfaceRole: InterfaceRole.RECEIVER,
        httpMethod: method,
        schema: OcpiEmptyResponseSchema,
        body: session,
        path: path,
        partnerFilter: partnerFilter,
        ocpiToCountryCode,
        ocpiToPartyId,
      });
    } catch (e) {
      this.logger.error(`broadcast${method}Session failed for ${path}`, e);
    }
  }

  private async broadcastSessionDeduped(
    transactionId: string,
    partnerId: number,
    tenant: TenantDto,
    body: Partial<Session>,
    method: HttpMethod,
    path: string,
    partnerFilter: BroadcastParams<
      typeof OcpiEmptyResponseSchema
    >['partnerFilter'],
    ocpiToCountryCode?: string | null,
    ocpiToPartyId?: string | null,
  ): Promise<void> {
    if (
      !this.dedupeService.shouldBroadcast(
        transactionId,
        partnerId,
        method,
        body,
      )
    ) {
      return;
    }
    this.dedupeService.markInFlight(transactionId, partnerId, method);
    try {
      await this.sessionsClientApi.broadcastToClients({
        cpoCountryCode: tenant.countryCode!,
        cpoPartyId: tenant.partyId!,
        moduleId: ModuleId.Sessions,
        interfaceRole: InterfaceRole.RECEIVER,
        httpMethod: method,
        schema: OcpiEmptyResponseSchema,
        body,
        path,
        partnerFilter,
        ocpiToCountryCode,
        ocpiToPartyId,
      });
      this.dedupeService.markSent(transactionId, partnerId, method, body);
    } catch (e) {
      this.dedupeService.markFailed(transactionId, partnerId, method);
      this.logger.error(`broadcast${method}Session failed for ${path}`, e);
      throw e;
    }
  }

  clearSessionBroadcastDedupe(transactionId: string): void {
    this.dedupeService.clear(transactionId);
  }
}
