// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { gql } from 'graphql-request';

export const GET_CDR_BY_OUR_ID = gql`
  query GetCdrByiId(
    $countryCode: String!
    $partyId: String!
    $id: Int!
    $fromTenantPartnerId: Int!
  ) {
    Cdrs(
      where: {
        countryCode: { _eq: $countryCode }
        partyId: { _eq: $partyId }
        id: { _eq: $id }
        fromTenantPartnerId: { _eq: $fromTenantPartnerId }
      }
    ) {
      id
      ocpiCdrId
      countryCode
      partyId
      startDateTime
      endDateTime
      sessionId
      cdrToken
      authMethod
      authorizationReference
      cdrLocation
      meterId
      currency
      tariffs
      chargingPeriods
      signedData
      totalCost
      totalFixedCost
      totalEnergy
      totalEnergyCost
      totalTime
      totalTimeCost
      totalParkingTime
      totalParkingCost
      totalReservationCost
      remark
      invoiceReferenceId
      credit
      creditReferenceId
      homeChargingCompensation
      lastUpdated
      tenantId
      fromTenantPartnerId
      toTenantPartnerId
      transactionId
      successfullySentAt
      createdAt
      updatedAt
    }
  }
`;

export const GET_CDR_BY_OUR_ID_AND_ROAMING_PARTNER = gql`
  query GetCdrByiIdAndRoamingPartner(
    $countryCode: String!
    $partyId: String!
    $id: Int!
    $fromTenantPartnerId: Int!
    $roamingPartnerId: Int!
  ) {
    Cdrs(
      where: {
        countryCode: { _eq: $countryCode }
        partyId: { _eq: $partyId }
        id: { _eq: $id }
        fromTenantPartnerId: { _eq: $fromTenantPartnerId }
        roamingPartnerId: { _eq: $roamingPartnerId }
      }
    ) {
      id
      ocpiCdrId
      countryCode
      partyId
      startDateTime
      endDateTime
      sessionId
      cdrToken
      authMethod
      authorizationReference
      cdrLocation
      meterId
      currency
      tariffs
      chargingPeriods
      signedData
      totalCost
      totalFixedCost
      totalEnergy
      totalEnergyCost
      totalTime
      totalTimeCost
      totalParkingTime
      totalParkingCost
      totalReservationCost
      remark
      invoiceReferenceId
      credit
      creditReferenceId
      homeChargingCompensation
      lastUpdated
      tenantId
      fromTenantPartnerId
      toTenantPartnerId
      transactionId
      successfullySentAt
      createdAt
      updatedAt
    }
  }
`;

export const GET_CDRS_PAGINATED = gql`
  query GetCdrsPaginated($limit: Int, $offset: Int, $where: Cdrs_bool_exp!) {
    Cdrs(
      limit: $limit
      offset: $offset
      order_by: { lastUpdated: asc }
      where: $where
    ) {
      id
      ocpiCdrId
      countryCode
      partyId
      startDateTime
      endDateTime
      sessionId
      cdrToken
      authMethod
      authorizationReference
      cdrLocation
      meterId
      currency
      tariffs
      chargingPeriods
      signedData
      totalCost
      totalFixedCost
      totalEnergy
      totalEnergyCost
      totalTime
      totalTimeCost
      totalParkingTime
      totalParkingCost
      totalReservationCost
      remark
      invoiceReferenceId
      credit
      creditReferenceId
      homeChargingCompensation
      lastUpdated
      tenantId
      fromTenantPartnerId
      toTenantPartnerId
      transactionId
      successfullySentAt
      createdAt
      updatedAt
    }
  }
`;

export const INSERT_CDR_MUTATION = gql`
  mutation InsertCdr($object: Cdrs_insert_input!) {
    insert_Cdrs_one(object: $object) {
      id
      ocpiCdrId
      countryCode
      partyId
      startDateTime
      endDateTime
      sessionId
      cdrToken
      authMethod
      authorizationReference
      cdrLocation
      meterId
      currency
      tariffs
      chargingPeriods
      signedData
      totalCost
      totalFixedCost
      totalEnergy
      totalEnergyCost
      totalTime
      totalTimeCost
      totalParkingTime
      totalParkingCost
      totalReservationCost
      remark
      invoiceReferenceId
      credit
      creditReferenceId
      homeChargingCompensation
      lastUpdated
      tenantId
      fromTenantPartnerId
      toTenantPartnerId
      transactionId
      successfullySentAt
      createdAt
      updatedAt
      roamingPartnerId
    }
  }
`;

export const FIND_CDR_P2P_QUERY = gql`
  query FindCdrP2p($ocpiCdrId: String!, $fromTenantPartnerId: Int!) {
    Cdrs(
      where: {
        ocpiCdrId: { _eq: $ocpiCdrId }
        fromTenantPartnerId: { _eq: $fromTenantPartnerId }
        roamingPartnerId: { _is_null: true }
      }
      limit: 1
    ) {
      id
    }
  }
`;
export const FIND_CDR_ROAMING_QUERY = gql`
  query FindCdrRoaming(
    $ocpiCdrId: String!
    $fromTenantPartnerId: Int!
    $roamingPartnerId: Int!
  ) {
    Cdrs(
      where: {
        ocpiCdrId: { _eq: $ocpiCdrId }
        fromTenantPartnerId: { _eq: $fromTenantPartnerId }
        roamingPartnerId: { _eq: $roamingPartnerId }
      }
      limit: 1
    ) {
      id
    }
  }
`;

export const FIND_SENT_CDR_QUERY = gql`
  query FindSentCdr($ocpiCdrId: String!, $toTenantPartnerId: Int!) {
    Cdrs(
      where: {
        ocpiCdrId: { _eq: $ocpiCdrId }
        toTenantPartnerId: { _eq: $toTenantPartnerId }
      }
      limit: 1
    ) {
      id
    }
  }
`;

export const UPDATE_CDR_SENT_STATUS_MUTATION = gql`
  mutation UpdateCdrSentStatus($id: Int!, $successfullySentAt: timestamptz) {
    update_Cdrs_by_pk(
      pk_columns: { id: $id }
      _set: { successfullySentAt: $successfullySentAt }
    ) {
      id
    }
  }
`;
