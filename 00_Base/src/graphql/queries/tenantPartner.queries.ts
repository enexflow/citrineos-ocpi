// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Hasura exposes this nested field on `TenantPartners` for `OcpiIntegrations` (FK).
 * Query helpers return strings (`QUERY()`, not gql documents) so this name is interpolated.
 */

import { gql } from 'graphql-request';

export const TENANT_PARTNER_OCPI_GRAPHQL_RELATION = 'OcpiIntegration';

function ocpiNestedSelection(): string {
  return `
      ocpiIntegrationId
      ${TENANT_PARTNER_OCPI_GRAPHQL_RELATION} {
        id
        partnerProfileOCPI
      }`;
}

export function GET_TENANT_PARTNER_BY_SERVER_TOKEN(): string {
  return `
  query GetTenantPartnerByServerToken($serverToken: String!) {
    TenantPartners(
      where: {
        ${TENANT_PARTNER_OCPI_GRAPHQL_RELATION}: {
          partnerProfileOCPI: {
            _contains: { serverCredentials: { token: $serverToken } }
          }
        }
      }
    ) {
      id
      countryCode
      partyId
${ocpiNestedSelection()}
      tenantId
      tenant: Tenant {
        id
        countryCode
        partyId
        serverProfileOCPI
      }
    }
  }
`;
}
/** Resolve a TenantPartner row by OCPI country_code + party_id (e.g. Receiver URL segment). */
export const GET_TENANT_PARTNER_ID_BY_COUNTRY_PARTY = gql`
  query GetTenantPartnerIdByCountryParty(
    $countryCode: String!
    $partyId: String!
  ) {
    TenantPartners(
      where: { countryCode: { _eq: $countryCode }, partyId: { _eq: $partyId } }
      limit: 1
    ) {
      id
    }
  }
`;

export function GET_TENANT_PARTNER_BY_ID(): string {
  return `
  query GetTenantPartnerById($id: Int!) {
    TenantPartners_by_pk(id: $id) {
      id
      countryCode
      partyId
      ocpiIntegrationId
      ${TENANT_PARTNER_OCPI_GRAPHQL_RELATION} {
        id
        partnerProfileOCPI
      }
      tenantId
      tenant: Tenant {
        id
        countryCode
        partyId
        serverProfileOCPI
      }
    }
  }
`;
}

export function DELETE_TENANT_PARTNER_BY_SERVER_TOKEN(): string {
  return `
  mutation DeleteTenantPartnerByServerToken($serverToken: String!) {
    delete_TenantPartners(
      where: {
        ${TENANT_PARTNER_OCPI_GRAPHQL_RELATION}: {
          partnerProfileOCPI: {
            _contains: { serverCredentials: { token: $serverToken } }
          }
        }
      }
    ) {
      affected_rows
    }
  }
`;
}

export function GET_TENANT_PARTNER_BY_CPO_AND_AND_CLIENT(): string {
  return `
  query GetTenantPartnerByCpoClientAndModuleId(
    $cpoCountryCode: String!
    $cpoPartyId: String!
    $clientCountryCode: String
    $clientPartyId: String
  ) {
    TenantPartners(
      where: {
        Tenant: {
          countryCode: { _eq: $cpoCountryCode }
          partyId: { _eq: $cpoPartyId }
        }
        countryCode: { _eq: $clientCountryCode }
        partyId: { _eq: $clientPartyId }
      }
    ) {
      id
      countryCode
      partyId
      ocpiIntegrationId
      ${TENANT_PARTNER_OCPI_GRAPHQL_RELATION} {
        id
        partnerProfileOCPI
      }
      tenantId
      tenant: Tenant {
        id
        countryCode
        partyId
        serverProfileOCPI
      }
    }
  }
`;
}

export function LIST_TENANT_PARTNERS_BY_CPO(): string {
  return `
  query TenantPartnersList(
    $cpoCountryCode: String!
    $cpoPartyId: String!
    $endpointIdentifier: String!
  ) {
    TenantPartners(
      where: {
        Tenant: {
          countryCode: { _eq: $cpoCountryCode }
          partyId: { _eq: $cpoPartyId }
        }
        ${TENANT_PARTNER_OCPI_GRAPHQL_RELATION}: {
          partnerProfileOCPI: {
            _contains: { endpoints: [{ identifier: $endpointIdentifier }] }
          }
        }
      }
    ) {
      id
      countryCode
      partyId
      ocpiIntegrationId
      ${TENANT_PARTNER_OCPI_GRAPHQL_RELATION} {
        id
        partnerProfileOCPI
      }
      tenantId
      tenant: Tenant {
        id
        countryCode
        partyId
        serverProfileOCPI
      }
    }
  }
`;
}
