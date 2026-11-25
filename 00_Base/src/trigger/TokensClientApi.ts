// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { BaseClientApi } from './BaseClientApi.js';
import { Service } from 'typedi';
import { ModuleId } from '../model/ModuleId.js';
import {
  type Endpoint,
  HttpMethod,
  type PartnerProfile,
} from '@zetra/citrineos-base';
import { EndpointIdentifier } from '../model/EndpointIdentifier.js';
import type { PaginatedParams } from './param/PaginatedParams.js';
import type { PaginatedTokenResponse } from '../model/DTO/TokenDTO.js';
import { PaginatedTokenResponseSchema } from '../model/DTO/TokenDTO.js';
import { TokenType } from '../model/TokenType.js';
import type { LocationReferences } from '../model/LocationReferences.js';
import type { AuthorizationInfoResponse } from '../model/AuthorizationInfo.js';
import { AuthorizationInfoResponseSchema } from '../model/AuthorizationInfo.js';
import { z } from 'zod';

/** Outcome of a raw GET on a partner's Tokens RECEIVER, for debugging. */
export interface PartnerTokenLookup {
  /** URL called, without credentials (null when no Tokens RECEIVER is known) */
  url: string | null;
  /** true when the partner answered with a 2xx HTTP status */
  ok: boolean;
  /** HTTP status when the partner answered with an error status */
  httpStatus: number | null;
  /** partner's response body, unvalidated */
  body: unknown;
  error: string | null;
}

@Service()
export class TokensClientApi extends BaseClientApi {
  CONTROLLER_PATH = ModuleId.Tokens;

  getUrl(partnerProfile: PartnerProfile): string {
    const url = partnerProfile.endpoints?.find(
      (value: Endpoint) =>
        value.identifier === EndpointIdentifier.TOKENS_RECEIVER,
    )?.url;
    if (!url) {
      throw new Error('No Tokens RECEIVER endpoint available for partner');
    }
    return url;
  }

  getUrlSender(partnerProfile: PartnerProfile): string {
    const url = partnerProfile.endpoints?.find(
      (value: Endpoint) =>
        value.identifier === EndpointIdentifier.TOKENS_SENDER,
    )?.url;
    if (!url) {
      throw new Error('No Tokens SENDER endpoint available for partner');
    }
    return url;
  }

  async getTokens(
    fromCountryCode: string,
    fromPartyId: string,
    toCountryCode: string,
    toPartyId: string,
    partnerProfile: PartnerProfile,
    paginatedParams: PaginatedParams,
  ): Promise<PaginatedTokenResponse> {
    return this.request(
      fromCountryCode,
      fromPartyId,
      toCountryCode,
      toPartyId,
      HttpMethod.Get,
      PaginatedTokenResponseSchema,
      partnerProfile,
      true,
      undefined,
      undefined,
      paginatedParams,
    );
  }

  async postToken(
    fromCountryCode: string,
    fromPartyId: string,
    toCountryCode: string,
    toPartyId: string,
    partnerProfile: PartnerProfile,
    tokenId: string,
    tokenType?: TokenType,
    body?: LocationReferences,
    awsSecretCertificateArn?: string | null,
  ): Promise<AuthorizationInfoResponse> {
    const path = `${tokenId}/authorize`;
    const tokenTypeParam = tokenType ? { type: tokenType } : undefined;

    return this.request(
      fromCountryCode,
      fromPartyId,
      toCountryCode,
      toPartyId,
      HttpMethod.Post,
      AuthorizationInfoResponseSchema,
      partnerProfile,
      true,
      `${this.getUrlSender(partnerProfile)}/${path}`,
      body,
      undefined,
      tokenTypeParam,
      undefined,
      awsSecretCertificateArn ?? undefined,
    );
  }

  /**
   * GET {tokens_RECEIVER}/{country_code}/{party_id}/{uid}[?type=] on the
   * partner (CPO side): what the partner has stored for one of our tokens.
   * Returns the partner's answer as-is, without schema validation, and never
   * throws on partner errors so the caller can show them.
   */
  async getTokenFromPartner(
    fromCountryCode: string,
    fromPartyId: string,
    toCountryCode: string,
    toPartyId: string,
    partnerProfile: PartnerProfile,
    tokenCountryCode: string,
    tokenPartyId: string,
    tokenUid: string,
    tokenType?: TokenType,
    awsSecretCertificateArn?: string | null,
  ): Promise<PartnerTokenLookup> {
    let url: string | null = null;
    try {
      url = `${this.getUrl(partnerProfile)}/${encodeURIComponent(tokenCountryCode)}/${encodeURIComponent(tokenPartyId)}/${encodeURIComponent(tokenUid)}`;
      const body: unknown = await this.request(
        fromCountryCode,
        fromPartyId,
        toCountryCode,
        toPartyId,
        HttpMethod.Get,
        z.unknown(),
        partnerProfile,
        true,
        url,
        undefined,
        undefined,
        tokenType ? { type: tokenType } : undefined,
        undefined,
        awsSecretCertificateArn ?? undefined,
      );
      return { url, ok: true, httpStatus: null, body, error: null };
    } catch (err) {
      // UnsuccessfulRequestException carries iRestResponse; typed-rest-client
      // errors (non-404 >= 300) carry statusCode/result directly.
      const e = err as {
        message?: string;
        statusCode?: number;
        result?: unknown;
        iRestResponse?: { statusCode?: number; result?: unknown };
      };
      return {
        url,
        ok: false,
        httpStatus: e.iRestResponse?.statusCode ?? e.statusCode ?? null,
        body: e.iRestResponse?.result ?? e.result ?? null,
        error: e.message ?? String(err),
      };
    }
  }
}
