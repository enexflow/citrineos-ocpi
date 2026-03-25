// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { gql } from 'graphql-request';

const SESSION_FIELDS = `
  id
  ocpiSessionId
  countryCode
  partyId
  startDateTime
  endDateTime
  kwh
  cdrToken
  authMethod
  authorizationReference
  locationId
  evseUid
  connectorId
  meterId
  currency
  chargingPeriods
  totalCost
  status
  lastUpdated
  tenantId
  tenantPartnerId
  createdAt
  updatedAt
`;

export const GET_SESSION_BY_OCPI_ID = gql`
  query GetSessionByOcpiId(
    $countryCode: String!
    $partyId: String!
    $ocpiSessionId: String!
    $tenantPartnerId: Int!
  ) {
    Sessions(
      where: {
        countryCode: { _eq: $countryCode }
        partyId: { _eq: $partyId }
        ocpiSessionId: { _eq: $ocpiSessionId }
        tenantPartnerId: { _eq: $tenantPartnerId }
      }
    ) {
      ${SESSION_FIELDS}
    }
  }
`;

export const GET_SESSIONS_PAGINATED = gql`
  query GetSessionsPaginated(
    $limit: Int
    $offset: Int
    $where: Sessions_bool_exp!
  ) {
    Sessions(
      limit: $limit
      offset: $offset
      order_by: { lastUpdated: asc }
      where: $where
    ) {
      ${SESSION_FIELDS}
    }
  }
`;

export const UPSERT_SESSION_MUTATION = gql`
  mutation UpsertSession($object: Sessions_insert_input!) {
    insert_Sessions_one(
      object: $object
      on_conflict: {
        constraint: Sessions_countryCode_partyId_ocpiSessionId_tenantPartnerId_key
        update_columns: [
          startDateTime
          endDateTime
          kwh
          cdrToken
          authMethod
          authorizationReference
          locationId
          evseUid
          connectorId
          meterId
          currency
          chargingPeriods
          totalCost
          status
          lastUpdated
          updatedAt
        ]
      }
    ) {
      ${SESSION_FIELDS}
    }
  }
`;

export const UPDATE_SESSION_MUTATION = gql`
  mutation UpdateSession(
    $countryCode: String!
    $partyId: String!
    $ocpiSessionId: String!
    $tenantPartnerId: Int!
    $set: Sessions_set_input!
  ) {
    update_Sessions(
      where: {
        countryCode: { _eq: $countryCode }
        partyId: { _eq: $partyId }
        ocpiSessionId: { _eq: $ocpiSessionId }
        tenantPartnerId: { _eq: $tenantPartnerId }
      }
      _set: $set
    ) {
      returning {
        ${SESSION_FIELDS}
      }
    }
  }
`;
