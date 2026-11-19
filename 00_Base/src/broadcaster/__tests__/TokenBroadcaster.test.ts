// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// The mapper barrel drags the whole Koa server in (see SessionBroadcaster.test.ts).
jest.mock('../../mapper/index', () => ({
  TokensMapper: {
    toDto: jest.fn(() => ({ uid: 'TOKEN001', type: 'RFID', valid: true })),
    toPartialDto: jest.fn(() => ({ uid: 'TOKEN001', type: 'RFID' })),
  },
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

import { TokenBroadcaster } from '../TokenBroadcaster.js';

describe('TokenBroadcaster', () => {
  const tenant = { countryCode: 'FR', partyId: 'ZTA' } as any;
  let broadcastToClients: jest.Mock;
  let broadcaster: TokenBroadcaster;

  beforeEach(() => {
    broadcastToClients = jest.fn().mockResolvedValue([]);
    broadcaster = new TokenBroadcaster(
      { error: jest.fn() } as any,
      { broadcastToClients } as any,
    );
  });

  // TokensModule relies on this to isolate tenants and log with context
  it.each([
    ['broadcastPutToken', 'PUT'],
    ['broadcastPatchToken', 'PATCH'],
    ['broadcastDeleteToken', 'PATCH'],
  ] as const)('%s propagates broadcast errors', async (method, httpMethod) => {
    broadcastToClients.mockRejectedValueOnce(new Error('partner lookup'));
    await expect(
      broadcaster[method](tenant, { idToken: 'TOKEN001' } as any),
    ).rejects.toThrow('partner lookup');
    expect(broadcastToClients).toHaveBeenCalledWith(
      expect.objectContaining({
        httpMethod,
        path: '/FR/ZTA/TOKEN001',
      }),
    );
  });

  it('broadcastDeleteToken PATCHes valid=false', async () => {
    await broadcaster.broadcastDeleteToken(tenant, {
      idToken: 'TOKEN001',
    } as any);
    expect(broadcastToClients).toHaveBeenCalledWith(
      expect.objectContaining({
        httpMethod: 'PATCH',
        body: expect.objectContaining({ uid: 'TOKEN001', valid: false }),
        otherParams: { type: 'RFID' },
      }),
    );
  });
});
