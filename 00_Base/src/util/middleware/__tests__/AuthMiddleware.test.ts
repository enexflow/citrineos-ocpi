// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// citrineos-base is ESM-only, jest can't load it: stub what the middleware uses.
jest.mock('@zetra/citrineos-base', () => {
  class UnauthorizedException extends Error {}
  return {
    HttpHeader: { Authorization: 'Authorization' },
    HttpStatus: { UNAUTHORIZED: 401 },
    UnauthorizedException,
  };
});
jest.mock('../../../graphql/index.js', () => ({
  GET_TENANT_PARTNER_BY_SERVER_TOKEN: 'GET_TENANT_PARTNER_BY_SERVER_TOKEN',
  OcpiGraphqlClient: class {},
}));
jest.mock('../../helpers.js', () => ({ getRoamingPartner: () => undefined }));
jest.mock('../../apiDocs.js', () => ({ apiDocsAuthExemptRoutes: () => [] }));

import { Container } from 'typedi';
import { Logger } from 'tslog';
import { AuthMiddleware } from '../AuthMiddleware.js';
import type { OcpiGraphqlClient } from '../../../graphql/index.js';

const KNOWN_TOKEN = 'emsp-server-token';
const tenantPartner = {
  id: 7,
  countryCode: 'FR',
  partyId: 'Q47',
  tenant: { countryCode: 'FR', partyId: 'ZET' },
};

// Shape of the START_SESSION a peer-to-peer eMSP sent on staging (2026-11-19): no routing headers,
// no party in the URL, the party only nested in body.token.
const buildStartSessionContext = (
  token: string,
  state: Record<string, unknown> = {},
) => {
  const headers = {
    authorization: `Token ${Buffer.from(token).toString('base64')}`,
  };
  const path = '/ocpi/cpo/2.2.1/commands/START_SESSION';
  return {
    req: { headers },
    request: {
      headers,
      method: 'POST',
      path,
      url: path,
      originalUrl: path,
      body: {
        location_id: '1786',
        evse_uid: 'ocpicp::1',
        token: { country_code: 'FR', party_id: 'Q47', uid: 'X' },
        response_url: 'https://emsp.example/commands/START_SESSION/1',
      },
    },
    state,
    status: 200,
    body: undefined as unknown,
    type: undefined as unknown,
  };
};

const buildMiddleware = () => {
  const graphqlClient = {
    request: jest.fn(
      async (_query: unknown, vars: { serverToken: string }) => ({
        TenantPartners: vars.serverToken === KNOWN_TOKEN ? [tenantPartner] : [],
      }),
    ),
  };
  return new AuthMiddleware(graphqlClient as unknown as OcpiGraphqlClient);
};

// Covers the middleware contract only; the flag wiring on CommandsModuleApi.postCommand is not tested (top-level await blocks importing it under jest).
describe('AuthMiddleware contract: skipTenantPartnerUrlValidation on a command without routing headers', () => {
  beforeAll(() => {
    Container.set(Logger, new Logger({ type: 'hidden' }));
  });

  it('rejects it when the endpoint requires the party in the URL or body', async () => {
    const ctx = buildStartSessionContext(KNOWN_TOKEN);
    const next = jest.fn();

    await buildMiddleware().use(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.status).toBe(401);
  });

  it('accepts it on the token alone when the endpoint skips the URL validation', async () => {
    const ctx = buildStartSessionContext(KNOWN_TOKEN, {
      skipTenantPartnerUrlValidation: true,
    });
    const next = jest.fn();

    await buildMiddleware().use(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.status).toBe(200);
    expect(ctx.state.tenantPartner).toBe(tenantPartner);
  });

  it('still rejects an unknown token when the endpoint skips the URL validation', async () => {
    const ctx = buildStartSessionContext('unknown-token', {
      skipTenantPartnerUrlValidation: true,
    });
    const next = jest.fn();

    await buildMiddleware().use(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.status).toBe(401);
  });
});
