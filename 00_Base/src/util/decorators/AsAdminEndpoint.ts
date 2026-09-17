// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { UnauthorizedError, UseBefore } from 'routing-controllers';
import { HttpExceptionHandler } from '../middleware/HttpExceptionHandler.js';
import { OcpiConfigToken } from '../../config/ocpi.types.js';
import { oidcAuthMiddleware } from '../security/oidcAuthMiddleware.js';
import { Container } from 'typedi';

/**
 * Decorator to add necessary auth and exception handling for "admin" OCPI endpoints
 */
export const AsAdminEndpoint = function () {
  return function (object: any, methodName: string) {
    UseBefore((ctx: any, next: any) => {
      const config = Container.get(OcpiConfigToken);
      if (!config.oidc) {
        throw new UnauthorizedError('Admin endpoints require OIDC to be configured');
      }
      return oidcAuthMiddleware(config.oidc)(ctx, next);
    })(object, methodName);
    UseBefore(HttpExceptionHandler)(object, methodName);
  };
};
