// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Real-HTTP test of the partner token lookup (debug UI). nock intercepts at
 * the Node http layer; awsSecretCertificateArn is left unset so request() uses
 * the plain RestClient.
 */

jest.mock('@zetra/citrineos-base', () => ({
  HttpMethod: {
    Get: 'GET',
    Post: 'POST',
    Put: 'PUT',
    Patch: 'PATCH',
    Delete: 'DELETE',
  },
  HttpHeader: { Authorization: 'Authorization' },
}));

import nock from 'nock';
import { TokensClientApi } from '../TokensClientApi.js';
import { EndpointIdentifier } from '../../model/EndpointIdentifier.js';

const HOST = 'https://partner.example.com';
const PATH = '/ocpi/2.2.1/tokens';
const TOKEN_PATH = `${PATH}/FR/ZTA/UID-1`;
const SERVER_SECRET = 'our-server-token-SECRET';

function makeApi() {
  const api = new TokensClientApi() as any;
  api.logger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  api.partnerMtlsCertificateService = { getRestClient: jest.fn() };
  return api;
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    credentials: { token: 'partner-token' },
    serverCredentials: { token: SERVER_SECRET },
    endpoints: [
      {
        identifier: EndpointIdentifier.TOKENS_RECEIVER,
        url: `${HOST}${PATH}`,
      },
    ],
    ...overrides,
  } as any;
}

const lookup = (api: any, partnerProfile: any) =>
  api.getTokenFromPartner(
    'FR',
    'ZTA',
    'FR',
    'CPO',
    partnerProfile,
    'FR',
    'ZTA',
    'UID-1',
  );

beforeAll(() => {
  nock.disableNetConnect(); // any unintercepted request is a hard failure
});

afterEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.enableNetConnect();
});

describe('TokensClientApi.getTokenFromPartner', () => {
  it('returns the partner body on 200', async () => {
    const body = { status_code: 1000, data: { uid: 'UID-1' } };
    nock(HOST).get(TOKEN_PATH).reply(200, body);

    await expect(lookup(makeApi(), profile())).resolves.toEqual({
      url: `${HOST}${TOKEN_PATH}`,
      ok: true,
      httpStatus: null,
      body,
      error: null,
    });
  });

  it('reports a partner 404 with its status', async () => {
    nock(HOST).get(TOKEN_PATH).reply(404);

    const result = await lookup(makeApi(), profile());

    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
  });

  it('reports a partner 5xx with its status and body', async () => {
    const body = { status_code: 3000, status_message: 'boom' };
    nock(HOST).get(TOKEN_PATH).reply(500, body);

    const result = await lookup(makeApi(), profile());

    expect(result).toMatchObject({ ok: false, httpStatus: 500, body });
  });

  it('returns url null when the partner has no Tokens RECEIVER', async () => {
    const result = await lookup(makeApi(), profile({ endpoints: [] }));

    expect(result).toMatchObject({ url: null, ok: false, httpStatus: null });
  });

  it('never returns or logs credentials when our partner token is missing (SEC-S001)', async () => {
    const api = makeApi();

    const result = await lookup(api, profile({ credentials: { token: '' } }));

    expect(result).toMatchObject({
      ok: false,
      httpStatus: null,
      body: null,
      error: 'Request to partner failed, see OCPI logs',
    });
    expect(JSON.stringify(result)).not.toContain(SERVER_SECRET);
    expect(api.logger.error).toHaveBeenCalled();
    const logged = api.logger.error.mock.calls
      .map((args: unknown[]) =>
        args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '),
      )
      .join('\n');
    expect(logged).not.toContain(SERVER_SECRET);
  });
});
