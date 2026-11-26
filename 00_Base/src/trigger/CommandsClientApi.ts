// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import {
  BaseClientApi,
  MissingRequiredParamException,
} from './BaseClientApi.js';
import { Inject, Service } from 'typedi';
import type { OcpiEmptyResponse } from '../model/OcpiEmptyResponse.js';
import { OcpiEmptyResponseSchema } from '../model/OcpiEmptyResponse.js';
import { ModuleId } from '../model/ModuleId.js';
import type { ICache, PartnerProfile } from '@zetra/citrineos-base';
import { HttpMethod } from '@zetra/citrineos-base';
import type { CommandResult } from '../model/CommandResult.js';
import { stripCommandResultMessageIfDisabled } from '../model/CommandResult.js';
import {
  COMMAND_RESPONSE_URL_CACHE_NAMESPACE,
  COMMAND_RESPONSE_URL_CACHE_RESOLVED,
  commandCacheTtlSeconds,
} from '../util/Consts.js';
import type { OcpiConfig } from '../config/ocpi.types.js';
import { OcpiConfigToken } from '../config/ocpi.types.js';
import { CacheWrapper } from '../util/CacheWrapper.js';
import {
  parseCommandCallbackContext,
  swapRoutingForCallback,
} from '../util/commandCallbackContext.js';

@Service()
export class CommandsClientApi extends BaseClientApi {
  protected cache!: ICache;
  @Inject(OcpiConfigToken)
  protected config!: OcpiConfig;

  constructor(@Inject() cacheWrapper: CacheWrapper) {
    super();
    this.cache = cacheWrapper.cache;
  }

  CONTROLLER_PATH = ModuleId.Commands;

  getUrl(): string {
    throw new MissingRequiredParamException(`url must be provided by command`);
  }

  async postCommandResult(
    fromCountryCode: string,
    fromPartyId: string,
    toCountryCode: string,
    toPartyId: string,
    partnerProfile: PartnerProfile,
    url: string, // Provided in the command
    body: CommandResult,
    commandId: string,
    awsSecretCertificateArn?: string | null,
  ): Promise<OcpiEmptyResponse> {
    const routing = await this.resolveCommandCallbackRouting(
      commandId,
      fromCountryCode,
      fromPartyId,
      toCountryCode,
      toPartyId,
    );

    await this.cache.set(
      commandId,
      COMMAND_RESPONSE_URL_CACHE_RESOLVED,
      COMMAND_RESPONSE_URL_CACHE_NAMESPACE,
      // Keep the marker until the timeout check has run (it may run on another instance,
      // up to the command timeout after the command was sent), then let it expire.
      commandCacheTtlSeconds(this.config.commands.timeout),
    );

    return this.request(
      routing.fromCountryCode,
      routing.fromPartyId,
      routing.toCountryCode,
      routing.toPartyId,
      HttpMethod.Post,
      OcpiEmptyResponseSchema,
      partnerProfile,
      true,
      url,
      stripCommandResultMessageIfDisabled(body),
      undefined,
      undefined,
      undefined,
      awsSecretCertificateArn ?? undefined,
    );
  }

  private async resolveCommandCallbackRouting(
    commandId: string,
    fromCountryCode: string,
    fromPartyId: string,
    toCountryCode: string,
    toPartyId: string,
  ) {
    const cached = await this.cache.get<string>(
      commandId,
      COMMAND_RESPONSE_URL_CACHE_NAMESPACE,
    );
    const context =
      cached && cached !== COMMAND_RESPONSE_URL_CACHE_RESOLVED
        ? parseCommandCallbackContext(cached)
        : null;
    if (context?.routing) {
      return swapRoutingForCallback(context.routing);
    }
    return {
      fromCountryCode: toCountryCode,
      fromPartyId: toPartyId,
      toCountryCode: fromCountryCode,
      toPartyId: fromPartyId,
    };
  }
}
