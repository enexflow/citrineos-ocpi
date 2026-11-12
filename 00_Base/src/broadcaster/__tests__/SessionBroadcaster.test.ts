// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// The mapper barrel pulls in RegistrationMapper -> 00_Base/src/index.ts -> KoaServer
// -> json-schema-faker (ESM-only exports map, unresolvable under Jest's CJS runtime).
// We inject a mock SessionMapper anyway, so stub the barrel entirely.
// Same workaround as 00_Base/src/services/__tests__/TokensService.test.ts.
jest.mock('../../mapper/index', () => ({
  SessionMapper: class SessionMapperStub {},
}));

jest.mock('@zetra/citrineos-base', () => ({
  HttpMethod: {
    Get: 'GET',
    Post: 'POST',
    Put: 'PUT',
    Patch: 'PATCH',
    Delete: 'DELETE',
  },
  HttpHeader: { Authorization: 'Authorization' },
}));

import { SessionBroadcaster } from '../SessionBroadcaster.js';
import { ModuleId } from '../../model/ModuleId.js';
import { InterfaceRole } from '../../model/InterfaceRole.js';
import { HttpMethod } from '@zetra/citrineos-base';
import { isGirevePartner } from '../../util/helpers.js';

jest.mock('../../util/helpers.js', () => ({
  getOcpiToFromAuthorization: jest.fn().mockReturnValue({
    ocpiToCountryCode: 'FR',
    ocpiToPartyId: 'CPO',
  }),
  isGirevePartner: jest.fn().mockReturnValue(false),
  tokenOwnerPartnerFilter: jest.fn(
    (id: number) => (p: { id: number }) => p.id === id,
  ),
}));

describe('SessionBroadcaster', () => {
  let broadcaster: SessionBroadcaster;
  let mockLogger: any;
  let mockSessionsClientApi: { broadcastToClients: jest.Mock };
  let mockSessionMapper: {
    mapTransactionToSession: jest.Mock;
    mapIncrementalSessionPatch: jest.Mock;
    getChargingPeriodsEnd: jest.Mock;
  };
  let mockDedupeService: {
    shouldBroadcast: jest.Mock;
    markInFlight: jest.Mock;
    markSent: jest.Mock;
    markFailed: jest.Mock;
    clear: jest.Mock;
    runExclusive: jest.Mock;
    getSentUntil: jest.Mock;
    advanceSentUntil: jest.Mock;
  };
  const SENT_UNTIL = new Date('2026-10-29T10:15:00.000Z');
  const PERIODS_END = new Date('2026-10-29T10:30:00.000Z');

  const tenant = { countryCode: 'FR', partyId: 'ZET' } as any;
  const transactionDto = {
    transactionId: 'tx-1',
    authorization: { tenantPartner: { id: 42 } },
  } as any;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    };
    mockSessionsClientApi = {
      // One response: the token owner got the session
      broadcastToClients: jest.fn().mockResolvedValue([{}]),
    };
    mockSessionMapper = {
      mapTransactionToSession: jest
        .fn()
        .mockResolvedValue({ id: 'tx-1', status: 'ACTIVE' }),
      mapIncrementalSessionPatch: jest
        .fn()
        .mockResolvedValue({ status: 'ACTIVE' }),
      getChargingPeriodsEnd: jest.fn().mockReturnValue(PERIODS_END),
    };
    mockDedupeService = {
      shouldBroadcast: jest.fn().mockReturnValue(true),
      markInFlight: jest.fn(),
      markSent: jest.fn(),
      markFailed: jest.fn(),
      clear: jest.fn(),
      runExclusive: jest.fn(
        (_tx: string, _partner: number, task: () => Promise<unknown>) => task(),
      ),
      getSentUntil: jest.fn().mockReturnValue(SENT_UNTIL),
      advanceSentUntil: jest.fn(),
    };

    broadcaster = new SessionBroadcaster(
      mockLogger,
      mockSessionsClientApi as any,
      mockSessionMapper as any,
      mockDedupeService as any,
    );
  });

  describe('broadcastPutSession', () => {
    beforeEach(() => {
      // Opening PUT: nothing sent for this session yet
      mockDedupeService.getSentUntil.mockReturnValue(undefined);
    });

    it('skips the opening PUT when an update already sent the session', async () => {
      // An update handled first already PUT a fresher snapshot (resync or Gireve)
      mockDedupeService.getSentUntil.mockReturnValue(SENT_UNTIL);

      await broadcaster.broadcastPutSession(tenant, transactionDto, 42);

      expect(mockSessionsClientApi.broadcastToClients).not.toHaveBeenCalled();
      expect(mockSessionMapper.mapTransactionToSession).not.toHaveBeenCalled();
      expect(mockDedupeService.advanceSentUntil).not.toHaveBeenCalled();
    });

    it('skips entirely when there is no token-owner partner', async () => {
      await broadcaster.broadcastPutSession(tenant, transactionDto, null);
      expect(mockSessionsClientApi.broadcastToClients).not.toHaveBeenCalled();
    });

    it('sends a PUT with the mapped session and correct path', async () => {
      await broadcaster.broadcastPutSession(tenant, transactionDto, 42);

      expect(mockSessionsClientApi.broadcastToClients).toHaveBeenCalledWith(
        expect.objectContaining({
          cpoCountryCode: 'FR',
          cpoPartyId: 'ZET',
          moduleId: ModuleId.Sessions,
          interfaceRole: InterfaceRole.RECEIVER,
          httpMethod: HttpMethod.Put,
          body: { id: 'tx-1', status: 'ACTIVE' },
          path: '/FR/ZET/tx-1',
        }),
      );
      expect(mockDedupeService.markSent).toHaveBeenCalled();
    });

    it('sets the charging period cursor once the PUT is sent', async () => {
      await broadcaster.broadcastPutSession(tenant, transactionDto, 42);

      expect(mockDedupeService.advanceSentUntil).toHaveBeenCalledWith(
        'tx-1',
        42,
        PERIODS_END,
      );
    });

    it('does not call broadcastToClients when the dedupe service says skip', async () => {
      mockDedupeService.shouldBroadcast.mockReturnValue(false);
      await broadcaster.broadcastPutSession(tenant, transactionDto, 42);
      expect(mockSessionsClientApi.broadcastToClients).not.toHaveBeenCalled();
    });

    it('marks the dedupe entry failed and rethrows when the push fails', async () => {
      mockSessionsClientApi.broadcastToClients.mockRejectedValueOnce(
        new Error('boom'),
      );
      await expect(
        broadcaster.broadcastPutSession(tenant, transactionDto, 42),
      ).rejects.toThrow('boom');
      expect(mockDedupeService.markFailed).toHaveBeenCalled();
      expect(mockDedupeService.advanceSentUntil).not.toHaveBeenCalled();
    });
  });

  describe('broadcastPatchSession', () => {
    const sentMethods = () =>
      mockSessionsClientApi.broadcastToClients.mock.calls.map(
        (c) => c[0].httpMethod,
      );

    it('only builds and sends the incremental PATCH to a standard partner', async () => {
      await broadcaster.broadcastPatchSession(tenant, transactionDto, 42);

      expect(sentMethods()).toEqual([HttpMethod.Patch]);
      expect(mockSessionMapper.mapIncrementalSessionPatch).toHaveBeenCalledWith(
        transactionDto,
        SENT_UNTIL,
      );
      expect(mockSessionMapper.mapTransactionToSession).not.toHaveBeenCalled();
      expect(mockDedupeService.advanceSentUntil).toHaveBeenCalledWith(
        'tx-1',
        42,
        PERIODS_END,
      );
    });

    it('resyncs a standard partner with a full PUT when the cursor is unknown', async () => {
      mockDedupeService.getSentUntil.mockReturnValue(undefined);

      await broadcaster.broadcastPatchSession(tenant, transactionDto, 42);

      expect(sentMethods()).toEqual([HttpMethod.Put]);
      expect(
        mockSessionMapper.mapIncrementalSessionPatch,
      ).not.toHaveBeenCalled();
      expect(mockDedupeService.advanceSentUntil).toHaveBeenCalledWith(
        'tx-1',
        42,
        PERIODS_END,
      );
    });

    it('keeps the cursor when the PATCH fails, so the next one resends the periods', async () => {
      mockSessionsClientApi.broadcastToClients.mockRejectedValueOnce(
        new Error('boom'),
      );

      await expect(
        broadcaster.broadcastPatchSession(tenant, transactionDto, 42),
      ).rejects.toThrow('boom');
      expect(mockDedupeService.advanceSentUntil).not.toHaveBeenCalled();
    });

    it('keeps the cursor and the dedupe entry when the partner rejects the PATCH', async () => {
      // broadcastToClients swallows partner errors (e.g. a 401) and returns no response
      mockSessionsClientApi.broadcastToClients.mockResolvedValueOnce([]);

      await broadcaster.broadcastPatchSession(tenant, transactionDto, 42);

      expect(mockDedupeService.advanceSentUntil).not.toHaveBeenCalled();
      expect(mockDedupeService.markSent).not.toHaveBeenCalled();
      expect(mockDedupeService.markFailed).toHaveBeenCalled();
    });

    it('keeps the cursor unknown when the resync PUT is rejected', async () => {
      mockDedupeService.getSentUntil.mockReturnValue(undefined);
      mockSessionsClientApi.broadcastToClients.mockResolvedValueOnce([]);

      await broadcaster.broadcastPatchSession(tenant, transactionDto, 42);

      expect(sentMethods()).toEqual([HttpMethod.Put]);
      expect(mockDedupeService.advanceSentUntil).not.toHaveBeenCalled();
    });

    it('keeps the cursor when the PATCH is skipped', async () => {
      mockDedupeService.shouldBroadcast.mockReturnValue(false);

      await broadcaster.broadcastPatchSession(tenant, transactionDto, 42);

      expect(mockDedupeService.advanceSentUntil).not.toHaveBeenCalled();
    });

    it('runs the broadcast inside the per-session queue', async () => {
      await broadcaster.broadcastPatchSession(tenant, transactionDto, 42);

      expect(mockDedupeService.runExclusive).toHaveBeenCalledWith(
        'tx-1',
        42,
        expect.any(Function),
      );
    });

    it('only builds and sends the full PUT to Gireve', async () => {
      (isGirevePartner as jest.Mock).mockReturnValueOnce(true);

      await broadcaster.broadcastPatchSession(tenant, transactionDto, 42);

      expect(sentMethods()).toEqual([HttpMethod.Put]);
      expect(mockSessionMapper.mapTransactionToSession).toHaveBeenCalled();
      expect(
        mockSessionMapper.mapIncrementalSessionPatch,
      ).not.toHaveBeenCalled();
      // So a late opening PUT is skipped instead of overwriting this one
      expect(mockDedupeService.advanceSentUntil).toHaveBeenCalledWith(
        'tx-1',
        42,
        PERIODS_END,
      );
    });

    it('skips entirely when there is no token-owner partner', async () => {
      await broadcaster.broadcastPatchSession(tenant, transactionDto, null);

      expect(mockSessionsClientApi.broadcastToClients).not.toHaveBeenCalled();
      expect(
        mockSessionMapper.mapIncrementalSessionPatch,
      ).not.toHaveBeenCalled();
      expect(mockSessionMapper.mapTransactionToSession).not.toHaveBeenCalled();
    });
  });
});
