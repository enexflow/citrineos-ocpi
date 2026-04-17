// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { AuthorizationDto } from '@citrineos/base';
import { TokensModuleApi } from './module/TokensModuleApi.js';
import {
  AbstractDtoModule,
  AsDtoEventHandler,
  Role,
  shouldBroadcast,
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

  @AsDtoEventHandler(
    DtoEventType.INSERT,
    DtoEventObjectType.Authorization,
    'AuthorizationNotification',
  )
  async handleAuthorizationInsert(
    event: IDtoEvent<AuthorizationDto>,
  ): Promise<void> {
    logDbBroadcast(
      this._logger,
      'debug',
      'Handling Authorization Insert:',
      event,
    );
    if (event._payload.tenantPartnerId) return;
    const authorizationDto = event._payload;
    const tenant = authorizationDto.tenant;
    if (
      !shouldBroadcast(
        tenant,
        Role.EMSP,
        event._context,
        this._logger,
        String(authorizationDto.id),
      )
    ) {
      return;
    }
    await this.tokenBroadcaster.broadcastPutToken(tenant!, authorizationDto);
  }

  @AsDtoEventHandler(
    DtoEventType.UPDATE,
    DtoEventObjectType.Authorization,
    'AuthorizationNotification',
  )
  async handleAuthorizationUpdate(
    event: IDtoEvent<Partial<AuthorizationDto>>,
  ): Promise<void> {
    logDbBroadcast(
      this._logger,
      'debug',
      'Handling Authorization Update:',
      event,
    );
    if (event._payload.tenantPartnerId) return;
    const authorizationDto = event._payload;
    const tenant = authorizationDto.tenant;
    if (
      !shouldBroadcast(
        tenant,
        Role.EMSP,
        event._context,
        this._logger,
        String(authorizationDto.id),
      )
    ) {
      return;
    }
    await this.tokenBroadcaster.broadcastPatchToken(tenant!, authorizationDto);
  }

  @AsDtoEventHandler(
    DtoEventType.DELETE,
    DtoEventObjectType.Authorization,
    'AuthorizationNotification',
  )
  async handleAuthorizationDelete(
    event: IDtoEvent<Partial<AuthorizationDto>>,
  ): Promise<void> {
    logDbBroadcast(
      this._logger,
      'debug',
      'Handling Authorization Delete:',
      event,
    );
    if (event._payload.tenantPartnerId) return;
    const authorizationDto = event._payload;
    const tenant = authorizationDto.tenant;
    if (
      !shouldBroadcast(
        tenant,
        Role.EMSP,
        event._context,
        this._logger,
        String(authorizationDto.id),
      )
    ) {
      return;
    }
    await this.tokenBroadcaster.broadcastDeleteToken(tenant!, authorizationDto);
  }
}
