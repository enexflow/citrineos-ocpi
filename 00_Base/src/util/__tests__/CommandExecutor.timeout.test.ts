// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// CommandExecutor imports the 00_Base barrel, which pulls in KoaServer -> json-schema-faker
// (ESM-only, unresolvable under Jest's CJS runtime). Stub the barrel and the modules that
// reach it with just what CommandExecutor needs.
jest.mock('../../index', () => {
  const { CommandResultType } = jest.requireActual('../../model/CommandResult');
  const { CommandType } = jest.requireActual('../../model/CommandType');
  const { OcpiConfigToken } = jest.requireActual('../../config/ocpi.types');
  return {
    CommandResultType,
    CommandType,
    OcpiConfigToken,
    CacheWrapper: class CacheWrapper {},
  };
});
jest.mock('../../graphql/index', () => ({
  GET_TENANT_PARTNER_BY_ID: 'GET_TENANT_PARTNER_BY_ID',
  OcpiGraphqlClient: class OcpiGraphqlClient {},
}));
jest.mock('../../trigger/CommandsClientApi', () => ({
  CommandsClientApi: class CommandsClientApi {},
}));
jest.mock('../ocppCommandHandlers/index', () => ({
  OCPP_COMMAND_HANDLER: 'OCPP_COMMAND_HANDLER',
  OCPPCommandHandler: class OCPPCommandHandler {},
}));

import type { TenantPartnerDto } from '@zetra/citrineos-base';
import { CommandExecutor } from '../CommandExecutor.js';
import {
  COMMAND_CACHE_GRACE_SECONDS,
  COMMAND_RESPONSE_URL_CACHE_NAMESPACE,
  COMMAND_RESPONSE_URL_CACHE_RESOLVED,
} from '../Consts.js';
import { CommandResultType } from '../../model/CommandResult.js';
import type { OcpiHeaders } from '../../model/OcpiHeaders.js';

const TIMEOUT_SECONDS = 30;
const RESPONSE_URL =
  'https://emsp.example/ocpi/emsp/2.2.1/commands/START_SESSION/1';

/** Shared in-memory stand-in for the cache, honouring TTLs against jest's fake clock. */
class FakeCache {
  readonly entries = new Map<string, { value: string; expiresAt?: number }>();
  readonly ttls = new Map<string, number | undefined>();

  private k(key: string, namespace?: string) {
    return `${namespace ?? 'default'}:${key}`;
  }

  async set(
    key: string,
    value: string,
    namespace?: string,
    expireSeconds?: number,
  ): Promise<boolean> {
    this.ttls.set(this.k(key, namespace), expireSeconds);
    this.entries.set(this.k(key, namespace), {
      value,
      expiresAt:
        expireSeconds === undefined
          ? undefined
          : Date.now() + expireSeconds * 1000,
    });
    return true;
  }

  async get<T>(key: string, namespace?: string): Promise<T | null> {
    const entry = this.entries.get(this.k(key, namespace));
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      return null;
    }
    return entry.value as unknown as T;
  }

  onChange(): Promise<never> {
    throw new Error('onChange must not be used for command timeouts');
  }
}

const tenantPartner = {
  countryCode: 'FR',
  partyId: 'EMS',
  tenant: { countryCode: 'FR', partyId: 'CPO' },
  partnerProfileOCPI: {},
  awsSecretCertificateArn: null,
} as unknown as TenantPartnerDto;

function buildExecutor(cache: FakeCache) {
  const executor = new CommandExecutor({ cache } as any, []);
  const postCommandResult = jest.fn().mockResolvedValue({});
  Object.assign(executor, {
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    config: { commands: { timeout: TIMEOUT_SECONDS } },
    commandsClientApi: { postCommandResult },
  });
  const generateCommandId = (): Promise<string> =>
    (executor as any).generateCommandId(
      RESPONSE_URL,
      {} as OcpiHeaders,
      tenantPartner,
    );
  return { executor, postCommandResult, generateCommandId };
}

describe('CommandExecutor command timeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores the pending command for longer than the command timeout', async () => {
    const cache = new FakeCache();
    const { generateCommandId } = buildExecutor(cache);

    const commandId = await generateCommandId();

    expect(
      cache.ttls.get(`${COMMAND_RESPONSE_URL_CACHE_NAMESPACE}:${commandId}`),
    ).toBe(TIMEOUT_SECONDS + COMMAND_CACHE_GRACE_SECONDS);
  });

  it('posts a single TIMEOUT when the command is never resolved', async () => {
    const cache = new FakeCache();
    const { generateCommandId, postCommandResult } = buildExecutor(cache);

    const commandId = await generateCommandId();
    await jest.advanceTimersByTimeAsync(TIMEOUT_SECONDS * 1000);

    expect(postCommandResult).toHaveBeenCalledTimes(1);
    const args = postCommandResult.mock.calls[0];
    expect(args[5]).toBe(RESPONSE_URL);
    expect(args[6].result).toBe(CommandResultType.TIMEOUT);
    expect(args[7]).toBe(commandId);
  });

  it('does not post TIMEOUT when the command was resolved, even just before the deadline', async () => {
    const cache = new FakeCache();
    const { generateCommandId, postCommandResult } = buildExecutor(cache);

    const commandId = await generateCommandId();
    await jest.advanceTimersByTimeAsync(TIMEOUT_SECONDS * 1000 - 1);
    // What CommandsClientApi.postCommandResult writes when the real result is sent,
    // possibly from another instance sharing the cache.
    await cache.set(
      commandId,
      COMMAND_RESPONSE_URL_CACHE_RESOLVED,
      COMMAND_RESPONSE_URL_CACHE_NAMESPACE,
      TIMEOUT_SECONDS + COMMAND_CACHE_GRACE_SECONDS,
    );
    await jest.advanceTimersByTimeAsync(1);

    expect(postCommandResult).not.toHaveBeenCalled();
  });

  it('does not call the cache onChange listener', async () => {
    const cache = new FakeCache();
    const onChange = jest.spyOn(cache, 'onChange');
    const { generateCommandId } = buildExecutor(cache);

    await generateCommandId();
    await jest.advanceTimersByTimeAsync(TIMEOUT_SECONDS * 1000);

    expect(onChange).not.toHaveBeenCalled();
  });
});
