// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { logDbBroadcast, Role, type IDtoEventContext } from '../index.js';
import type { TenantDto } from '@citrineos/base';
import { Logger } from 'tslog';
import type { ILogObj } from 'tslog';

export const shouldBroadcast = (
  tenant: TenantDto | undefined, // ← accept undefined
  requiredRole: Role,
  context: IDtoEventContext,
  logger: Logger<ILogObj>,
  objectId: string,
) => {
  if (!tenant || !tenant.countryCode || !tenant.partyId) {
    logDbBroadcast(
      logger,
      'error',
      `Tenant data missing in ${context.eventType} notification for ${context.objectType} ${objectId}, cannot broadcast.`,
    );
    return false;
  }
  if (!tenant.serverProfileOCPI?.credentialsRole) {
    logDbBroadcast(
      logger,
      'error',
      `Tenant ${tenant.id} does not have a server profile OCPI credentials role, cannot broadcast.`,
    );
    return false;
  }
  if (tenant.serverProfileOCPI?.credentialsRole?.role !== requiredRole) {
    logDbBroadcast(
      logger,
      'info',
      `Tenant is not a ${requiredRole} in ${context.eventType} notification for ${context.objectType} ${objectId}, should not be broadcasted.`,
    );
    return false;
  }
  return true;
};
