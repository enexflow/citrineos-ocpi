// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { Service } from 'typedi';

/**
 * Process-local readiness, exposed by GET /health/ready. Deliberately does not probe shared
 * dependencies (Postgres, Redis, Hasura, RabbitMQ): when one of those is down every instance
 * would turn unready at once, taking the whole service out instead of a single pod.
 */
@Service()
export class ServiceReadiness {
  private _ready = false;
  private _eventLeaderProbe?: () => boolean;

  get ready(): boolean {
    return this._ready;
  }

  /** Whether this instance currently processes events, when leader election is wired. */
  get eventLeader(): boolean | undefined {
    return this._eventLeaderProbe?.();
  }

  markReady(eventLeaderProbe?: () => boolean): void {
    this._eventLeaderProbe = eventLeaderProbe;
    this._ready = true;
  }

  /** Called on shutdown so the load balancer stops routing new requests here. */
  markNotReady(): void {
    this._ready = false;
  }
}
