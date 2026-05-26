// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { gql } from 'graphql-request';

// export const CREATE_TENANT = gql`
//   mutation CreateTenant($object: Tenants_insert_input!) {
//     insert_Tenants_one(object: $object) {
//       id
//     }
//   }
// `;

// export const UPDATE_TENANT = gql`
//   mutation UpdateTenant($id: Int!, $input: Tenants_set_input!) {
//     update_Tenants_by_pk(pk_columns: { id: $id }, _set: $input) {
//       id
//     }
//   }
// `;

// export const CREATE_TENANT_PARTNER = gql`
//   mutation CreateTenantPartner($object: TenantPartners_insert_input!) {
//     insert_TenantPartners_one(object: $object) {
//       id
//     }
//   }
// `;

/** Persists OCPI partner profile JSON on OcpiIntegrations (linked from TenantPartners.ocpiIntegrationId). */
export const UPDATE_OCPI_INTEGRATION_PROFILE = gql`
  mutation UpdateOcpiIntegrationProfile($id: Int!, $partnerProfileOCPI: jsonb!) {
    update_OcpiIntegrations_by_pk(
      pk_columns: { id: $id }
      _set: { partnerProfileOCPI: $partnerProfileOCPI }
    ) {
      id
      partnerProfileOCPI
    }
  }
`;

export const INSERT_OCPI_INTEGRATION_ONE = gql`
  mutation InsertOcpiIntegrationOne($partnerProfileOCPI: jsonb!) {
    insert_OcpiIntegrations_one(object: { partnerProfileOCPI: $partnerProfileOCPI }) {
      id
      partnerProfileOCPI
    }
  }
`;

export const LINK_TENANT_PARTNER_OCPI_INTEGRATION = gql`
  mutation LinkTenantPartnerOcpiIntegration(
    $partnerId: Int!
    $ocpiIntegrationId: Int!
  ) {
    update_TenantPartners(
      where: { id: { _eq: $partnerId } }
      _set: { ocpiIntegrationId: $ocpiIntegrationId }
    ) {
      affected_rows
    }
  }
`;

/** @deprecated Profiles live on OcpiIntegrations; use UPDATE_OCPI_INTEGRATION_PROFILE + linkage instead. */
export const UPDATE_TENANT_PARTNER_PROFILE = gql`
  mutation UpdateTenantPartnerProfile($partnerId: Int!, $input: jsonb!) {
    update_TenantPartners(
      where: { id: { _eq: $partnerId } }
      _set: { partnerProfileOCPI: $input }
    ) {
      affected_rows
    }
  }
`;

export const DELETE_TENANT_PARTNER_BY_ID = gql`
  mutation DeleteTenantPartnerById($id: Int!) {
    delete_TenantPartners(where: { id: { _eq: $id } }) {
      affected_rows
    }
  }
`;
