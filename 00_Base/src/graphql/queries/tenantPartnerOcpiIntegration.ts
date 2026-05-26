// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * TenantPartner OCPI profiles are stored on OcpiIntegrations (partner_profile_ocpi)
 * and linked via TenantPartners.ocpiIntegrationId. GraphQL exposes a nested relation;
 * upstream code expects a flattened partnerProfileOCPI matching TenantPartnerDto.
 *
 * Hasura exposes **`OcpiIntegration`** on TenantPartners for the FK (see {@link TENANT_PARTNER_OCPI_GRAPHQL_RELATION}).
 */

import type { TenantPartnerDto } from '@zetra/citrineos-base';
import type { OcpiGraphqlClient } from '../OcpiGraphqlClient.js';
import {
  INSERT_OCPI_INTEGRATION_ONE,
  LINK_TENANT_PARTNER_OCPI_INTEGRATION,
  UPDATE_OCPI_INTEGRATION_PROFILE,
} from './tenant.mutations.js';
import { TENANT_PARTNER_OCPI_GRAPHQL_RELATION } from './tenantPartner.queries.js';

function pickNestedOcpiIntegration(
  row: Record<string, unknown>,
): { id?: number; partnerProfileOCPI?: unknown } | undefined {
  const node = row[TENANT_PARTNER_OCPI_GRAPHQL_RELATION];
  if (node != null && typeof node === 'object') {
    return node as { id?: number; partnerProfileOCPI?: unknown };
  }
  return undefined;
}

/** TenantPartner with OCPI linkage used when persisting profile JSON. */
export type TenantPartnerWithOcpiIntegrationLink = TenantPartnerDto & {
  ocpiIntegrationId?: number | null;
};

/** Merge OcpiIntegrations.profile onto a TenantPartners GraphQL row. */
export function mergeTenantPartnerOcpiIntegration<
  T extends Record<string, unknown>,
>(
  row: T | null | undefined,
):
  | (T &
      TenantPartnerWithOcpiIntegrationLink & {
        OcpiIntegration?: undefined;
      })
  | undefined {
  if (row == null) return undefined;

  const integ = pickNestedOcpiIntegration(row);
  const merged = { ...(row as object) } as Record<string, unknown>;
  delete merged[TENANT_PARTNER_OCPI_GRAPHQL_RELATION];
  merged.partnerProfileOCPI =
    integ?.partnerProfileOCPI ?? merged.partnerProfileOCPI ?? undefined;
  merged.ocpiIntegrationId =
    (row as { ocpiIntegrationId?: number | null }).ocpiIntegrationId ??
    integ?.id ??
    null;

  return merged as T &
    TenantPartnerWithOcpiIntegrationLink & {
      OcpiIntegration?: undefined;
    };
}

export async function persistTenantPartnerOcpiProfile(
  client: OcpiGraphqlClient,
  tenantPartnerId: number,
  ocpiIntegrationId: number | null | undefined,
  partnerProfileOCPI: object,
): Promise<number> {
  if (ocpiIntegrationId != null && ocpiIntegrationId > 0) {
    await client.request<void, { id: number; partnerProfileOCPI: object }>(
      UPDATE_OCPI_INTEGRATION_PROFILE,
      {
        id: ocpiIntegrationId,
        partnerProfileOCPI,
      },
    );
    return ocpiIntegrationId;
  }

  type InsertRow = {
    insert_OcpiIntegrations_one?: { id: number } | null;
  };
  const inserted = await client.request<
    InsertRow,
    { partnerProfileOCPI: object }
  >(INSERT_OCPI_INTEGRATION_ONE, {
    partnerProfileOCPI,
  });
  const newId = inserted.insert_OcpiIntegrations_one?.id;
  if (newId == null) {
    throw new Error(
      'persistTenantPartnerOcpiProfile: insert_OcpiIntegrations_one returned no id',
    );
  }

  type LinkRows = {
    update_TenantPartners?: { affected_rows?: number };
  };
  const linkResult = await client.request<
    LinkRows,
    { partnerId: number; ocpiIntegrationId: number }
  >(LINK_TENANT_PARTNER_OCPI_INTEGRATION, {
    partnerId: tenantPartnerId,
    ocpiIntegrationId: newId,
  });
  const affected =
    typeof linkResult.update_TenantPartners?.affected_rows === 'number'
      ? linkResult.update_TenantPartners.affected_rows
      : undefined;
  if (affected != null && affected < 1) {
    throw new Error(
      'persistTenantPartnerOcpiProfile: failed to link TenantPartner to OcpiIntegrations row',
    );
  }

  return newId;
}
