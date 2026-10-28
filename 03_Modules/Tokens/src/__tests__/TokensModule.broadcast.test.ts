// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import 'reflect-metadata';

jest.mock('../module/TokensModuleApi.js', () => ({
  TokensModuleApi: class TokensModuleApiStub {},
}));

// citrineos-base is ESM-only, jest can't load it: only the enum is needed
jest.mock('@zetra/citrineos-base', () => ({
  IdTokenEnum: {
    Central: 'Central',
    eMAID: 'eMAID',
    ISO14443: 'ISO14443',
    ISO15693: 'ISO15693',
    KeyCode: 'KeyCode',
    Local: 'Local',
    MacAddress: 'MacAddress',
    NoAuthorization: 'NoAuthorization',
    Other: 'Other',
  },
}));

import type { IDtoEvent, OcpiConfig } from '@citrineos/ocpi-base';
import { DtoEventObjectType, DtoEventType } from '@citrineos/ocpi-base';
import {
  IdTokenEnum,
  type AuthorizationDto,
  type TenantDto,
} from '@zetra/citrineos-base';
import { Logger } from 'tslog';
import { Token } from 'typedi';
import { TokensModule } from '../index.js';

jest.mock('@citrineos/ocpi-base', () => {
  const AS_DTO_EVENT_HANDLER_METADATA = 'AS_DTO_EVENT_HANDLER_METADATA';
  const { Token: TypediToken } = require('typedi') as {
    Token: typeof Token;
  };
  const OcpiConfigToken = new TypediToken('ocpi.config');

  const DtoEventType = {
    INSERT: 'INSERT',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
  };
  const DtoEventObjectType = {
    Authorization: 'Authorization',
  };

  const AsDtoEventHandler = function (
    eventType: (typeof DtoEventType)[keyof typeof DtoEventType],
    objectType: (typeof DtoEventObjectType)[keyof typeof DtoEventObjectType],
    eventId: string,
  ) {
    return function (
      target: object,
      propertyKey: string,
      descriptor: PropertyDescriptor,
    ): PropertyDescriptor {
      const ctor = (target as { constructor: object }).constructor;
      const handlers = (Reflect.getMetadata(
        AS_DTO_EVENT_HANDLER_METADATA,
        ctor,
      ) ?? []) as unknown[];
      handlers.push({
        eventType,
        objectType,
        eventId,
        methodName: propertyKey,
        method: descriptor.value,
      });
      Reflect.defineMetadata(AS_DTO_EVENT_HANDLER_METADATA, handlers, ctor);
      return descriptor;
    };
  };

  class AbstractDtoModule {
    protected _config: unknown;
    protected _receiver: {
      module?: unknown;
      init: () => Promise<void>;
      shutdown: () => Promise<void>;
    };
    protected _logger: unknown;
    constructor(
      config: unknown,
      receiver: AbstractDtoModule['_receiver'],
      logger?: unknown,
    ) {
      this._config = config;
      this._receiver = receiver;
      this._logger = logger;
      receiver.module = this;
    }
    async shutdown(): Promise<void> {
      await this._receiver.shutdown();
    }
  }

  class RabbitMqDtoReceiver {
    init = jest.fn().mockResolvedValue(undefined);
    shutdown = jest.fn().mockResolvedValue(undefined);
    module: unknown;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_config: unknown, _logger: unknown) {}
  }

  abstract class OcpiModule {
    abstract getController(): unknown;
  }

  class TokenBroadcaster {}
  class CacheWrapper {}

  return {
    AbstractDtoModule,
    AsDtoEventHandler,
    CacheWrapper,
    DtoEventObjectType,
    DtoEventType,
    OcpiConfigToken,
    OcpiModule,
    RabbitMqDtoReceiver,
    TokenBroadcaster,
    logDbBroadcast: jest.fn(),
  };
});

type AuthorizationNotifyPayload = Partial<AuthorizationDto> & {
  disableOCPI?: boolean | null;
  previousDisableOCPI?: boolean;
};

function makeEvent(
  eventType: string,
  payload: AuthorizationNotifyPayload,
): IDtoEvent<any> {
  return {
    _eventId: 'e1',
    _context: {
      eventType: eventType as DtoEventType,
      objectType: DtoEventObjectType.Authorization,
    },
    _payload: payload,
  };
}

describe('TokensModule Authorization broadcast', () => {
  const tenantA: TenantDto = {
    id: 1,
    name: 'A',
    countryCode: 'FR',
    partyId: 'ZTA',
    isUserTenant: true,
  };
  const tenantB: TenantDto = {
    id: 2,
    name: 'B',
    countryCode: 'FR',
    partyId: 'ZTB',
    isUserTenant: true,
  };

  const ownRfid: AuthorizationNotifyPayload = {
    id: 1,
    idToken: 'TOKEN001',
    idTokenType: IdTokenEnum.ISO14443,
    tenantPartnerId: null as unknown as undefined,
    disableOCPI: false,
    tenants: [tenantA] as never,
  };

  let mod: TokensModule;
  let broadcastPut: jest.Mock;
  let broadcastPatch: jest.Mock;
  let broadcastDelete: jest.Mock;

  beforeEach(() => {
    broadcastPut = jest.fn().mockResolvedValue(undefined);
    broadcastPatch = jest.fn().mockResolvedValue(undefined);
    broadcastDelete = jest.fn().mockResolvedValue(undefined);
    const broadcaster = {
      broadcastPutToken: broadcastPut,
      broadcastPatchToken: broadcastPatch,
      broadcastDeleteToken: broadcastDelete,
    };
    mod = new TokensModule(
      {} as OcpiConfig,
      broadcaster as never,
      {} as never,
      new Logger({ type: 'hidden' }),
    );
  });

  const expectNoBroadcast = () => {
    expect(broadcastPut).not.toHaveBeenCalled();
    expect(broadcastPatch).not.toHaveBeenCalled();
    expect(broadcastDelete).not.toHaveBeenCalled();
  };

  describe('INSERT', () => {
    it('PUTs an own enabled RFID token to every linked tenant', async () => {
      const payload = { ...ownRfid, tenants: [tenantA, tenantB] as never };
      await mod.handleAuthorizationInsert(
        makeEvent(DtoEventType.INSERT, payload),
      );
      expect(broadcastPut).toHaveBeenCalledTimes(2);
      expect(broadcastPut).toHaveBeenNthCalledWith(1, tenantA, payload);
      expect(broadcastPut).toHaveBeenNthCalledWith(2, tenantB, payload);
    });

    it('PUTs when disableOCPI is null (column not set)', async () => {
      await mod.handleAuthorizationInsert(
        makeEvent(DtoEventType.INSERT, { ...ownRfid, disableOCPI: null }),
      );
      expect(broadcastPut).toHaveBeenCalledTimes(1);
    });

    it('skips an OCPI-disabled token', async () => {
      await mod.handleAuthorizationInsert(
        makeEvent(DtoEventType.INSERT, { ...ownRfid, disableOCPI: true }),
      );
      expectNoBroadcast();
    });

    it('skips a partner token', async () => {
      await mod.handleAuthorizationInsert(
        makeEvent(DtoEventType.INSERT, { ...ownRfid, tenantPartnerId: 15 }),
      );
      expectNoBroadcast();
    });

    it.each([
      IdTokenEnum.Central,
      IdTokenEnum.eMAID,
      IdTokenEnum.KeyCode,
      IdTokenEnum.ISO15693,
    ])('skips a non-ISO14443 token (%s)', async (idTokenType) => {
      await mod.handleAuthorizationInsert(
        makeEvent(DtoEventType.INSERT, { ...ownRfid, idTokenType }),
      );
      expectNoBroadcast();
    });
  });

  describe('UPDATE', () => {
    it('PATCHes a regular update on an enabled token', async () => {
      const payload = {
        ...ownRfid,
        disableOCPI: false,
        previousDisableOCPI: false,
      };
      await mod.handleAuthorizationUpdate(
        makeEvent(DtoEventType.UPDATE, payload),
      );
      expect(broadcastPatch).toHaveBeenCalledTimes(1);
      expect(broadcastPatch).toHaveBeenCalledWith(tenantA, payload);
      expect(broadcastPut).not.toHaveBeenCalled();
      expect(broadcastDelete).not.toHaveBeenCalled();
    });

    it('PATCHes an AuthorizationTenants update (no previousDisableOCPI) on an enabled token', async () => {
      await mod.handleAuthorizationUpdate(
        makeEvent(DtoEventType.UPDATE, { ...ownRfid, disableOCPI: false }),
      );
      expect(broadcastPatch).toHaveBeenCalledTimes(1);
      expect(broadcastPut).not.toHaveBeenCalled();
      expect(broadcastDelete).not.toHaveBeenCalled();
    });

    it('invalidates (broadcastDeleteToken) on every tenant when disableOCPI goes false -> true', async () => {
      const payload = {
        ...ownRfid,
        disableOCPI: true,
        previousDisableOCPI: false,
        tenants: [tenantA, tenantB] as never,
      };
      await mod.handleAuthorizationUpdate(
        makeEvent(DtoEventType.UPDATE, payload),
      );
      expect(broadcastDelete).toHaveBeenCalledTimes(2);
      expect(broadcastDelete).toHaveBeenNthCalledWith(1, tenantA, payload);
      expect(broadcastDelete).toHaveBeenNthCalledWith(2, tenantB, payload);
      expect(broadcastPatch).not.toHaveBeenCalled();
      expect(broadcastPut).not.toHaveBeenCalled();
    });

    it('re-PUTs the full token when disableOCPI goes true -> false', async () => {
      const payload = {
        ...ownRfid,
        disableOCPI: false,
        previousDisableOCPI: true,
      };
      await mod.handleAuthorizationUpdate(
        makeEvent(DtoEventType.UPDATE, payload),
      );
      expect(broadcastPut).toHaveBeenCalledTimes(1);
      expect(broadcastPut).toHaveBeenCalledWith(tenantA, payload);
      expect(broadcastPatch).not.toHaveBeenCalled();
      expect(broadcastDelete).not.toHaveBeenCalled();
    });

    it('re-PUTs when disableOCPI goes true -> null', async () => {
      await mod.handleAuthorizationUpdate(
        makeEvent(DtoEventType.UPDATE, {
          ...ownRfid,
          disableOCPI: null,
          previousDisableOCPI: true,
        }),
      );
      expect(broadcastPut).toHaveBeenCalledTimes(1);
      expect(broadcastPatch).not.toHaveBeenCalled();
    });

    it('skips an update on an already-disabled token (true -> true)', async () => {
      await mod.handleAuthorizationUpdate(
        makeEvent(DtoEventType.UPDATE, {
          ...ownRfid,
          disableOCPI: true,
          previousDisableOCPI: true,
        }),
      );
      expectNoBroadcast();
    });

    it('skips an AuthorizationTenants update (no previousDisableOCPI) on a disabled token', async () => {
      await mod.handleAuthorizationUpdate(
        makeEvent(DtoEventType.UPDATE, { ...ownRfid, disableOCPI: true }),
      );
      expectNoBroadcast();
    });

    it('skips a partner token even when it just got disabled', async () => {
      await mod.handleAuthorizationUpdate(
        makeEvent(DtoEventType.UPDATE, {
          ...ownRfid,
          tenantPartnerId: 15,
          disableOCPI: true,
          previousDisableOCPI: false,
        }),
      );
      expectNoBroadcast();
    });

    it('skips a non-ISO14443 token even when it just got disabled', async () => {
      await mod.handleAuthorizationUpdate(
        makeEvent(DtoEventType.UPDATE, {
          ...ownRfid,
          idTokenType: IdTokenEnum.Central,
          disableOCPI: true,
          previousDisableOCPI: false,
        }),
      );
      expectNoBroadcast();
    });

    it('keeps going on the next tenant when one broadcast fails', async () => {
      broadcastDelete.mockRejectedValueOnce(new Error('partner down'));
      await mod.handleAuthorizationUpdate(
        makeEvent(DtoEventType.UPDATE, {
          ...ownRfid,
          disableOCPI: true,
          previousDisableOCPI: false,
          tenants: [tenantA, tenantB] as never,
        }),
      );
      expect(broadcastDelete).toHaveBeenCalledTimes(2);
    });
  });

  describe('DELETE', () => {
    it('invalidates an own enabled RFID token', async () => {
      await mod.handleAuthorizationDelete(
        makeEvent(DtoEventType.DELETE, ownRfid),
      );
      expect(broadcastDelete).toHaveBeenCalledTimes(1);
      expect(broadcastDelete).toHaveBeenCalledWith(tenantA, ownRfid);
    });

    it('skips an OCPI-disabled token (partners already have it invalid)', async () => {
      await mod.handleAuthorizationDelete(
        makeEvent(DtoEventType.DELETE, { ...ownRfid, disableOCPI: true }),
      );
      expectNoBroadcast();
    });

    it('skips a partner token', async () => {
      await mod.handleAuthorizationDelete(
        makeEvent(DtoEventType.DELETE, { ...ownRfid, tenantPartnerId: 15 }),
      );
      expectNoBroadcast();
    });

    it('skips a non-ISO14443 token', async () => {
      await mod.handleAuthorizationDelete(
        makeEvent(DtoEventType.DELETE, {
          ...ownRfid,
          idTokenType: IdTokenEnum.eMAID,
        }),
      );
      expectNoBroadcast();
    });
  });
});
