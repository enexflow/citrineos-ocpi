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
import type { TenantDto, TransactionDto } from '@zetra/citrineos-base';
import { HttpMethod } from '@zetra/citrineos-base';
import { SessionMapper } from '../mapper/index.js';
import { OcpiEmptyResponseSchema } from '../model/OcpiEmptyResponse.js';
import type { BroadcastParams } from '../trigger/BaseClientApi.js';
import { SessionBroadcastDedupeService } from '../services/SessionBroadcastDedupeService.js';
import {
  getOcpiToFromAuthorization,
  isGirevePartner,
  tokenOwnerPartnerFilter,
} from '../util/helpers.js';

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
    const txId = transactionDto.transactionId!;
    const path = `/${tenant.countryCode}/${tenant.partyId}/${txId}`;
    const { ocpiToCountryCode, ocpiToPartyId } = getOcpiToFromAuthorization(
      transactionDto.authorization,
    );

    const partnerId = tokenOwnerTenantPartnerId;
    await this.dedupeService.runExclusive(txId, partnerId, async () => {
      // An update handled before this insert already PUT the whole session (resync, or Gireve)
      // from a fresher snapshot. This insert snapshot would replace the partner's charging
      // periods with older ones while the cursor stays ahead, leaving a gap.
      if (this.dedupeService.getSentUntil(txId, partnerId)) {
        this.logger.debug(
          `Session ${txId} already sent to partner ${partnerId}, skipping the opening PUT`,
        );
        return;
      }
      const session =
        await this.sessionMapper.mapTransactionToSession(transactionDto);
      const sent = await this.broadcastSessionDeduped(
        txId,
        partnerId,
        tenant,
        session,
        HttpMethod.Put,
        path,
        tokenOwnerPartnerFilter(partnerId),
        ocpiToCountryCode,
        ocpiToPartyId,
      );
      if (sent) {
        // The PUT carries every period: later PATCHes append from where it ends
        this.dedupeService.advanceSentUntil(
          txId,
          partnerId,
          this.sessionMapper.getChargingPeriodsEnd(transactionDto),
        );
      }
    });
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
    // const session =
    //   await this.sessionMapper.mapPartialTransactionToPartialSession(
    //     transactionDto,
    //   );

    // const path = `/${tenant.countryCode}/${tenant.partyId}/${session.id}`;
    // await this.broadcastSession(
    //   tenant,
    //   session,
    //   HttpMethod.Patch,
    //   path,
    //   tokenOwnerTenantPartnerId,
    // );
    const txId = transactionDto.transactionId!;

    const path = `/${tenant.countryCode}/${tenant.partyId}/${transactionDto.transactionId}`;

    const ownerId = tokenOwnerTenantPartnerId;

    // Only the token owner receives the session: build just the body it gets
    // (Gireve: full PUT, standard partners: incremental PATCH)
    const owner = transactionDto.authorization?.tenantPartner;
    const tx = transactionDto as TransactionDto;
    await this.dedupeService.runExclusive(txId, ownerId, async () => {
      if (owner && isGirevePartner(owner)) {
        const putBody = await this.sessionMapper.mapTransactionToSession(tx);
        if (
          await this.broadcastSessionDeduped(
            txId,
            ownerId,
            tenant,
            putBody,
            HttpMethod.Put,
            path,
            (p) => p.id === ownerId && isGirevePartner(p),
            ocpiToCountryCode,
            ocpiToPartyId,
          )
        ) {
          // Marks the session as sent, so a late opening PUT does not overwrite this fresher one
          this.dedupeService.advanceSentUntil(
            txId,
            ownerId,
            this.sessionMapper.getChargingPeriodsEnd(tx),
          );
        }
        return;
      }
      const standardPartner: BroadcastParams<
        typeof OcpiEmptyResponseSchema
      >['partnerFilter'] = (p) => p.id === ownerId && !isGirevePartner(p);
      const sentUntil = this.dedupeService.getSentUntil(txId, ownerId);
      if (!sentUntil) {
        // Unknown cursor (restart, initial PUT failed): a PATCH could only guess which periods
        // the partner has, so PUT the whole session, which replaces its charging_periods
        this.logger.info(
          `No charging period cursor for session ${txId} and partner ${ownerId}, resyncing with a PUT`,
        );
        const putBody = await this.sessionMapper.mapTransactionToSession(tx);
        if (
          await this.broadcastSessionDeduped(
            txId,
            ownerId,
            tenant,
            putBody,
            HttpMethod.Put,
            path,
            standardPartner,
            ocpiToCountryCode,
            ocpiToPartyId,
          )
        ) {
          this.dedupeService.advanceSentUntil(
            txId,
            ownerId,
            this.sessionMapper.getChargingPeriodsEnd(tx),
          );
        }
        return;
      }
      const patchBody = await this.sessionMapper.mapIncrementalSessionPatch(
        tx,
        sentUntil,
      );
      // The cursor only moves once the partner has the periods: after a failed PATCH the
      // next one carries them again
      if (
        await this.broadcastSessionDeduped(
          txId,
          ownerId,
          tenant,
          patchBody,
          HttpMethod.Patch,
          path,
          standardPartner,
          ocpiToCountryCode,
          ocpiToPartyId,
        )
      ) {
        this.dedupeService.advanceSentUntil(
          txId,
          ownerId,
          this.sessionMapper.getChargingPeriodsEnd(tx),
        );
      }
    });
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
  ): Promise<boolean> {
    if (
      !this.dedupeService.shouldBroadcast(
        transactionId,
        partnerId,
        method,
        body,
      )
    ) {
      return false;
    }
    this.dedupeService.markInFlight(transactionId, partnerId, method);
    try {
      const responses = await this.sessionsClientApi.broadcastToClients({
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
      // broadcastToClients logs and swallows partner errors. The filter keeps only the token
      // owner, so no response means it did not get the session: do not record it as sent,
      // or the dedupe would skip the same body next time and the PATCH cursor would move on
      if (responses.length === 0) {
        this.dedupeService.markFailed(transactionId, partnerId, method);
        this.logger.warn(
          `broadcast${method}Session not delivered to partner ${partnerId} for ${path}`,
        );
        return false;
      }
      this.dedupeService.markSent(transactionId, partnerId, method, body);
      return true;
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
