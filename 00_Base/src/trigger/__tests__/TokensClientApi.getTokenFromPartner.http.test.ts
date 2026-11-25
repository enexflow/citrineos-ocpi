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
import { TokenType } from '../../model/TokenType.js';

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

const lookup = (api: any, partnerProfile: any, tokenType?: TokenType) =>
  api.getTokenFromPartner(
    'FR',
    'ZTA',
    'FR',
    'CPO',
    partnerProfile,
    'FR',
    'ZTA',
    'UID-1',
    tokenType,
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

  it('sends ?type=, the partner token and the OCPI routing headers', async () => {
    const scope = nock(HOST)
      .get(TOKEN_PATH)
      .query({ type: 'RFID' })
      .matchHeader(
        'Authorization',
        `Token ${Buffer.from('partner-token').toString('base64')}`,
      )
      .matchHeader('OCPI-from-country-code', 'FR')
      .matchHeader('OCPI-from-party-id', 'ZTA')
      .matchHeader('OCPI-to-country-code', 'FR')
      .matchHeader('OCPI-to-party-id', 'CPO')
      .reply(200, { status_code: 1000 });

    const result = await lookup(makeApi(), profile(), TokenType.RFID);

    expect(scope.isDone()).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('sends no query string without a type', async () => {
    const scope = nock(HOST)
      .get(TOKEN_PATH)
      .query((query) => Object.keys(query).length === 0)
      .reply(200, { status_code: 1000 });

    await lookup(makeApi(), profile());

    expect(scope.isDone()).toBe(true);
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
