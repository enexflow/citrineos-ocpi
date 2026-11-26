// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { IDtoEventSubscriber, IDtoPayload } from '../index.js';
import { DtoEventType } from '../index.js';
import type { Client, ClientConfig, Notification } from 'pg';
import pg from 'pg';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import type { OcpiConfig } from '../../config/ocpi.types.js';
import { OcpiConfigToken } from '../../config/ocpi.types.js';
import { Inject, Service } from 'typedi';

const { Client: PgClient } = pg;

interface IPgNotification {
  operation: DtoEventType;
  data: any;
  isStatusChanged?: boolean;
}

type EventHandler<T = any> = {
  handleEvent: (event: {
    eventType: DtoEventType;
    payload: T;
    isStatusChanged?: boolean;
  }) => void;
  handleError: (error: any) => void;
  handleDisconnect?: () => void;
};

/**
 * Notified when this instance becomes, or stops being, the one that processes events.
 * Calls are serialized: onLost never overlaps a running onAcquired.
 */
export interface EventLeadershipListener {
  /** Start consuming events. LISTEN starts only after this resolves. */
  onAcquired(): Promise<void>;
  /** Stop consuming events. */
  onLost(): Promise<void>;
}

const DEFAULT_LOCK_KEY = 'citrineos-ocpi:events';
const DEFAULT_RETRY_INTERVAL_SECONDS = 3;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
/**
 * Server-side TCP keepalive for the session holding the lock: if the leader's node vanishes
 * without closing its socket, Postgres drops the session, and with it the advisory lock, after
 * about idle + interval * count = 25 s instead of the OS default of about 2 h.
 */
const SESSION_KEEPALIVE_SQL =
  'SET tcp_keepalives_idle = 10; SET tcp_keepalives_interval = 5; SET tcp_keepalives_count = 3;';

/**
 * Listens to Postgres NOTIFY channels on a dedicated connection.
 *
 * With leader election enabled (the default), several instances can run side by side: only the
 * one holding a session-level advisory lock on that same connection LISTENs. Others retry the
 * lock periodically and take over when the leader's session ends (shutdown, crash, network
 * loss). Leadership changes are reported to {@link EventLeadershipListener}s so that the rest
 * of the event pipeline (RabbitMQ consumers) runs on the leader only.
 */
@Service()
export class PgNotifyEventSubscriber implements IDtoEventSubscriber {
  protected _pgClient?: Client;
  protected readonly _logger: Logger<ILogObj>;
  /** Channels LISTENed on the current connection. */
  protected subscribedChannels = new Set<string>();
  protected eventHandlers = new Map<string, EventHandler>();

  private readonly _clientConfig: ClientConfig;
  private readonly _electionEnabled: boolean;
  private readonly _lockKey: string;
  private readonly _retryIntervalMs: number;
  private readonly _leadershipListeners: EventLeadershipListener[] = [];
  private _isLeader = false;
  private _campaigning = false;
  private _stopped = false;
  private _campaignTimer?: NodeJS.Timeout;
  private _reconnectTimer?: NodeJS.Timeout;
  private _reconnectAttempts = 0;
  private _transitions: Promise<void> = Promise.resolve();

  constructor(
    @Inject(OcpiConfigToken) config: OcpiConfig,
    logger?: Logger<ILogObj>,
  ) {
    this._logger = logger
      ? logger.getSubLogger({ name: this.constructor.name })
      : new Logger<ILogObj>({ name: this.constructor.name });

    this._clientConfig = {
      host: config.database.host,
      port: config.database.port,
      user: config.database.username,
      password: config.database.password,
      database: config.database.database,
      // Client-side keepalive: detect a dead Postgres (e.g. failover) on our side too.
      keepAlive: true,
    };
    const election = config.events?.leaderElection;
    this._electionEnabled = election?.enabled ?? true;
    this._lockKey = election?.lockKey ?? DEFAULT_LOCK_KEY;
    this._retryIntervalMs =
      (election?.retryIntervalSeconds ?? DEFAULT_RETRY_INTERVAL_SECONDS) * 1000;
  }

  /** True while this instance holds the lock (always true when election is disabled). */
  get isLeader(): boolean {
    return this._isLeader;
  }

  get leaderElectionEnabled(): boolean {
    return this._electionEnabled;
  }

  addLeadershipListener(listener: EventLeadershipListener): void {
    this._leadershipListeners.push(listener);
  }

  /** Connects to Postgres. Throws if the first connection fails. */
  async init(): Promise<void> {
    await this._connect();
  }

  /**
   * Starts competing for the lock. Call once every channel is subscribed and every listener is
   * registered. No-op when election is disabled: LISTEN then starts on subscribe, as before.
   */
  startLeaderElection(): void {
    if (!this._electionEnabled || this._campaigning || this._stopped) {
      return;
    }
    this._campaigning = true;
    this._logger.info(
      `Competing for event-processing leadership (lock "${this._lockKey}", retry every ${this._retryIntervalMs} ms)`,
    );
    void this._campaign();
  }

  async subscribe<T extends IDtoPayload>(
    eventId: string,
    handleEvent: (event: { eventType: DtoEventType; payload: T }) => void,
    handleError: (error: any) => void,
    handleDisconnect?: () => void,
  ): Promise<boolean> {
    try {
      this.eventHandlers.set(eventId, {
        handleEvent,
        handleError,
        handleDisconnect,
      });
      const client = this._pgClient;
      if (this._isLeader && client) {
        await this._listen(client, eventId);
      }
      return true;
    } catch (error) {
      this._logger.error(`Failed to subscribe to "${eventId}":`, error);
      handleError(error);
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this._stopped = true;
    clearTimeout(this._campaignTimer);
    clearTimeout(this._reconnectTimer);
    const client = this._pgClient;
    try {
      if (client && this._isLeader) {
        // Stop publishing first, then let consumers stop, then hand the lock over.
        this._isLeader = false;
        await client.query('UNLISTEN *');
        this.subscribedChannels.clear();
        await this._enqueue(() => this._loseLeadership());
        if (this._electionEnabled) {
          await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
            this._lockKey,
          ]);
          this._logger.info('Released event-processing leadership');
        }
      }
    } catch (err) {
      this._logger.error('Error releasing event-processing leadership:', err);
    }
    try {
      this._pgClient = undefined;
      this.eventHandlers.clear();
      this.subscribedChannels.clear();
      await client?.end();
      this._logger.info('Postgres client closed');
    } catch (err) {
      this._logger.error('Error shutting down pg client:', err);
    }
  }

  /**
   * Connection management
   */

  private async _connect(): Promise<void> {
    const client = new PgClient(this._clientConfig);
    client.on('notification', (msg: Notification) => this._onNotification(msg));
    client.on('error', (err) => {
      this._logger.error('Postgres client error:', err);
      this._onConnectionLost(client);
    });
    client.on('end', () => {
      this._logger.warn('Postgres client disconnected');
      this._onConnectionLost(client);
    });
    try {
      await client.connect();
      await client.query(SESSION_KEEPALIVE_SQL);
    } catch (err) {
      client.removeAllListeners('end');
      client.removeAllListeners('error');
      client.on('error', () => {});
      await client.end().catch(() => undefined);
      throw err;
    }
    this._pgClient = client;
    this.subscribedChannels.clear();
    this._logger.info('Connected to PostgreSQL for notifications');

    if (!this._electionEnabled) {
      this._isLeader = true;
      await this._listenAll(client);
    }
  }

  private _onConnectionLost(client: Client): void {
    if (client !== this._pgClient) {
      return;
    }
    this._pgClient = undefined;
    this.subscribedChannels.clear();
    clearTimeout(this._campaignTimer);
    this._callDisconnectHandlers();

    if (this._isLeader) {
      // The session is gone, so Postgres has released the lock already.
      this._logger.warn(
        'Lost event-processing leadership (Postgres connection lost)',
      );
      this._isLeader = false;
      void this._enqueue(() => this._loseLeadership());
    }
    this._scheduleReconnect();
  }

  private _scheduleReconnect(): void {
    if (this._stopped || this._reconnectTimer) {
      return;
    }
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this._reconnectAttempts,
      RECONNECT_MAX_DELAY_MS,
    );
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = undefined;
      if (this._stopped) return;
      this._connect()
        .then(() => {
          this._reconnectAttempts = 0;
          this._logger.info('Reconnected to PostgreSQL for notifications');
          if (this._campaigning) {
            void this._campaign();
          }
        })
        .catch((err) => {
          this._reconnectAttempts++;
          this._logger.error(
            `Postgres reconnect attempt ${this._reconnectAttempts} failed`,
            err,
          );
          this._scheduleReconnect();
        });
    }, delay);
  }

  /**
   * Leader election
   */

  private async _campaign(): Promise<void> {
    this._campaignTimer = undefined;
    const client = this._pgClient;
    if (this._stopped || this._isLeader || !client) {
      // No client: the reconnect resumes the campaign.
      return;
    }
    try {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [this._lockKey],
      );
      if (result.rows[0]?.locked) {
        await this._enqueue(() => this._gainLeadership(client));
      }
    } catch (err) {
      this._logger.warn('Event-processing leadership attempt failed:', err);
    }
    if (!this._isLeader && !this._stopped && client === this._pgClient) {
      this._campaignTimer = setTimeout(
        () => void this._campaign(),
        this._retryIntervalMs,
      );
    }
  }

  private async _gainLeadership(client: Client): Promise<void> {
    if (client !== this._pgClient || this._stopped) {
      // Connection lost (lock released with it) or shutting down meanwhile.
      return;
    }
    this._isLeader = true;
    this._logger.info('Acquired event-processing leadership');
    try {
      for (const listener of this._leadershipListeners) {
        await listener.onAcquired();
      }
      // Consumers are bound: start publishing.
      await this._listenAll(client);
    } catch (err) {
      if (client !== this._pgClient) {
        // Lost meanwhile: _onConnectionLost queued the step-down.
        return;
      }
      this._logger.error(
        'Failed to start event processing as leader, stepping down',
        err,
      );
      this._isLeader = false;
      await this._loseLeadership();
      try {
        await client.query('UNLISTEN *');
        this.subscribedChannels.clear();
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
          this._lockKey,
        ]);
      } catch (unlockErr) {
        this._logger.warn('Failed to release lock after step-down', unlockErr);
      }
    }
  }

  private async _loseLeadership(): Promise<void> {
    for (const listener of this._leadershipListeners) {
      try {
        await listener.onLost();
      } catch (err) {
        this._logger.error('Error stopping event processing:', err);
      }
    }
  }

  /** Runs leadership transitions one after the other. */
  private _enqueue(transition: () => Promise<void>): Promise<void> {
    const next = this._transitions.then(transition, transition);
    this._transitions = next.catch(() => undefined);
    return next;
  }

  /**
   * Notifications
   */

  private async _listenAll(client: Client): Promise<void> {
    for (const eventId of this.eventHandlers.keys()) {
      await this._listen(client, eventId);
    }
  }

  private async _listen(client: Client, eventId: string): Promise<void> {
    if (this.subscribedChannels.has(eventId)) {
      return;
    }
    await client.query(`LISTEN "${eventId}"`);
    this.subscribedChannels.add(eventId);
    this._logger.info(`Subscribed to event channel "${eventId}"`);
  }

  private _onNotification(msg: Notification): void {
    if (!this._isLeader) {
      return;
    }
    const handler = this.eventHandlers.get(msg.channel);
    if (!handler) return;

    try {
      const payload: IPgNotification = JSON.parse(msg.payload ?? '{}');
      handler.handleEvent({
        eventType: payload.operation,
        payload: payload.data,
        isStatusChanged: payload.isStatusChanged,
      });
    } catch (err) {
      this._logger.error(`Failed to parse notification payload:`, err);
      handler.handleError(err);
    }
  }

  private _callDisconnectHandlers(): void {
    const called = new Set<() => void>();
    for (const { handleDisconnect } of this.eventHandlers.values()) {
      if (handleDisconnect && !called.has(handleDisconnect)) {
        called.add(handleDisconnect);
        try {
          handleDisconnect();
        } catch (err) {
          this._logger.warn('Error in handleDisconnect callback:', err);
        }
      }
    }
  }
}
