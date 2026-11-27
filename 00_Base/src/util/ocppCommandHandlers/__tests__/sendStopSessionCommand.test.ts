// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// The handlers import the base barrel and citrineos-base (ESM-only under Jest's CJS
// runtime): stub what they use at runtime.
jest.mock('@zetra/citrineos-base', () => ({
  OCPPVersion: { OCPP1_6: 'ocpp1.6', OCPP2_0_1: 'ocpp2.0.1' },
}));
jest.mock('../../../index.js', () => ({
  CommandResultType: {},
  CommandType: { STOP_SESSION: 'STOP_SESSION' },
  ModuleId: { Commands: 'commands' },
  OcpiConfigToken: 'OcpiConfigToken',
}));
jest.mock('../../../config/ocpi.types.js', () => ({ AjvToken: 'AjvToken' }));
jest.mock('@zetra/citrineos-data', () => ({ OCPP2_0_1_Mapper: {} }));
jest.mock('../../../mapper/index.js', () => ({ TokensMapper: {} }));
jest.mock('../../../graphql/index.js', () => ({ OcpiGraphqlClient: class {} }));
jest.mock('../../../trigger/CommandsClientApi.js', () => ({
  CommandsClientApi: class {},
}));
jest.mock('../../security/keycloakClientCredentials.js', () => ({
  getKeycloakClientCredentialsToken: jest.fn(),
}));

import { OCPP1_6_CommandHandler } from '../OCPP1_6_CommandHandler';
import { OCPP2_0_1_CommandHandler } from '../OCPP2_0_1_CommandHandler';
import type { StopSession } from '../../../model/StopSession';

describe('sendStopSessionCommand', () => {
  const stopSession: StopSession = {
    response_url: 'https://emsp.example/commands/STOP_SESSION/1',
    session_id: 'FR*ZET*R009876',
  };
  const tenantPartner = { id: 3, tenant: { id: 1 } } as any;
  const chargingStation = { id: 'CS-A' } as any;
  const config = {
    commands: {
      coreHeaders: {},
      ocpiBaseUrl: 'http://ocpi',
      ocpp1_6: { remoteStopTransactionRequestUrl: 'http://core/1.6/stop' },
      ocpp2_0_1: { requestStopTransactionRequestUrl: 'http://core/2.0.1/stop' },
    },
  };

  const payloadSent = async (
    handler: OCPP1_6_CommandHandler | OCPP2_0_1_CommandHandler,
  ) => {
    Object.assign(handler, { config });
    const sendOCPPMessage = jest
      .spyOn(handler as any, 'sendOCPPMessage')
      .mockResolvedValue(undefined);
    await handler.sendStopSessionCommand(
      stopSession,
      '1234',
      tenantPartner,
      chargingStation,
      'cmd-1',
    );
    return sendOCPPMessage.mock.calls[0][1];
  };

  it('OCPP 1.6: RemoteStopTransaction carries the numeric OCPP transactionId', async () => {
    expect(await payloadSent(new OCPP1_6_CommandHandler())).toEqual({
      transactionId: 1234,
    });
  });

  it('OCPP 2.0.1: RequestStopTransaction carries the OCPP transactionId', async () => {
    expect(await payloadSent(new OCPP2_0_1_CommandHandler())).toEqual({
      transactionId: '1234',
    });
  });
});
