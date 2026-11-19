// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { Service } from 'typedi';
import { Logger, type ILogObj } from 'tslog';
import type { Session } from '../model/Session.js';
import { HttpMethod } from '@zetra/citrineos-base';

type DedupeKey = string;

@Service()
export class SessionBroadcastDedupeService {
  private readonly lastFingerprint = new Map<DedupeKey, string>();
  // End of the last charging period each partner has, keyed by transactionId:partnerId
  private readonly sentUntil = new Map<string, Date>();
  // updatedAt of the newest transaction snapshot sent to each partner, keyed like sentUntil
  private readonly sentSnapshotAt = new Map<string, number>();
  // Tail of the broadcasts queued per transactionId:partnerId
  private readonly queues = new Map<string, Promise<unknown>>();

  /**
   * Longest wait for the previous broadcast of the same session. The HTTP client has no
   * timeout, so a partner that never answers would otherwise hold the queue, and with it the
   * Ended update, the CDR sent after it and clear().
   */
  queueMaxWaitMs = 30_000;
  /** How long clear() keeps the cursor of an ended session, so late updates are recognized. */
  endedStateTtlMs = 10 * 60_000;

  constructor(private readonly logger: Logger<ILogObj>) {}

  private key(
    transactionId: string,
    partnerId: number,
    method: HttpMethod,
  ): DedupeKey {
    return `${transactionId}:${partnerId}:${method}`;
  }

  fingerprint(body: Partial<Session>): string {
    const lastPeriod = body.charging_periods?.at(-1);
    return [
      body.status ?? '',
      body.last_updated instanceof Date
        ? body.last_updated.toISOString()
        : String(body.last_updated ?? ''),
      (body.kwh ?? 0).toFixed(4),
      body.end_date_time instanceof Date
        ? body.end_date_time.toISOString()
        : String(body.end_date_time ?? 'null'),
      body.charging_periods?.length ?? 0,
      lastPeriod?.start_date_time instanceof Date
        ? lastPeriod.start_date_time.toISOString()
        : String(lastPeriod?.start_date_time ?? ''),
      // optional: hash dimension volumes of last period
    ].join('|');
  }

  shouldBroadcast(
    transactionId: string,
    partnerId: number,
    method: HttpMethod,
    body: Partial<Session>,
  ): boolean {
    const k = this.key(transactionId, partnerId, method);
    const fp = this.fingerprint(body);

    if (this.lastFingerprint.get(k) === fp) {
      this.logger.debug('Session broadcast skipped (duplicate fingerprint)', {
        k,
        fp,
      });
      return false;
    }
    return true;
  }

  markSent(
    transactionId: string,
    partnerId: number,
    method: HttpMethod,
    body: Partial<Session>,
  ): void {
    const k = this.key(transactionId, partnerId, method);
    this.lastFingerprint.set(k, this.fingerprint(body));
  }

  /**
   * Runs the broadcasts of one session to one partner one after the other. Reading the
   * sentUntil cursor, sending and moving it must not interleave, or two PATCHes built from the
   * same cursor would both append the same periods. Queuing (instead of skipping while one is
   * in flight) also keeps the last update of a session, such as the Ended one, from being dropped.
   */
  async runExclusive<T>(
    transactionId: string,
    partnerId: number,
    task: () => Promise<T>,
  ): Promise<T> {
    const k = `${transactionId}:${partnerId}`;
    const previous = this.queues.get(k);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waitForPrevious = previous
      ? Promise.race([
          previous.catch(() => undefined),
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              this.logger.warn(
                `Previous session broadcast for ${k} still pending after ${this.queueMaxWaitMs} ms, sending anyway`,
              );
              resolve();
            }, this.queueMaxWaitMs);
            timer.unref?.();
          }),
        ]).finally(() => clearTimeout(timer))
      : Promise.resolve();
    const run = waitForPrevious.then(task);
    const tail = run.catch(() => undefined);
    this.queues.set(k, tail);
    try {
      return await run;
    } finally {
      if (this.queues.get(k) === tail) {
        this.queues.delete(k);
      }
    }
  }

  /**
   * End of the last charging period sent to the partner, undefined when unknown (nothing sent
   * yet, or the process restarted): the caller then resyncs with a full PUT.
   */
  getSentUntil(transactionId: string, partnerId: number): Date | undefined {
    return this.sentUntil.get(`${transactionId}:${partnerId}`);
  }

  /** Forgets the cursor, so the next update resyncs the partner with a full PUT. */
  forgetSentUntil(transactionId: string, partnerId: number): void {
    this.sentUntil.delete(`${transactionId}:${partnerId}`);
  }

  /**
   * Moves the cursor forward only, so a late, older update cannot make periods resend. Also
   * records the updatedAt of the transaction snapshot that was sent.
   */
  advanceSentUntil(
    transactionId: string,
    partnerId: number,
    until: Date,
    snapshotAt?: Date,
  ): void {
    const k = `${transactionId}:${partnerId}`;
    const current = this.sentUntil.get(k);
    if (!current || until.getTime() > current.getTime()) {
      this.sentUntil.set(k, until);
    }
    const time = snapshotAt?.getTime();
    if (time !== undefined && !Number.isNaN(time)) {
      this.sentSnapshotAt.set(
        k,
        Math.max(time, this.sentSnapshotAt.get(k) ?? time),
      );
    }
  }

  /**
   * Events are handled concurrently, so a broadcast can reach the queue after a newer one:
   * true when a newer transaction snapshot was already sent, and this one would roll back
   * status, kwh or end_date_time on the partner side.
   */
  isOlderThanSent(
    transactionId: string,
    partnerId: number,
    snapshotAt?: Date,
  ): boolean {
    const time = snapshotAt?.getTime();
    const sent = this.sentSnapshotAt.get(`${transactionId}:${partnerId}`);
    return (
      time !== undefined &&
      !Number.isNaN(time) &&
      sent !== undefined &&
      time < sent
    );
  }

  /**
   * Drops the dedupe state of an ended session. Only the snapshot time is kept, for
   * endedStateTtlMs: an update handled after the Ended one is then skipped as older, instead
   * of finding no cursor and PUTting a stale ACTIVE session.
   */
  clear(transactionId: string): void {
    const ofTransaction = (k: string) => k.startsWith(`${transactionId}:`);
    const purge = setTimeout(() => {
      for (const k of this.sentSnapshotAt.keys()) {
        if (ofTransaction(k)) {
          this.sentSnapshotAt.delete(k);
        }
      }
    }, this.endedStateTtlMs);
    purge.unref?.();
    for (const k of this.sentUntil.keys()) {
      if (ofTransaction(k)) {
        this.sentUntil.delete(k);
      }
    }
    for (const k of this.lastFingerprint.keys()) {
      if (k.startsWith(`${transactionId}:`)) {
        this.lastFingerprint.delete(k);
      }
    }
  }
}
