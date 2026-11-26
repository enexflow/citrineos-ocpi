// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { Context } from 'koa';
import { HealthController } from '../KoaServerHealthController.js';
import { ServiceReadiness } from '../ServiceReadiness.js';

function controllerWith(readiness: ServiceReadiness): HealthController {
  const controller = new HealthController();
  Object.assign(controller, { readiness });
  return controller;
}

describe('HealthController readiness', () => {
  it('answers 503 until startup has finished', () => {
    const ctx = {} as Context;

    const body = controllerWith(new ServiceReadiness()).ready(ctx);

    expect(ctx.status).toBe(503);
    expect(body.status).toBe('not_ready');
    expect(body.eventLeader).toBeNull();
  });

  it('answers 200 with the event leadership once ready', () => {
    const readiness = new ServiceReadiness();
    let leader = false;
    readiness.markReady(() => leader);
    const controller = controllerWith(readiness);

    const ctx = {} as Context;
    expect(controller.ready(ctx).eventLeader).toBe(false);
    expect(ctx.status).toBe(200);

    leader = true;
    expect(controller.ready({} as Context).eventLeader).toBe(true);
  });

  it('answers 503 again once shutting down', () => {
    const readiness = new ServiceReadiness();
    readiness.markReady();
    readiness.markNotReady();
    const ctx = {} as Context;

    controllerWith(readiness).ready(ctx);

    expect(ctx.status).toBe(503);
  });
});
