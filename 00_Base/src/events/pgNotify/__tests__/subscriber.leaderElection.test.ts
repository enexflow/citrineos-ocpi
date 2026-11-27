// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// Fake pg: every client shares one advisory lock, like sessions on the same database.
jest.mock('pg', () => {
  const { EventEmitter } = jest.requireActual('events');
  const state: { lockOwner: unknown; clients: any[] } = {
    lockOwner: null,
    clients: [],
  };
  class Client extends EventEmitter {
    queries: string[] = [];
    ended = false;
    constructor(public config: unknown) {
      super();
      state.clients.push(this);
    }
    async connect() {}
    async query(sql: string) {
      this.queries.push(sql);
      if (sql.includes('pg_try_advisory_lock')) {
        const locked = state.lockOwner === null || state.lockOwner === this;
        if (locked) state.lockOwner = this;
        return { rows: [{ locked }] };
      }
      if (sql.includes('pg_advisory_unlock')) {
        if (state.lockOwner === this) state.lockOwner = null;
        return { rows: [{ pg_advisory_unlock: true }] };
      }
      return { rows: [] };
    }
    async end() {
      this.release();
      this.emit('end');
    }
    /** Session ends without a clean close (crash, network loss): Postgres drops the lock. */
    crash() {
      this.release();
      this.emit('end');
    }
    private release() {
      this.ended = true;
      if (state.lockOwner === this) state.lockOwner = null;
    }
  }
  return { __esModule: true, default: { Client }, Client, __state: state };
});

import { Logger } from 'tslog';
import type { ILogObj } from 'tslog';
import type { EventLeadershipListener } from '../subscriber.js';
import { PgNotifyEventSubscriber } from '../subscriber.js';
import type { OcpiConfig } from '../../../config/ocpi.types.js';

const pgState = (jest.requireMock('pg') as any).__state as {
  lockOwner: unknown;
  clients: any[];
};

const logger = new Logger<ILogObj>({ type: 'hidden' });

function config(enabled = true): OcpiConfig {
  return {
    database: {
      host: 'db',
      port: 5432,
      username: 'u',
      password: 'p',
      database: 'd',
    },
    events: { leaderElection: { enabled, retryIntervalSeconds: 1 } },
  } as unknown as OcpiConfig;
}

function recordingListener(log: string[], name: string) {
  return {
    onAcquired: jest.fn(async () => {
      log.push(`${name}:acquired`);
    }),
    onLost: jest.fn(async () => {
      log.push(`${name}:lost`);
    }),
  } satisfies EventLeadershipListener;
}

async function startInstance(
  log: string[],
  name: string,
  enabled = true,
): Promise<{
  subscriber: PgNotifyEventSubscriber;
  listener: ReturnType<typeof recordingListener>;
  handleEvent: jest.Mock;
  client: () => any;
}> {
  const subscriber = new PgNotifyEventSubscriber(config(enabled), logger);
  await subscriber.init();
  const client = pgState.clients[pgState.clients.length - 1];
  const handleEvent = jest.fn();
  await subscriber.subscribe('TransactionNotification', handleEvent, jest.fn());
  const listener = recordingListener(log, name);
  subscriber.addLeadershipListener(listener);
  subscriber.startLeaderElection();
  await jest.advanceTimersByTimeAsync(0);
  return {
    subscriber,
    listener,
    handleEvent,
    client: () => (subscriber as any)._pgClient ?? client,
  };
}

const LISTEN = 'LISTEN "TransactionNotification"';

describe('PgNotifyEventSubscriber leader election', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    pgState.lockOwner = null;
    pgState.clients.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sets server-side keepalives on the lock connection', async () => {
    const a = await startInstance([], 'a');

    expect(a.client().queries[0]).toContain('tcp_keepalives_idle');
    await a.subscriber.shutdown();
  });

  it('reports leadership only once consumers are bound and LISTEN is active', async () => {
    const subscriber = new PgNotifyEventSubscriber(config(), logger);
    await subscriber.init();
    await subscriber.subscribe('TransactionNotification', jest.fn(), jest.fn());
    let release!: () => void;
    const seenDuringTakeover: boolean[] = [];
    subscriber.addLeadershipListener({
      onAcquired: () =>
        new Promise<void>((resolve) => {
          seenDuringTakeover.push(subscriber.isLeader);
          release = resolve;
        }),
      onLost: async () => undefined,
    });
    subscriber.startLeaderElection();
    await jest.advanceTimersByTimeAsync(0);

    // Lock held, consumers still binding: a NOTIFY now would be missed.
    expect(seenDuringTakeover).toEqual([false]);
    expect(subscriber.isLeader).toBe(false);

    release();
    await jest.advanceTimersByTimeAsync(0);
    expect(subscriber.isLeader).toBe(true);
    await subscriber.shutdown();
  });

  it('takes the lock, starts consumers, then LISTENs', async () => {
    const log: string[] = [];
    const a = await startInstance(log, 'a');

    expect(a.subscriber.isLeader).toBe(true);
    expect(log).toEqual(['a:acquired']);
    const queries: string[] = a.client().queries;
    expect(queries).toContain(LISTEN);
    // LISTEN only after the lock was granted.
    expect(
      queries.findIndex((q) => q.includes('pg_try_advisory_lock')),
    ).toBeLessThan(queries.indexOf(LISTEN));

    await a.subscriber.shutdown();
  });

  it('keeps a second instance on standby without LISTEN', async () => {
    const log: string[] = [];
    const a = await startInstance(log, 'a');
    const b = await startInstance(log, 'b');
    await jest.advanceTimersByTimeAsync(5000);

    expect(a.subscriber.isLeader).toBe(true);
    expect(b.subscriber.isLeader).toBe(false);
    expect(b.client().queries).not.toContain(LISTEN);
    expect(b.listener.onAcquired).not.toHaveBeenCalled();

    await a.subscriber.shutdown();
    await b.subscriber.shutdown();
  });

  it('hands over on graceful shutdown: UNLISTEN, stop consumers, unlock', async () => {
    const log: string[] = [];
    const a = await startInstance(log, 'a');
    const b = await startInstance(log, 'b');
    const aClient = a.client();

    await a.subscriber.shutdown();
    expect(aClient.queries).toContain('UNLISTEN *');
    expect(aClient.queries.some((q: string) => q.includes('unlock'))).toBe(
      true,
    );
    expect(log).toEqual(['a:acquired', 'a:lost']);

    await jest.advanceTimersByTimeAsync(1000);
    expect(b.subscriber.isLeader).toBe(true);
    expect(b.client().queries).toContain(LISTEN);
    expect(log).toEqual(['a:acquired', 'a:lost', 'b:acquired']);

    await b.subscriber.shutdown();
  });

  it('fails over when the leader connection dies, and the old leader comes back as standby', async () => {
    const log: string[] = [];
    const a = await startInstance(log, 'a');
    const b = await startInstance(log, 'b');

    a.client().crash();
    await jest.advanceTimersByTimeAsync(0);
    expect(a.subscriber.isLeader).toBe(false);
    expect(log).toEqual(['a:acquired', 'a:lost']);

    await jest.advanceTimersByTimeAsync(1000);
    expect(b.subscriber.isLeader).toBe(true);

    // a reconnected (new client) and keeps campaigning without winning.
    await jest.advanceTimersByTimeAsync(5000);
    expect(a.client().ended).toBe(false);
    expect(a.subscriber.isLeader).toBe(false);
    expect(log).toEqual(['a:acquired', 'a:lost', 'b:acquired']);

    await a.subscriber.shutdown();
    await b.subscriber.shutdown();
  });

  it('dispatches notifications only while leader', async () => {
    const log: string[] = [];
    const a = await startInstance(log, 'a');
    const b = await startInstance(log, 'b');
    const notification = {
      channel: 'TransactionNotification',
      payload: JSON.stringify({ operation: 'UPDATE', data: { id: 1 } }),
    };

    a.client().emit('notification', notification);
    b.client().emit('notification', notification);

    expect(a.handleEvent).toHaveBeenCalledTimes(1);
    expect(b.handleEvent).not.toHaveBeenCalled();

    await a.subscriber.shutdown();
    await b.subscriber.shutdown();
  });

  it('steps down and releases the lock when starting consumers fails', async () => {
    const subscriber = new PgNotifyEventSubscriber(config(), logger);
    await subscriber.init();
    await subscriber.subscribe('TransactionNotification', jest.fn(), jest.fn());
    const onLost = jest.fn(async () => {});
    subscriber.addLeadershipListener({
      onAcquired: jest.fn(async () => {
        throw new Error('RabbitMQ is down');
      }),
      onLost,
    });
    subscriber.startLeaderElection();
    await jest.advanceTimersByTimeAsync(0);

    expect(subscriber.isLeader).toBe(false);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(pgState.lockOwner).toBeNull();
    expect((subscriber as any)._pgClient.queries).not.toContain(LISTEN);

    await subscriber.shutdown();
  });

  it('LISTENs right away when leader election is disabled', async () => {
    const log: string[] = [];
    const a = await startInstance(log, 'a', false);

    expect(a.subscriber.isLeader).toBe(true);
    expect(a.client().queries).toContain(LISTEN);
    expect(a.client().queries.some((q: string) => q.includes('advisory'))).toBe(
      false,
    );

    await a.subscriber.shutdown();
  });
});
