// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { KoaMiddlewareInterface, ParamOptions } from 'routing-controllers';
import { HeaderParam, UseBefore } from 'routing-controllers';
import { AuthMiddleware } from '../middleware/AuthMiddleware.js';
import { OcpiHttpHeader } from '../OcpiHttpHeader.js';
import { OcpiHeaderMiddleware } from '../middleware/OcpiHeaderMiddleware.js';
import { UniqueMessageIdsMiddleware } from '../middleware/UniqueMessageIdsMiddleware.js';
import { HttpHeader } from '@citrineos/base';
import { OcpiExceptionHandler } from '../middleware/OcpiExceptionHandler.js';
import { Service } from 'typedi';

export const uniqueMessageIdHeaders = {
  [OcpiHttpHeader.XRequestId]: { required: true },
  [OcpiHttpHeader.XCorrelationId]: { required: true },
};

export interface OcpiFunctionalEndpointOptions {
  /**
   * Set to true for endpoints where tenant partner cannot be inferred from URL params
   * (e.g. GET /tokens sender interface). Auth still runs, but missing URL params won't
   * throw UnauthorizedException.
   */
  skipTenantPartnerUrlValidation?: boolean;
}

@Service()
class SkipTenantPartnerUrlValidationMiddleware implements KoaMiddlewareInterface {
  async use(ctx: any, next: (err?: any) => Promise<any>) {
    ctx.state.skipTenantPartnerUrlValidation = true;
    return next();
  }
}

/**
 * Decorator for to inject OCPI headers and apply {@link AuthMiddleware}, {@link OcpiHeaderMiddleware} and
 * {@link UniqueMessageIdsMiddleware} on the endpoint
 */
export const AsOcpiFunctionalEndpoint = function (
  options: OcpiFunctionalEndpointOptions = {},
) {
  const headers: { [key: string]: ParamOptions } = {
    [HttpHeader.Authorization]: { required: true },
    [OcpiHttpHeader.OcpiFromCountryCode]: { required: false },
    [OcpiHttpHeader.OcpiFromPartyId]: { required: false },
    [OcpiHttpHeader.OcpiToCountryCode]: { required: false },
    [OcpiHttpHeader.OcpiToPartyId]: { required: false },
    ...uniqueMessageIdHeaders,
  };
  return function (object: any, methodName: string) {
    for (const [key, options] of Object.entries(headers)) {
      HeaderParam(key, options)(object, methodName);
    }
    if (options.skipTenantPartnerUrlValidation) {
      UseBefore(SkipTenantPartnerUrlValidationMiddleware)(object, methodName);
    }
    UseBefore(AuthMiddleware)(object, methodName);
    UseBefore(OcpiHeaderMiddleware)(object, methodName);
    UseBefore(UniqueMessageIdsMiddleware)(object, methodName);
    UseBefore(OcpiExceptionHandler)(object, methodName);
  };
};
