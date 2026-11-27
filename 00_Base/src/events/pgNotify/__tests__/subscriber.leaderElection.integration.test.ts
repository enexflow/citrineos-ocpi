// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Leader election against a real Postgres: two subscribers (two OCPI instances) on the same
 * database, only the lock holder receives NOTIFYs, and the standby takes over when the
 * leader shuts down or its session is killed.
 */
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { Logger } from 'tslog';
import type { ILogObj } from 'tslog';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PgNotifyEventSubscriber } from '../subscriber.js';
import type { OcpiConfig } from '../../../config/ocpi.types.js';
import testImages from '../../../../../Tests/helpers/testImages.json' with { type: 'json' };

const CHANNEL = 'TransactionNotification';
const logger = new Logger<ILogObj>({ type: 'hidden' });

describe('PgNotifyEventSubscriber leader election (Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Client;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(testImages.postgres).start();
    admin = new pg.Client({ connectionString: container.getConnectionUri() });
    await admin.connect();
  });

  afterAll(async () => {
    await admin?.end();
    await container?.stop();
  });

  const config = (): OcpiConfig =>
    ({
      database: {
        host: container.getHost(),
        port: container.getPort(),
        username: container.getUsername(),
        password: container.getPassword(),
        database: container.getDatabase(),
      },
      events: { leaderElection: { retryIntervalSeconds: 1 } },
    }) as unknown as OcpiConfig;

  async function startInstance() {
    const subscriber = new PgNotifyEventSubscriber(config(), logger);
    await subscriber.init();
    const received: unknown[] = [];
    await subscriber.subscribe(
      CHANNEL,
      (event) => received.push(event.payload),
      () => undefined,
    );
    const onAcquired = vi.fn(async () => undefined);
    const onLost = vi.fn(async () => undefined);
    subscriber.addLeadershipListener({ onAcquired, onLost });
    subscriber.startLeaderElection();
    return { subscriber, received, onAcquired, onLost };
  }

  const notify = (id: number) =>
    admin.query(`SELECT pg_notify($1, $2)`, [
      CHANNEL,
      JSON.stringify({ operation: 'UPDATE', data: { id } }),
    ]);

  it('delivers each NOTIFY once, to the leader only, and fails over', async () => {
    const a = await startInstance();
    await vi.waitFor(() => expect(a.subscriber.isLeader).toBe(true));
    const b = await startInstance();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(b.subscriber.isLeader).toBe(false);

    await notify(1);
    await vi.waitFor(() => expect(a.received).toEqual([{ id: 1 }]));
    expect(b.received).toEqual([]);

    // Graceful handover.
    await a.subscriber.shutdown();
    expect(a.onLost).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(b.subscriber.isLeader).toBe(true), {
      timeout: 5000,
    });
    await notify(2);
    await vi.waitFor(() => expect(b.received).toEqual([{ id: 2 }]));

    // Hard failure: Postgres kills the leader's session (as after a node loss).
    const c = await startInstance();
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_locks
       WHERE locktype = 'advisory' AND granted AND pid <> pg_backend_pid()`,
    );
    await vi.waitFor(() => expect(b.onLost).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(c.subscriber.isLeader).toBe(true), {
      timeout: 5000,
    });
    // b reconnects and stays on standby.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(b.subscriber.isLeader).toBe(false);

    await notify(3);
    await vi.waitFor(() => expect(c.received).toEqual([{ id: 3 }]));
    expect(b.received).toEqual([{ id: 2 }]);

    await b.subscriber.shutdown();
    await c.subscriber.shutdown();
  });
});
