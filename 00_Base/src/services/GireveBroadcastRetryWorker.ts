// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { Service, Container, Inject } from 'typedi';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import { OcpiConfigToken, type OcpiConfig } from '../config/ocpi.types.js';
import { ModuleId } from '../model/ModuleId.js';
import { HttpMethod } from '@zetra/citrineos-base';
import {
  OcpiEmptyResponseSchema,
  type OcpiEmptyResponse,
} from '../model/OcpiEmptyResponse.js';
import { OcpiResponseStatusCode } from '../model/OcpiResponse.js';
import { GET_TENANT_PARTNER_BY_ID } from '../graphql/queries/tenantPartner.queries.js';

import { SessionsClientApi } from '../trigger/SessionsClientApi.js';
import { CdrsClientApi } from '../trigger/CdrsClientApi.js';
import { TariffsClientApi } from '../trigger/TariffsClientApi.js';
import { OcpiGraphqlClient } from '../graphql/index.js';
import { CdrsService } from './CdrsService.js';

import {
  GireveBroadcastRetryOutbox,
  type GireveRetryQueueItem,
} from './GireveBroadcastRetryOutbox.js';
import {
  computeGireveNextRetryAt,
  getGireveRetryBackoffOptions,
  type GireveRetryBackoffOptions,
} from './gireveRetryBackoff.js';

export interface GireveRetryRunResult {
  processed: number;
  succeeded: number;
  failed: number;
  staleLocksReleased: number;
}

@Service()
export class GireveBroadcastRetryWorker {
  private get config(): OcpiConfig {
    return Container.get<OcpiConfig>(OcpiConfigToken);
  }

  private get backoffOptions(): GireveRetryBackoffOptions {
    return getGireveRetryBackoffOptions(this.config);
  }

  private get retryBatchSize(): number {
    return this.config.gireve?.retryBatchSize ?? 50;
  }

  constructor(
    private readonly outbox: GireveBroadcastRetryOutbox,
    private readonly logger: Logger<ILogObj>,
    @Inject() private readonly sessionsClientApi: SessionsClientApi,
    @Inject() private readonly cdrsClientApi: CdrsClientApi,
    @Inject() private readonly tariffsClientApi: TariffsClientApi,
    @Inject() private readonly ocpiGraphqlClient: OcpiGraphqlClient,
    @Inject() private readonly cdrsService: CdrsService,
  ) {}

  /**
   * One-shot batch for CronJob: release stale locks, claim due rows, retry each.
   */
  async runOnce(options?: {
    batchSize?: number;
  }): Promise<GireveRetryRunResult> {
    const batchSize = options?.batchSize ?? this.retryBatchSize;
    const staleLocksReleased = await this.outbox.releaseStaleLocks();
    const items = await this.outbox.claimDueRetries(batchSize);

    if (items.length > 0) {
      this.logger.info(
        `GireveBroadcastRetryWorker: processing ${items.length} claimed retries`,
      );
    }

    let succeeded = 0;
    let failed = 0;

    for (const item of items) {
      const ok = await this.retryOne(item);
      if (ok) succeeded += 1;
      else failed += 1;
    }

    const result: GireveRetryRunResult = {
      processed: items.length,
      succeeded,
      failed,
      staleLocksReleased,
    };

    this.logger.info('GireveBroadcastRetryWorker: run complete', result);
    return result;
  }

  private partnerByIdQuery = GET_TENANT_PARTNER_BY_ID;

  private parseError(e: unknown): string {
    if (e instanceof Error) return e.stack ?? e.message;
    if (typeof e === 'string') return e;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }

  /**
   * HTTP 2xx only means the partner received the request: an OCPI-level
   * rejection (e.g. 2001 invalid parameters) comes back in status_code. Throwing
   * here makes retryOne reschedule the item instead of marking it sent.
   */
  private assertOcpiSuccess(response: OcpiEmptyResponse): void {
    if (response?.status_code !== OcpiResponseStatusCode.GenericSuccessCode) {
      throw new Error(
        `Gireve retry: partner answered OCPI status_code ${response?.status_code}: ${response?.status_message ?? 'no status_message'}`,
      );
    }
  }

  /**
   * Best-effort: the CDR was delivered, so a failure here must not reschedule
   * the item (that would POST the CDR again).
   */
  private async markCdrRowAsSent(item: GireveRetryQueueItem): Promise<void> {
    try {
      const cdrId = await this.cdrsService.findSentCdrId(
        item.resourceId,
        item.partnerTenantPartnerId,
      );
      if (cdrId === undefined) {
        this.logger.warn('Gireve retry: sent CDR row not found', {
          id: item.id,
          resourceId: item.resourceId,
          partnerTenantPartnerId: item.partnerTenantPartnerId,
        });
        return;
      }
      await this.cdrsService.markCdrAsSent(cdrId, new Date().toISOString());
    } catch (e) {
      this.logger.error('Gireve retry: failed to mark CDR as sent', {
        id: item.id,
        resourceId: item.resourceId,
        error: this.parseError(e),
      });
    }
  }

  private async retryOne(item: GireveRetryQueueItem): Promise<boolean> {
    const now = new Date();
    const attemptCount = item.attemptCount + 1;
    const nextRetryAt = computeGireveNextRetryAt(
      attemptCount,
      this.backoffOptions,
      now,
    );

    const partnerRes = await this.ocpiGraphqlClient.request<
      {
        TenantPartners_by_pk?: {
          id: number;
          countryCode: string;
          partyId: string;
          partnerProfileOCPI: any;
          awsSecretCertificateArn?: string | null;
        } | null;
      },
      { id: number }
    >(this.partnerByIdQuery, { id: item.partnerTenantPartnerId });

    const partner = partnerRes.TenantPartners_by_pk;
    if (!partner?.partnerProfileOCPI) {
      await this.outbox.reschedule(
        item.id,
        attemptCount,
        nextRetryAt,
        `Gireve retry: tenantPartner not found for id=${item.partnerTenantPartnerId}`,
      );
      return false;
    }

    try {
      const toCountryCode = partner.countryCode;
      const toPartyId = partner.partyId;

      switch (item.moduleId as ModuleId) {
        case ModuleId.Sessions: {
          const response = await this.sessionsClientApi.request(
            item.cpoCountryCode,
            item.cpoPartyId,
            toCountryCode,
            toPartyId,
            item.httpMethod as HttpMethod,
            OcpiEmptyResponseSchema,
            partner.partnerProfileOCPI,
            true,
            undefined,
            item.payload,
            undefined,
            undefined,
            item.ocpiPath ?? undefined,
            partner.awsSecretCertificateArn ?? undefined,
          );
          this.assertOcpiSuccess(response);
          break;
        }
        case ModuleId.Cdrs: {
          const response = await this.cdrsClientApi.request(
            item.cpoCountryCode,
            item.cpoPartyId,
            toCountryCode,
            toPartyId,
            item.httpMethod as HttpMethod,
            OcpiEmptyResponseSchema,
            partner.partnerProfileOCPI,
            true,
            undefined,
            item.payload,
            undefined,
            undefined,
            item.ocpiPath ?? undefined,
            partner.awsSecretCertificateArn ?? undefined,
          );
          this.assertOcpiSuccess(response);
          await this.markCdrRowAsSent(item);
          break;
        }
        case ModuleId.Tariffs: {
          const response = await this.tariffsClientApi.request(
            item.cpoCountryCode,
            item.cpoPartyId,
            toCountryCode,
            toPartyId,
            item.httpMethod as HttpMethod,
            OcpiEmptyResponseSchema,
            partner.partnerProfileOCPI,
            true,
            undefined,
            item.payload,
            undefined,
            undefined,
            item.ocpiPath ?? undefined,
            partner.awsSecretCertificateArn ?? undefined,
          );
          this.assertOcpiSuccess(response);
          break;
        }
        default:
          throw new Error(
            `Gireve retry: unsupported moduleId=${item.moduleId}`,
          );
      }

      await this.outbox.markSent(item.id);
      this.logger.info('Gireve retry succeeded', {
        id: item.id,
        moduleId: item.moduleId,
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        partnerTenantPartnerId: item.partnerTenantPartnerId,
      });
      return true;
    } catch (e) {
      const lastError = this.parseError(e);

      this.logger.warn('Gireve retry failed, rescheduled', {
        id: item.id,
        moduleId: item.moduleId,
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        attemptCount,
        nextRetryAt: nextRetryAt.toISOString(),
      });

      await this.outbox.reschedule(
        item.id,
        attemptCount,
        nextRetryAt,
        lastError,
      );
      return false;
    }
  }
}
