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
  private readonly inFlight = new Set<DedupeKey>();
  // End of the last charging period each partner has, keyed by transactionId:partnerId
  private readonly sentUntil = new Map<string, Date>();
  // Tail of the broadcasts queued per transactionId:partnerId
  private readonly queues = new Map<string, Promise<unknown>>();

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

    if (this.inFlight.has(k)) {
      this.logger.debug('Session broadcast skipped (in flight)', { k });
      return false;
    }
    if (this.lastFingerprint.get(k) === fp) {
      this.logger.debug('Session broadcast skipped (duplicate fingerprint)', {
        k,
        fp,
      });
      return false;
    }
    return true;
  }

  markInFlight(
    transactionId: string,
    partnerId: number,
    method: HttpMethod,
  ): void {
    this.inFlight.add(this.key(transactionId, partnerId, method));
  }

  markSent(
    transactionId: string,
    partnerId: number,
    method: HttpMethod,
    body: Partial<Session>,
  ): void {
    const k = this.key(transactionId, partnerId, method);
    this.lastFingerprint.set(k, this.fingerprint(body));
    this.inFlight.delete(k);
  }

  markFailed(
    transactionId: string,
    partnerId: number,
    method: HttpMethod,
  ): void {
    this.inFlight.delete(this.key(transactionId, partnerId, method));
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
    const run = (this.queues.get(k) ?? Promise.resolve())
      .catch(() => undefined)
      .then(task);
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

  /** Moves the cursor forward only, so a late, older update cannot make periods resend. */
  advanceSentUntil(
    transactionId: string,
    partnerId: number,
    until: Date,
  ): void {
    const k = `${transactionId}:${partnerId}`;
    const current = this.sentUntil.get(k);
    if (!current || until.getTime() > current.getTime()) {
      this.sentUntil.set(k, until);
    }
  }

  clear(transactionId: string): void {
    for (const k of this.sentUntil.keys()) {
      if (k.startsWith(`${transactionId}:`)) {
        this.sentUntil.delete(k);
      }
    }
    for (const k of this.lastFingerprint.keys()) {
      if (k.startsWith(`${transactionId}:`)) {
        this.lastFingerprint.delete(k);
      }
    }
    for (const k of this.inFlight) {
      if (k.startsWith(`${transactionId}:`)) {
        this.inFlight.delete(k);
      }
    }
  }
}
