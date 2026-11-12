// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { HttpMethod } from '@zetra/citrineos-base';
import type { Session } from '../../model/Session';
import { SessionStatus } from '../../model/SessionStatus';
import { CdrDimensionType } from '../../model/CdrDimensionType';
import { SessionBroadcastDedupeService } from '../SessionBroadcastDedupeService';

jest.mock('@zetra/citrineos-base', () => ({
  HttpMethod: {
    Get: 'GET',
    Put: 'PUT',
    Post: 'POST',
    Patch: 'PATCH',
    Delete: 'DELETE',
  },
}));

const TX_ID = '3306c7cd-8e30-4f12-98b0-e44c27aeedf0';
const PARTNER_ID = 15;

function pendingBody(overrides: Partial<Session> = {}): Partial<Session> {
  return {
    id: TX_ID,
    status: SessionStatus.PENDING,
    kwh: 0,
    last_updated: new Date('2026-07-13T09:49:06.219Z'),
    end_date_time: null,
    ...overrides,
  };
}

describe('SessionBroadcastDedupeService', () => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as any;

  let service: SessionBroadcastDedupeService;

  beforeEach(() => {
    service = new SessionBroadcastDedupeService(logger);
    jest.clearAllMocks();
  });

  it('allows first broadcast', () => {
    const body = pendingBody();

    expect(
      service.shouldBroadcast(TX_ID, PARTNER_ID, HttpMethod.Put, body),
    ).toBe(true);
  });

  it('blocks identical consecutive PUT (duplicate INSERT + UPDATE)', () => {
    const body = pendingBody();

    expect(
      service.shouldBroadcast(TX_ID, PARTNER_ID, HttpMethod.Put, body),
    ).toBe(true);
    service.markSent(TX_ID, PARTNER_ID, HttpMethod.Put, body);

    expect(
      service.shouldBroadcast(TX_ID, PARTNER_ID, HttpMethod.Put, body),
    ).toBe(false);
    expect(logger.debug).toHaveBeenCalledWith(
      'Session broadcast skipped (duplicate fingerprint)',
      expect.objectContaining({
        k: `${TX_ID}:${PARTNER_ID}:${HttpMethod.Put}`,
      }),
    );
  });

  it('allows broadcast when kwh changes', () => {
    const body = pendingBody();
    service.markSent(TX_ID, PARTNER_ID, HttpMethod.Put, body);

    const updated = pendingBody({
      kwh: 0.348,
      status: SessionStatus.ACTIVE,
      last_updated: new Date('2026-07-13T09:51:06.000Z'),
    });

    expect(
      service.shouldBroadcast(TX_ID, PARTNER_ID, HttpMethod.Put, updated),
    ).toBe(true);
  });

  it('treats PATCH and PUT as separate dedupe keys', () => {
    const body = pendingBody();
    service.markSent(TX_ID, PARTNER_ID, HttpMethod.Put, body);

    expect(
      service.shouldBroadcast(TX_ID, PARTNER_ID, HttpMethod.Patch, body),
    ).toBe(true);
  });

  it('blocks second call while in flight', () => {
    const body = pendingBody();

    service.markInFlight(TX_ID, PARTNER_ID, HttpMethod.Put);

    expect(
      service.shouldBroadcast(TX_ID, PARTNER_ID, HttpMethod.Put, body),
    ).toBe(false);
    expect(logger.debug).toHaveBeenCalledWith(
      'Session broadcast skipped (in flight)',
      expect.any(Object),
    );
  });

  it('allows retry after markFailed', () => {
    const body = pendingBody();

    service.markInFlight(TX_ID, PARTNER_ID, HttpMethod.Put);
    service.markFailed(TX_ID, PARTNER_ID, HttpMethod.Put);

    expect(
      service.shouldBroadcast(TX_ID, PARTNER_ID, HttpMethod.Put, body),
    ).toBe(true);
  });

  it('clear removes stored fingerprints for transaction', () => {
    const body = pendingBody();
    service.markSent(TX_ID, PARTNER_ID, HttpMethod.Put, body);

    service.clear(TX_ID);

    expect(
      service.shouldBroadcast(TX_ID, PARTNER_ID, HttpMethod.Put, body),
    ).toBe(true);
  });

  it('fingerprint includes last charging period start', () => {
    const body = pendingBody({
      charging_periods: [
        {
          start_date_time: new Date('2026-07-13T09:51:06.000Z'),
          dimensions: [{ type: CdrDimensionType.ENERGY, volume: 0.348 }],
          tariff_id: 'TARIFF-030-KWH',
        },
      ],
    });
    service.markSent(TX_ID, PARTNER_ID, HttpMethod.Put, body);

    const samePeriodDifferentEnergy = pendingBody({
      charging_periods: [
        {
          start_date_time: new Date('2026-07-13T09:51:06.000Z'),
          dimensions: [{ type: CdrDimensionType.ENERGY, volume: 0.5 }],
          tariff_id: 'TARIFF-030-KWH',
        },
      ],
    });

    // Same period count + same start → still duplicate (energy not in fingerprint yet)
    expect(
      service.shouldBroadcast(
        TX_ID,
        PARTNER_ID,
        HttpMethod.Put,
        samePeriodDifferentEnergy,
      ),
    ).toBe(false);
  });
});

describe('SessionBroadcastDedupeService charging period cursor', () => {
  let service: SessionBroadcastDedupeService;

  beforeEach(() => {
    service = new SessionBroadcastDedupeService({
      debug: jest.fn(),
    } as never);
  });

  it('is unknown until a broadcast sets it', () => {
    expect(service.getSentUntil(TX_ID, PARTNER_ID)).toBeUndefined();
  });

  it('only moves forward', () => {
    service.advanceSentUntil(
      TX_ID,
      PARTNER_ID,
      new Date('2026-07-13T10:00:00Z'),
    );
    service.advanceSentUntil(
      TX_ID,
      PARTNER_ID,
      new Date('2026-07-13T09:00:00Z'),
    );

    expect(service.getSentUntil(TX_ID, PARTNER_ID)).toEqual(
      new Date('2026-07-13T10:00:00Z'),
    );
  });

  it('is kept per partner and dropped by clear', () => {
    service.advanceSentUntil(
      TX_ID,
      PARTNER_ID,
      new Date('2026-07-13T10:00:00Z'),
    );
    service.advanceSentUntil(
      'other-tx',
      PARTNER_ID,
      new Date('2026-07-13T10:00:00Z'),
    );

    expect(service.getSentUntil(TX_ID, PARTNER_ID + 1)).toBeUndefined();
    service.clear(TX_ID);
    expect(service.getSentUntil(TX_ID, PARTNER_ID)).toBeUndefined();
    expect(service.getSentUntil('other-tx', PARTNER_ID)).toBeDefined();
  });
});

describe('SessionBroadcastDedupeService.runExclusive', () => {
  let service: SessionBroadcastDedupeService;

  beforeEach(() => {
    service = new SessionBroadcastDedupeService({
      debug: jest.fn(),
    } as never);
  });

  it('runs the broadcasts of one session to one partner one after the other', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    const first = service.runExclusive(TX_ID, PARTNER_ID, async () => {
      order.push('first:start');
      await gate;
      order.push('first:end');
    });
    // The Ended update arriving while the previous one is in flight is queued, not dropped
    const second = service.runExclusive(TX_ID, PARTNER_ID, async () => {
      order.push('second');
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('still runs the next broadcast when the previous one failed', async () => {
    const failed = service.runExclusive(TX_ID, PARTNER_ID, async () => {
      throw new Error('boom');
    });
    const next = service.runExclusive(TX_ID, PARTNER_ID, async () => 'sent');

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('sent');
  });

  it('does not make other sessions wait', async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    const first = service.runExclusive(TX_ID, PARTNER_ID, () => gate);

    await expect(
      service.runExclusive('other-tx', PARTNER_ID, async () => 'sent'),
    ).resolves.toBe('sent');
    releaseFirst();
    await first;
  });
});
