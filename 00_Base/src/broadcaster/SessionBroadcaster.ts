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
import {
  type OcpiEmptyResponse,
  OcpiEmptyResponseSchema,
} from '../model/OcpiEmptyResponse.js';
import { OcpiResponseStatusCode } from '../model/OcpiResponse.js';
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
      if (
        this.dedupeService.getSentUntil(txId, partnerId) ||
        this.dedupeService.isOlderThanSent(
          txId,
          partnerId,
          snapshotTime(transactionDto),
        )
      ) {
        this.logger.debug(
          `Session ${txId} already sent to partner ${partnerId}, skipping the opening PUT`,
        );
        return;
      }
      const session =
        await this.sessionMapper.mapTransactionToSession(transactionDto);
      const result = await this.broadcastSessionDeduped(
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
      if (result === 'sent') {
        // The PUT carries every period: later PATCHes append from where it ends
        this.dedupeService.advanceSentUntil(
          txId,
          partnerId,
          this.sessionMapper.getChargingPeriodsEnd(transactionDto),
          snapshotTime(transactionDto),
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
    const snapshotAt = snapshotTime(tx);
    await this.dedupeService.runExclusive(txId, ownerId, async () => {
      // Out-of-order update: a newer snapshot was already sent (possibly the Ended one)
      if (this.dedupeService.isOlderThanSent(txId, ownerId, snapshotAt)) {
        this.logger.debug(
          `Skipping session ${txId} update for partner ${ownerId}: a newer snapshot was already sent`,
        );
        return;
      }
      if (owner && isGirevePartner(owner)) {
        const putBody = await this.sessionMapper.mapTransactionToSession(tx);
        if (
          (await this.broadcastSessionDeduped(
            txId,
            ownerId,
            tenant,
            putBody,
            HttpMethod.Put,
            path,
            (p) => p.id === ownerId && isGirevePartner(p),
            ocpiToCountryCode,
            ocpiToPartyId,
          )) === 'sent'
        ) {
          // Marks the session as sent, so a late opening PUT does not overwrite this fresher one
          this.dedupeService.advanceSentUntil(
            txId,
            ownerId,
            this.sessionMapper.getChargingPeriodsEnd(tx),
            snapshotAt,
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
          (await this.broadcastSessionDeduped(
            txId,
            ownerId,
            tenant,
            putBody,
            HttpMethod.Put,
            path,
            standardPartner,
            ocpiToCountryCode,
            ocpiToPartyId,
          )) === 'sent'
        ) {
          this.dedupeService.advanceSentUntil(
            txId,
            ownerId,
            this.sessionMapper.getChargingPeriodsEnd(tx),
            snapshotAt,
          );
        }
        return;
      }
      const patchBody = await this.sessionMapper.mapIncrementalSessionPatch(
        tx,
        sentUntil,
      );
      const result = await this.broadcastSessionDeduped(
        txId,
        ownerId,
        tenant,
        patchBody,
        HttpMethod.Patch,
        path,
        standardPartner,
        ocpiToCountryCode,
        ocpiToPartyId,
      );
      if (result === 'sent') {
        this.dedupeService.advanceSentUntil(
          txId,
          ownerId,
          this.sessionMapper.getChargingPeriodsEnd(tx),
          snapshotAt,
        );
      } else if (result === 'failed') {
        // The partner may lack the session (OCPI error such as 2003) or may have applied the
        // PATCH despite the error (timeout). A PATCH cannot fix either, so forget the cursor:
        // the next update PUTs the whole session, which replaces its periods (OCPI 4.1.4.3).
        this.dedupeService.forgetSentUntil(txId, ownerId);
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
  ): Promise<'sent' | 'skipped' | 'failed'> {
    if (
      !this.dedupeService.shouldBroadcast(
        transactionId,
        partnerId,
        method,
        body,
      )
    ) {
      return 'skipped';
    }
    try {
      // broadcastToClients is typed with the Zod schema, not the parsed response
      const responses = (await this.sessionsClientApi.broadcastToClients({
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
      })) as unknown as OcpiEmptyResponse[];
      // broadcastToClients logs and swallows partner errors, and an HTTP 200 can still carry
      // an OCPI error status_code (e.g. 2003 on an unknown session). The filter keeps only the
      // token owner, so delivered means one 1000 answer. Otherwise do not record it as sent,
      // or the dedupe would skip the same body next time and the PATCH cursor would move on.
      if (
        !responses.some(
          (response) =>
            response?.status_code === OcpiResponseStatusCode.GenericSuccessCode,
        )
      ) {
        this.logger.warn(
          `broadcast${method}Session not delivered to partner ${partnerId} for ${path}`,
          {
            statusCodes: responses.map((response) => response?.status_code),
          },
        );
        return 'failed';
      }
      this.dedupeService.markSent(transactionId, partnerId, method, body);
      return 'sent';
    } catch (e) {
      this.logger.error(`broadcast${method}Session failed for ${path}`, e);
      throw e;
    }
  }

  clearSessionBroadcastDedupe(transactionId: string): void {
    this.dedupeService.clear(transactionId);
  }
}

/** updatedAt of the transaction snapshot a broadcast is built from, used to order broadcasts. */
function snapshotTime(transaction: TransactionDto): Date | undefined {
  return transaction.updatedAt ? new Date(transaction.updatedAt) : undefined;
}
