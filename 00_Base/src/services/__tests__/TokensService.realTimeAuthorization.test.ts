// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// The real helpers pull in the whole server module graph.
jest.mock('../../util/helpers', () => ({
  getRoamingPartner: () => undefined,
}));
jest.mock('../../mapper/index', () => ({
  ...jest.requireActual('../../mapper/TokensMapper'),
  TokensMapper: jest.requireActual('../../mapper/TokensMapper').TokensMapper,
}));

import { TokensService } from '../TokensService';
import { OcpiGraphqlClient } from '../../graphql/OcpiGraphqlClient';
import { OcpiLogger } from '../../util/OcpiLogger';
import { TokensClientApi } from '../../trigger/TokensClientApi';
import { AuthorizationInfoAllowed } from '../../model/AuthorizationInfoAllowed';
import { UnknownTokenException } from '../../exception/UnknownTokenException';
import { InvalidParamException } from '../../exception/InvalidParamException';
import { OcpiResponseStatusCode } from '../../model/OcpiResponse';
import { Role } from '../../model/Role';
import { EndpointIdentifier } from '../../model/EndpointIdentifier';
import {
  GET_REAL_TIME_TOKEN_AUTH_TENANT_PARTNERS,
  GET_TENANT_PARTNER_BY_ID,
} from '../../graphql/queries/tenantPartner.queries';
import { GET_AUTHORIZATION_OWNER } from '../../graphql/queries/token.queries';

jest.mock('../../graphql/OcpiGraphqlClient');

const tokensSenderEndpoint = {
  identifier: EndpointIdentifier.TOKENS_SENDER,
  url: 'https://partner/tokens',
};

function aPartner(
  id: number,
  partyId: string,
  roles: Role[],
  endpoints = [tokensSenderEndpoint],
) {
  return {
    id,
    countryCode: 'FR',
    partyId,
    partnerProfileOCPI: { roles: roles.map((role) => ({ role })), endpoints },
    awsSecretCertificateArn: null,
    tenantId: 1,
    tenant: {
      id: 1,
      countryCode: 'FR',
      partyId: 'ZTA',
      serverProfileOCPI: null,
    },
    roamingPartners: [],
  };
}

function anAnswer(allowed: AuthorizationInfoAllowed) {
  return {
    status_code: OcpiResponseStatusCode.GenericSuccessCode,
    timestamp: new Date('2026-10-06T10:00:00Z'),
    data: {
      allowed,
      authorization_reference: `ref-${allowed}`,
      token: {
        uid: 'BADGE1',
        country_code: 'FR',
        party_id: 'XYZ',
        type: 'RFID',
      },
    },
  };
}

const hub = aPartner(1, '007', [Role.HUB]);
const emsp = aPartner(2, 'ALP', [Role.EMSP]);
const cpoOnly = aPartner(3, 'CPO', [Role.CPO]);
const withoutTokensSender = aPartner(4, 'NOT', [Role.EMSP], []);

const request = {
  tenantId: 1,
  idToken: 'BADGE1',
  idTokenType: 'ISO14443',
  stationId: 'cp001',
} as const;

describe('TokensService.realTimeAuthorization', () => {
  let service: TokensService;
  let mockGraphqlClient: jest.Mocked<OcpiGraphqlClient>;
  let mockTokensClientApi: jest.Mocked<TokensClientApi>;
  let persistRoamingAuthorization: jest.SpyInstance;
  let answersByPartyId: Record<string, () => Promise<unknown>>;
  let cachedOwners: { tenantPartnerId: number }[];

  beforeEach(() => {
    answersByPartyId = {};
    cachedOwners = [];
    mockGraphqlClient = {
      request: jest.fn().mockImplementation(async (query) => {
        if (query === GET_REAL_TIME_TOKEN_AUTH_TENANT_PARTNERS) {
          return { TenantPartners: [hub, emsp, cpoOnly, withoutTokensSender] };
        }
        if (query === GET_TENANT_PARTNER_BY_ID) {
          return { TenantPartners_by_pk: hub };
        }
        if (query === GET_AUTHORIZATION_OWNER) {
          return { Authorizations: cachedOwners };
        }
        throw new Error('unexpected query');
      }),
    } as any;
    mockTokensClientApi = {
      postToken: jest
        .fn()
        .mockImplementation((_fromCc, _fromPid, _toCc, toPartyId: string) =>
          answersByPartyId[toPartyId](),
        ),
    } as any;
    const mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    };
    service = new TokensService(
      mockLogger as any,
      mockGraphqlClient,
      mockTokensClientApi,
    );
    persistRoamingAuthorization = jest
      .spyOn(service, 'persistRoamingAuthorization')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps asking only the given partner when tenantPartnerId is set', async () => {
    answersByPartyId['007'] = async () =>
      anAnswer(AuthorizationInfoAllowed.Allowed);

    const response = await service.realTimeAuthorization({
      ...request,
      tenantPartnerId: 1,
    } as any);

    expect(response.data.allowed).toBe(AuthorizationInfoAllowed.Allowed);
    expect(mockTokensClientApi.postToken).toHaveBeenCalledTimes(1);
    expect(persistRoamingAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'BADGE1' }),
      1,
      1,
      undefined,
      expect.objectContaining({ ocpiAuthReference: 'ref-ALLOWED' }),
    );
  });

  it('asks eligible partners and prefers the direct eMSP', async () => {
    answersByPartyId['007'] = async () =>
      anAnswer(AuthorizationInfoAllowed.Allowed);
    answersByPartyId['ALP'] = async () =>
      anAnswer(AuthorizationInfoAllowed.Allowed);

    const response = await service.realTimeAuthorization(request as any);

    expect(response.data.allowed).toBe(AuthorizationInfoAllowed.Allowed);
    expect(
      mockTokensClientApi.postToken.mock.calls.map((call) => call[3]),
    ).toEqual(['007', 'ALP']);
    expect(persistRoamingAuthorization).toHaveBeenCalledTimes(1);
    expect(persistRoamingAuthorization.mock.calls[0][2]).toBe(emsp.id);
  });

  it('does not cache a token already owned by another partner', async () => {
    cachedOwners = [{ tenantPartnerId: hub.id }];
    answersByPartyId['007'] = async () =>
      anAnswer(AuthorizationInfoAllowed.NotAllowed);
    answersByPartyId['ALP'] = async () =>
      anAnswer(AuthorizationInfoAllowed.Allowed);

    const response = await service.realTimeAuthorization(request as any);

    expect(response.data.allowed).toBe(AuthorizationInfoAllowed.Allowed);
    expect(persistRoamingAuthorization).not.toHaveBeenCalled();
  });

  it('refreshes a token cached under the same partner', async () => {
    cachedOwners = [{ tenantPartnerId: emsp.id }];
    answersByPartyId['007'] = async () =>
      anAnswer(AuthorizationInfoAllowed.NotAllowed);
    answersByPartyId['ALP'] = async () =>
      anAnswer(AuthorizationInfoAllowed.Allowed);

    await service.realTimeAuthorization(request as any);

    expect(persistRoamingAuthorization.mock.calls[0][2]).toBe(emsp.id);
  });

  it('accepts when only one partner allows the token', async () => {
    answersByPartyId['007'] = async () =>
      anAnswer(AuthorizationInfoAllowed.NotAllowed);
    answersByPartyId['ALP'] = async () =>
      anAnswer(AuthorizationInfoAllowed.Allowed);

    const response = await service.realTimeAuthorization(request as any);

    expect(response.data.allowed).toBe(AuthorizationInfoAllowed.Allowed);
    expect(persistRoamingAuthorization.mock.calls[0][2]).toBe(emsp.id);
  });

  it('returns the most specific rejection when nobody allows the token', async () => {
    answersByPartyId['007'] = async () =>
      anAnswer(AuthorizationInfoAllowed.NotAllowed);
    answersByPartyId['ALP'] = async () =>
      anAnswer(AuthorizationInfoAllowed.Blocked);

    const response = await service.realTimeAuthorization(request as any);

    expect(response.data.allowed).toBe(AuthorizationInfoAllowed.Blocked);
  });

  it('ignores a failing partner', async () => {
    answersByPartyId['007'] = async () =>
      anAnswer(AuthorizationInfoAllowed.Allowed);
    answersByPartyId['ALP'] = async () => {
      throw new Error('connection refused');
    };

    const response = await service.realTimeAuthorization(request as any);

    expect(response.data.allowed).toBe(AuthorizationInfoAllowed.Allowed);
    expect(persistRoamingAuthorization.mock.calls[0][2]).toBe(hub.id);
  });

  it('does not wait for a partner that never answers', async () => {
    jest.useFakeTimers();
    answersByPartyId['007'] = async () =>
      anAnswer(AuthorizationInfoAllowed.NotAllowed);
    answersByPartyId['ALP'] = () => new Promise(() => undefined);

    const pending = service.realTimeAuthorization(request as any);
    await jest.advanceTimersByTimeAsync(10_000);

    expect((await pending).data.allowed).toBe(
      AuthorizationInfoAllowed.NotAllowed,
    );
  });

  it('fails when every partner fails', async () => {
    answersByPartyId['007'] = async () => {
      throw new Error('boom');
    };
    answersByPartyId['ALP'] = async () => ({
      ...anAnswer(AuthorizationInfoAllowed.Allowed),
      status_code: 2001,
    });

    await expect(service.realTimeAuthorization(request as any)).rejects.toThrow(
      InvalidParamException,
    );
    expect(persistRoamingAuthorization).not.toHaveBeenCalled();
  });

  it('fails when the tenant has no real-time partner', async () => {
    mockGraphqlClient.request.mockResolvedValue({ TenantPartners: [cpoOnly] });

    await expect(service.realTimeAuthorization(request as any)).rejects.toThrow(
      UnknownTokenException,
    );
    expect(mockTokensClientApi.postToken).not.toHaveBeenCalled();
  });

  it('needs a tenantPartnerId or a tenantId', async () => {
    const { tenantId: _tenantId, ...withoutTenant } = request;

    await expect(
      service.realTimeAuthorization(withoutTenant as any),
    ).rejects.toThrow(InvalidParamException);
  });
});
