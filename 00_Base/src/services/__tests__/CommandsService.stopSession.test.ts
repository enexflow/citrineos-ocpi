// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// Runtime imports that pull ESM-only packages (citrineos-base, json-schema-faker via the
// base barrel) are stubbed: the test only drives CommandsService.postCommand(STOP_SESSION).
jest.mock('@zetra/citrineos-base', () => ({
  HttpMethod: { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH' },
  HttpHeader: { Authorization: 'Authorization' },
}));
jest.mock('../../graphql/index', () => ({
  OcpiGraphqlClient: class {},
  GET_CHARGING_STATION_BY_ID_QUERY: 'GET_CHARGING_STATION_BY_ID_QUERY',
  GET_TRANSACTION_BY_ID_QUERY: 'GET_TRANSACTION_BY_ID_QUERY',
}));
jest.mock('../../util/CommandExecutor', () => ({ CommandExecutor: class {} }));
jest.mock('../TokensService', () => ({ TokensService: class {} }));
jest.mock('../../mapper/LocationMapper', () => ({ EvseMapper: class {} }));
jest.mock('../../mapper/ChargingStationMapper', () => ({
  ChargingStationMapper: {
    fromTransactionQueryRow: (row: unknown) => row ?? undefined,
  },
}));

import { CommandsService } from '../CommandsService';
import { CommandType } from '../../model/CommandType';
import { CommandResponseType } from '../../model/CommandResponse';
import type { StopSession } from '../../model/StopSession';

describe('CommandsService STOP_SESSION', () => {
  const tenantPartner = {
    id: 3,
    countryCode: 'FR',
    partyId: 'EMS',
    tenant: { id: 1, countryCode: 'FR', partyId: 'ZET' },
  } as any;
  const chargingStation = { id: 'CS-A', protocol: 'ocpp1.6' };
  const activeTransaction = {
    id: 9876,
    // The station's own number: what RemoteStop / RequestStopTransaction must carry
    transactionId: '1234',
    isActive: true,
    remoteStartId: null,
    authorization: {
      tenantPartner: { countryCode: 'FR', partyId: 'EMS' },
    },
    chargingStation,
  };
  const stopSession = (session_id: string): StopSession => ({
    response_url: 'https://emsp.example/commands/STOP_SESSION/1',
    session_id,
  });

  let service: CommandsService;
  let request: jest.Mock;
  let executeStopSession: jest.Mock;

  beforeEach(() => {
    request = jest
      .fn()
      .mockResolvedValue({ Transactions: [activeTransaction] });
    executeStopSession = jest.fn().mockResolvedValue(undefined);
    service = new CommandsService();
    Object.assign(service, {
      logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
      ocpiGraphqlClient: { request },
      commandExecutor: { executeStopSession },
      config: { commands: { timeout: 30 } },
    });
  });

  const post = (session_id: string, partner = tenantPartner) =>
    service.postCommand(
      CommandType.STOP_SESSION,
      stopSession(session_id),
      partner,
      undefined as any,
      {} as any,
    );

  it('finds the transaction from Transactions.id, within the tenant', async () => {
    const response = await post('FR*ZET*R009876');

    expect(response.data?.result).toBe(CommandResponseType.ACCEPTED);
    expect(request).toHaveBeenCalledWith('GET_TRANSACTION_BY_ID_QUERY', {
      id: 9876,
      tenantId: 1,
    });
  });

  it("stops the station's OCPP transaction, not the OCPI session id", async () => {
    await post('FR*ZET*R009876');

    expect(executeStopSession).toHaveBeenCalledWith(
      stopSession('FR*ZET*R009876'),
      '1234',
      tenantPartner,
      chargingStation,
      {},
    );
  });

  it.each([
    // Old format: the OCPP transactionId
    '1234',
    // A CDR id
    'FR*ZET*F009876',
    // Another tenant's session
    'FR*ABC*R009876',
    'BE*ZET*R009876',
  ])('answers UNKNOWN_SESSION for %p without querying', async (sessionId) => {
    const response = await post(sessionId);

    expect(response.data?.result).toBe(CommandResponseType.UNKNOWN_SESSION);
    expect(request).not.toHaveBeenCalled();
    expect(executeStopSession).not.toHaveBeenCalled();
  });

  it('answers UNKNOWN_SESSION when no transaction has this id in the tenant', async () => {
    request.mockResolvedValue({ Transactions: [] });

    const response = await post('FR*ZET*R009999');

    expect(response.data?.result).toBe(CommandResponseType.UNKNOWN_SESSION);
    expect(executeStopSession).not.toHaveBeenCalled();
  });

  it('rejects a session another partner started', async () => {
    const response = await post('FR*ZET*R009876', {
      ...tenantPartner,
      countryCode: 'DE',
      partyId: 'OTH',
    });

    expect(response.data?.result).toBe(CommandResponseType.REJECTED);
    expect(executeStopSession).not.toHaveBeenCalled();
  });
});
