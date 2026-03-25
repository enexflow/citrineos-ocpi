// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { Service } from 'typedi';
import type { Session } from '../model/Session.js';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../model/PaginatedResponse.js';
import type {
  GetSessionByOcpiIdQueryResult,
  GetSessionByOcpiIdQueryVariables,
  GetSessionsPaginatedQueryResult,
  GetSessionsPaginatedQueryVariables,
  GetTransactionsQueryResult,
  GetTransactionsQueryVariables,
  Sessions_Bool_Exp,
  Transactions_Bool_Exp,
  UpdateSessionMutationResult,
  UpdateSessionMutationVariables,
  UpsertSessionMutationResult,
  UpsertSessionMutationVariables,
} from '../graphql/index.js';
import {
  GET_SESSION_BY_OCPI_ID,
  GET_SESSIONS_PAGINATED,
  GET_TRANSACTIONS_QUERY,
  OcpiGraphqlClient,
  UPDATE_SESSION_MUTATION,
  UPSERT_SESSION_MUTATION,
} from '../graphql/index.js';
import { ReceivedSessionMapper, SessionMapper } from '../mapper/index.js';
import type { TransactionDto } from '@citrineos/base';
import type { OcpiHeaders } from '../model/OcpiHeaders.js';
import type { PaginatedParams } from '../controllers/param/PaginatedParams.js';
import { NotFoundException } from '../exception/NotFoundException.js';

@Service()
export class SessionsService {
  constructor(
    private readonly ocpiGraphqlClient: OcpiGraphqlClient,
    private readonly sessionMapper: SessionMapper,
  ) {}

  /**
   * Sender GET: returns sessions from our own Transactions, filtered by
   * the requesting eMSP partner (from-headers) and our CPO tenant (to-headers).
   */
  public async getSessions(
    ocpiHeaders: OcpiHeaders,
    paginatedParams?: PaginatedParams,
  ): Promise<{ data: Session[]; count: number }> {
    const limit = paginatedParams?.limit ?? DEFAULT_LIMIT;
    const offset = paginatedParams?.offset ?? DEFAULT_OFFSET;

    const where: Transactions_Bool_Exp = {
      Tenant: {
        countryCode: { _eq: ocpiHeaders.toCountryCode },
        partyId: { _eq: ocpiHeaders.toPartyId },
      },
      Authorization: {
        TenantPartner: {
          countryCode: { _eq: ocpiHeaders.fromCountryCode },
          partyId: { _eq: ocpiHeaders.fromPartyId },
        },
      },
    };

    const dateFilters: any = {};
    if (paginatedParams?.dateFrom)
      dateFilters._gte = paginatedParams.dateFrom.toISOString();
    if (paginatedParams?.dateTo)
      dateFilters._lte = paginatedParams.dateTo.toISOString();
    if (Object.keys(dateFilters).length > 0) {
      where.updatedAt = dateFilters;
    }

    const result = await this.ocpiGraphqlClient.request<
      GetTransactionsQueryResult,
      GetTransactionsQueryVariables
    >(GET_TRANSACTIONS_QUERY, { offset, limit, where });

    const mappedSessions = await this.sessionMapper.mapTransactionsToSessions(
      result.Transactions as TransactionDto[],
    );

    return {
      data: mappedSessions,
      count: mappedSessions.length,
    };
  }

  /**
   * Receiver GET: retrieve a session received from a partner CPO.
   */
  public async getSessionByOcpiId(
    countryCode: string,
    partyId: string,
    sessionId: string,
    tenantPartnerId: number,
  ): Promise<Session | undefined> {
    const result = await this.ocpiGraphqlClient.request<
      GetSessionByOcpiIdQueryResult,
      GetSessionByOcpiIdQueryVariables
    >(GET_SESSION_BY_OCPI_ID, {
      countryCode,
      partyId,
      ocpiSessionId: sessionId,
      tenantPartnerId,
    });

    const row = result.Sessions?.[0];
    if (!row) return undefined;
    return ReceivedSessionMapper.mapToOcpi(row);
  }

  /**
   * Receiver GET: paginated list of received sessions for a given partner.
   */
  public async getReceivedSessionsPaginated(
    tenantPartnerId: number,
    paginatedParams?: PaginatedParams,
  ): Promise<{ data: Session[]; count: number }> {
    const limit = paginatedParams?.limit ?? DEFAULT_LIMIT;
    const offset = paginatedParams?.offset ?? DEFAULT_OFFSET;

    const where: Sessions_Bool_Exp = {
      tenantPartnerId: { _eq: tenantPartnerId },
    };

    const dateFilters: any = {};
    if (paginatedParams?.dateFrom)
      dateFilters._gte = paginatedParams.dateFrom.toISOString();
    if (paginatedParams?.dateTo)
      dateFilters._lte = paginatedParams.dateTo.toISOString();
    if (Object.keys(dateFilters).length > 0) {
      where.updatedAt = dateFilters;
    }

    const result = await this.ocpiGraphqlClient.request<
      GetSessionsPaginatedQueryResult,
      GetSessionsPaginatedQueryVariables
    >(GET_SESSIONS_PAGINATED, { limit, offset, where });

    const mapped = result.Sessions.map((row) =>
      ReceivedSessionMapper.mapToOcpi(row),
    );
    return { data: mapped, count: mapped.length };
  }

  /**
   * Receiver PUT: create or update a session received from a partner CPO.
   */
  public async upsertSession(
    session: Session,
    tenantId: number,
    tenantPartnerId: number,
  ): Promise<Session> {
    const object = ReceivedSessionMapper.mapFromOcpi(
      session,
      tenantId,
      tenantPartnerId,
    );
    const result = await this.ocpiGraphqlClient.request<
      UpsertSessionMutationResult,
      UpsertSessionMutationVariables
    >(UPSERT_SESSION_MUTATION, { object });

    if (!result.insert_Sessions_one) {
      throw new Error(
        `Failed to upsert session ${session.id} for ${session.country_code}/${session.party_id}`,
      );
    }
    return ReceivedSessionMapper.mapToOcpi(result.insert_Sessions_one);
  }

  /**
   * Receiver PATCH: partially update a received session.
   */
  public async patchSession(
    countryCode: string,
    partyId: string,
    sessionId: string,
    tenantPartnerId: number,
    partial: Partial<Session>,
  ): Promise<Session> {
    const set = ReceivedSessionMapper.mapPartialFromOcpi(partial);
    const result = await this.ocpiGraphqlClient.request<
      UpdateSessionMutationResult,
      UpdateSessionMutationVariables
    >(UPDATE_SESSION_MUTATION, {
      countryCode,
      partyId,
      ocpiSessionId: sessionId,
      tenantPartnerId,
      set,
    });

    const updated = result.update_Sessions?.returning?.[0];
    if (!updated) {
      throw new NotFoundException(
        `Session ${sessionId} not found for ${countryCode}/${partyId}`,
      );
    }
    return ReceivedSessionMapper.mapToOcpi(updated);
  }
}
