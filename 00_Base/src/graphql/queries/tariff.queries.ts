// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { gql } from 'graphql-request';

export const GET_TARIFF_BY_KEY_QUERY = gql`
  query GetTariffByKey($id: Int!, $countryCode: String!, $partyId: String!) {
    Tariffs(
      where: {
        id: { _eq: $id }
        Tenant: {
          countryCode: { _eq: $countryCode }
          partyId: { _eq: $partyId }
        }
      }
    ) {
      authorizationAmount
      createdAt
      currency
      id
      ocpiTariffId
      paymentFee
      pricePerKwh
      pricePerMin
      pricePerSession
      stationId
      taxRate
      tariffAltText
      tenantPartnerId
      updatedAt
      tenant: Tenant {
        countryCode
        partyId
      }
    }
  }
`;

export const GET_TARIFFS_QUERY = gql`
  query GetTariffs($limit: Int, $offset: Int, $where: Tariffs_bool_exp!) {
    Tariffs(
      limit: $limit
      offset: $offset
      order_by: { createdAt: asc }
      where: $where
    ) {
      authorizationAmount
      createdAt
      currency
      id
      ocpiTariffId
      paymentFee
      pricePerKwh
      pricePerMin
      pricePerSession
      stationId
      taxRate
      tariffAltText
      tenantPartnerId
      updatedAt
      tenant: Tenant {
        countryCode
        partyId
      }
    }
  }
`;

export const CREATE_OR_UPDATE_TARIFF_MUTATION = gql`
  mutation CreateOrUpdateTariff($object: Tariffs_insert_input!) {
    insert_Tariffs_one(
      object: $object
      on_conflict: {
        constraint: Tariffs_pkey
        update_columns: [
          authorizationAmount
          createdAt
          currency
          ocpiTariffId
          paymentFee
          pricePerKwh
          pricePerMin
          pricePerSession
          stationId
          tariffAltText
          tariffType
          tariffType
          tariffAltUrl
          minPrice
          maxPrice
          energyMix
          startDateTime
          endDateTime
          taxRate
          tenantPartnerId
          updatedAt
        ]
      }
    ) {
      id
      ocpiTariffId
      authorizationAmount
      createdAt
      currency
      paymentFee
      pricePerKwh
      pricePerMin
      pricePerSession
      stationId
      taxRate
      tariffAltText
      tenantPartnerId
      updatedAt
      tariffType
      tariffAltUrl
      minPrice
      maxPrice
      energyMix
      startDateTime
      endDateTime
      tenant: Tenant {
        countryCode
        partyId
      }
      tenantPartner: TenantPartner {
        id
        countryCode
        partyId
      }
    }
  }
`;

/** Upsert for tariffs received from a partner CPO. Conflicts on (ocpiTariffId, tenantPartnerId). */
export const CREATE_OR_UPDATE_PARTNER_TARIFF_MUTATION = gql`
  mutation CreateOrUpdatePartnerTariff($object: Tariffs_insert_input!) {
    insert_Tariffs_one(
      object: $object
      on_conflict: {
        constraint: Tariffs_ocpiTariffId_tenantPartnerId_key
        update_columns: [
          currency
          ocpiTariffId
          paymentFee
          pricePerKwh
          pricePerMin
          pricePerSession
          stationId
          tariffAltText
          tariffType
          tariffAltUrl
          minPrice
          maxPrice
          energyMix
          startDateTime
          endDateTime
          taxRate
          updatedAt
        ]
      }
    ) {
      id
      ocpiTariffId
      authorizationAmount
      createdAt
      currency
      paymentFee
      pricePerKwh
      pricePerMin
      pricePerSession
      stationId
      taxRate
      tariffAltText
      tariffType
      tariffAltUrl
      minPrice
      maxPrice
      energyMix
      startDateTime
      endDateTime
      tenantPartnerId
      updatedAt
      tenant: Tenant {
        countryCode
        partyId
      }
      TariffElements {
        id
        priceComponents
        restrictions
      }
      tenantPartner: TenantPartner {
        id
        countryCode
        partyId
      }
    }
  }
`;

export const DELETE_TARIFF_MUTATION = gql`
  mutation DeleteTariff($id: Int!) {
    delete_Tariffs_by_pk(id: $id) {
      id
    }
  }
`;

/** Delete a partner tariff by its OCPI tariff ID and tenantPartnerId. */
export const DELETE_TARIFF_BY_PARTNER_MUTATION = gql`
  mutation DeleteTariffByPartner(
    $ocpiTariffId: String!
    $tenantPartnerId: Int!
  ) {
    delete_Tariffs(
      where: {
        ocpiTariffId: { _eq: $ocpiTariffId }
        tenantPartnerId: { _eq: $tenantPartnerId }
      }
    ) {
      affected_rows
    }
  }
`;

export const GET_TARIFF_BY_OCPI_ID_QUERY = gql`
  query GetTariffByOcpiId(
    $ocpiTariffId: String!
    $countryCode: String!
    $partyId: String!
  ) {
    Tariffs(
      where: {
        ocpiTariffId: { _eq: $ocpiTariffId }
        Tenant: {
          countryCode: { _eq: $countryCode }
          partyId: { _eq: $partyId }
        }
      }
    ) {
      authorizationAmount
      createdAt
      currency
      id
      ocpiTariffId
      paymentFee
      pricePerKwh
      pricePerMin
      pricePerSession
      stationId
      taxRate
      tariffAltText
      tariffType
      tariffAltUrl
      minPrice
      maxPrice
      energyMix
      startDateTime
      endDateTime
      tenantPartnerId
      updatedAt
      tenant: Tenant {
        countryCode
        partyId
      }
      tenantPartner: TenantPartner {
        id
        countryCode
        partyId
      }
      TariffElements {
        id
        priceComponents
        restrictions
      }
    }
  }
`;

/** Filter by tenantPartnerId so we do not rely on Tariffs_bool_exp.TenantPartner (not always exposed). */
export const GET_TARIFF_BY_PARTNER_QUERY = gql`
  query GetTariffByPartner($ocpiTariffId: String!, $tenantPartnerId: Int!) {
    Tariffs(
      where: {
        ocpiTariffId: { _eq: $ocpiTariffId }
        tenantPartnerId: { _eq: $tenantPartnerId }
      }
    ) {
      authorizationAmount
      createdAt
      currency
      id
      ocpiTariffId
      paymentFee
      pricePerKwh
      pricePerMin
      pricePerSession
      stationId
      taxRate
      tariffAltText
      tariffType
      tariffAltUrl
      minPrice
      maxPrice
      energyMix
      startDateTime
      endDateTime
      tenantPartnerId
      updatedAt
      tenant: Tenant {
        countryCode
        partyId
      }
      tenantPartner: TenantPartner {
        id
        countryCode
        partyId
      }
      TariffElements {
        id
        priceComponents
        restrictions
      }
    }
  }
`;

export const DELETE_TARIFF_ELEMENTS_MUTATION = gql`
  mutation DeleteTariffElements($tariffId: Int!) {
    delete_TariffElements(where: { tariffId: { _eq: $tariffId } }) {
      affected_rows
    }
  }
`;

export const GET_TARIFF_ID_BY_OCPI_ID_QUERY = gql`
  query GetTariffIdByOcpiId($ocpiTariffId: String!, $tenantPartnerId: Int!) {
    Tariffs(
      where: {
        ocpiTariffId: { _eq: $ocpiTariffId }
        tenantPartnerId: { _eq: $tenantPartnerId }
      }
    ) {
      id
    }
  }
`;
