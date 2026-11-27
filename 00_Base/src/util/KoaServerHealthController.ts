// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { Context } from 'koa';
import { Ctx, Get, JsonController } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ServiceReadiness } from './ServiceReadiness.js';

@JsonController()
@Service()
export class HealthController {
  @Inject()
  protected readiness!: ServiceReadiness;

  /** Liveness: the process answers HTTP. */
  @Get('/health')
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  /** Readiness: startup finished and not shutting down. 503 otherwise. */
  @Get('/health/ready')
  ready(@Ctx() ctx: Context) {
    const ready = this.readiness.ready;
    ctx.status = ready ? 200 : 503;
    return {
      status: ready ? 'ready' : 'not_ready',
      eventLeader: this.readiness.eventLeader ?? null,
      timestamp: new Date().toISOString(),
    };
  }
}
