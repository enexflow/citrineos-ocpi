// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import {
  IdTokenEnum,
  type AuthorizationDto,
  type TenantDto,
} from '@zetra/citrineos-base';
import { TokensModuleApi } from './module/TokensModuleApi.js';
import {
  AbstractDtoModule,
  AsDtoEventHandler,
  type IDtoEvent,
  type OcpiConfig,
} from '@citrineos/ocpi-base';
import {
  CacheWrapper,
  DtoEventObjectType,
  DtoEventType,
  OcpiConfigToken,
  OcpiModule,
  RabbitMqDtoReceiver,
  TokenBroadcaster,
} from '@citrineos/ocpi-base';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import { Inject, Service } from 'typedi';
import { logDbBroadcast } from '@citrineos/ocpi-base';
export { TokensModuleApi } from './module/TokensModuleApi.js';
export type { ITokensModuleApi } from './module/ITokensModuleApi.js';
type AuthorizationNotifyPayload = AuthorizationDto & {
  disableOCPI?: boolean | null;
  // only set on Authorizations UPDATE events (see AuthorizationNotify trigger)
  previousDisableOCPI?: boolean;
};

@Service()
export class TokensModule extends AbstractDtoModule implements OcpiModule {
  constructor(
    @Inject(OcpiConfigToken) config: OcpiConfig,
    readonly tokenBroadcaster: TokenBroadcaster,
    readonly cacheWrapper: CacheWrapper,
    readonly logger?: Logger<ILogObj>,
  ) {
    super(config, new RabbitMqDtoReceiver(config, logger), logger);
  }

  getController(): any {
    return TokensModuleApi;
  }
  async init(): Promise<void> {
    await this._receiver.init();
  }
  async shutdown(): Promise<void> {
    await super.shutdown();
  }

  // only our own ISO14443 (RFID) tokens are exposed over OCPI
  private isBroadcastable(
    event: IDtoEvent<Partial<AuthorizationNotifyPayload>>,
    action: string,
  ): boolean {
    if (event._payload.tenantPartnerId) {
      logDbBroadcast(
        this._logger,
        'debug',
        `Authorization ${action} for tenant partner, skipping broadcast.`,
        event,
      );
      return false;
    }
    if (event._payload.idTokenType !== IdTokenEnum.ISO14443) {
      logDbBroadcast(
        this._logger,
        'debug',
        `Authorization ${action} is not ISO14443, skipping broadcast.`,
        event,
      );
      return false;
    }
    return true;
  }

  @AsDtoEventHandler(
    DtoEventType.INSERT,
    DtoEventObjectType.Authorization,
    'AuthorizationNotification',
  )
  async handleAuthorizationInsert(
    event: IDtoEvent<AuthorizationNotifyPayload>,
  ): Promise<void> {
    logDbBroadcast(
      this._logger,
      'debug',
      'Handling Authorization Insert:',
      event,
    );
    if (!this.isBroadcastable(event, 'Insert')) return;
    if (event._payload.disableOCPI === true) {
      logDbBroadcast(
        this._logger,
        'debug',
        'Authorization on OCPI-disabled token, skipping broadcast.',
        event,
      );
      return;
    }
    const authorizationDto = event._payload;

    const tenants = authorizationDto.tenants as unknown as
      | TenantDto[]
      | null
      | undefined;

    if (!tenants || tenants.length === 0) {
      this._logger.error(
        `Tenant data missing in ${event._context.eventType} notification for ${event._context.objectType} ${authorizationDto.id}, cannot broadcast.`,
      );
      return;
    }
    for (const tenant of tenants) {
      if (!tenant) {
        continue;
      }
      try {
        await this.tokenBroadcaster.broadcastPutToken(tenant, authorizationDto);
      } catch (e) {
        this._logger.error(
          `broadcastPutToken failed for ${tenant.countryCode}/${tenant.partyId}/${authorizationDto.idToken}`,
          e,
        );
      }
    }
  }

  @AsDtoEventHandler(
    DtoEventType.UPDATE,
    DtoEventObjectType.Authorization,
    'AuthorizationNotification',
  )
  async handleAuthorizationUpdate(
    event: IDtoEvent<Partial<AuthorizationNotifyPayload>>,
  ): Promise<void> {
    logDbBroadcast(
      this._logger,
      'debug',
      'Handling Authorization Update:',
      event,
    );
    if (!this.isBroadcastable(event, 'Update')) return;
    const authorizationDto = event._payload;
    const isDisabled = authorizationDto.disableOCPI === true;
    const wasDisabled = authorizationDto.previousDisableOCPI;
    // already disabled before this change (or no transition info, e.g. an
    // AuthorizationTenants update): partners already have it as invalid
    if (isDisabled && wasDisabled !== false) {
      logDbBroadcast(
        this._logger,
        'debug',
        'Authorization Update on OCPI-disabled token, skipping broadcast.',
        event,
      );
      return;
    }
    const justDisabled = isDisabled;
    const justEnabled = !isDisabled && wasDisabled === true;
    const tenants = authorizationDto.tenants as unknown as
      | TenantDto[]
      | null
      | undefined;

    if (!tenants || tenants.length === 0) {
      this._logger.error(
        `Tenant data missing in ${event._context.eventType} notification for ${event._context.objectType} ${authorizationDto.id}, cannot broadcast.`,
      );
      return;
    }
    for (const tenant of tenants) {
      if (!tenant) {
        return;
      }
      try {
        if (justDisabled) {
          await this.tokenBroadcaster.broadcastDeleteToken(
            tenant,
            authorizationDto,
          );
        } else if (justEnabled) {
          await this.tokenBroadcaster.broadcastPutToken(
            tenant,
            authorizationDto as AuthorizationDto,
          );
        } else {
          await this.tokenBroadcaster.broadcastPatchToken(
            tenant,
            authorizationDto,
          );
        }
      } catch (e) {
        this._logger.error(
          `broadcastPatchToken failed for ${tenant.countryCode}/${tenant.partyId}/${authorizationDto.idToken}`,
          e,
        );
      }
    }
  }

  @AsDtoEventHandler(
    DtoEventType.DELETE,
    DtoEventObjectType.Authorization,
    'AuthorizationNotification',
  )
  async handleAuthorizationDelete(
    event: IDtoEvent<Partial<AuthorizationNotifyPayload>>,
  ): Promise<void> {
    logDbBroadcast(
      this._logger,
      'debug',
      'Handling Authorization Delete:',
      event,
    );
    if (!this.isBroadcastable(event, 'Delete')) return;
    if (event._payload.disableOCPI === true) {
      logDbBroadcast(
        this._logger,
        'debug',
        'Authorization on OCPI-disabled token, skipping broadcast.',
        event,
      );
      return;
    }
    const authorizationDto = event._payload;
    const tenants = authorizationDto.tenants as unknown as
      | TenantDto[]
      | null
      | undefined;
    if (!tenants || tenants.length === 0) {
      this._logger.error(
        `Tenant data missing in ${event._context.eventType} notification for ${event._context.objectType} ${authorizationDto.id}, cannot broadcast.`,
      );
      return;
    }
    for (const tenant of tenants) {
      if (!tenant) {
        continue;
      }
      try {
        await this.tokenBroadcaster.broadcastDeleteToken(
          tenant,
          authorizationDto,
        );
      } catch (e) {
        this._logger.error(
          `broadcastDeleteToken failed for ${tenant.countryCode}/${tenant.partyId}/${authorizationDto.idToken}`,
          e,
        );
      }
    }
  }
}
