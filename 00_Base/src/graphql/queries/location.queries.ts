// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { gql } from 'graphql-request';

export const GET_LOCATIONS_QUERY = gql`
  query GetLocations($limit: Int, $offset: Int, $where: Locations_bool_exp!) {
    Locations(
      offset: $offset
      limit: $limit
      order_by: { createdAt: asc }
      where: $where
    ) {
      id
      name
      address
      city
      coordinates
      country
      createdAt
      facilities
      openingHours
      parkingType
      postalCode
      publishUpstream
      state
      timeZone
      updatedAt
      tenant: Tenant {
        partyId
        countryCode
      }
      chargingPool: ChargingStations {
        id
        isOnline
        protocol
        capabilities
        chargePointVendor
        chargePointModel
        chargePointSerialNumber
        chargeBoxSerialNumber
        coordinates
        firmwareVersion
        floorLevel
        iccid
        imsi
        meterType
        meterSerialNumber
        parkingRestrictions
        locationId
        createdAt
        updatedAt
        evses: Evses {
          id
          stationId
          evseTypeId
          evseId
          physicalReference
          removed
          createdAt
          updatedAt
          connectors: Connectors {
            id
            stationId
            evseId
            connectorId
            evseTypeConnectorId
            format
            maximumAmperage
            maximumPowerWatts
            maximumVoltage
            powerType
            termsAndConditionsUrl
            type
            status
            errorCode
            timestamp
            info
            vendorId
            vendorErrorCode
            createdAt
            updatedAt
          }
        }
      }
    }
  }
`;

export const GET_LOCATION_BY_ID_QUERY = gql`
  query GetLocationById($id: String!) {
    Locations(where: { ocpiId: { _eq: $id } }) {
      id
      name
      address
      city
      coordinates
      country
      createdAt
      facilities
      openingHours
      parkingType
      postalCode
      publishUpstream
      state
      timeZone
      updatedAt
      tenant: Tenant {
        partyId
        countryCode
      }
      chargingPool: ChargingStations {
        id
        isOnline
        protocol
        capabilities
        chargePointVendor
        chargePointModel
        chargePointSerialNumber
        chargeBoxSerialNumber
        coordinates
        firmwareVersion
        floorLevel
        iccid
        imsi
        meterType
        meterSerialNumber
        parkingRestrictions
        locationId
        createdAt
        updatedAt
        evses: Evses {
          id
          stationId
          evseTypeId
          evseId
          physicalReference
          removed
          createdAt
          updatedAt
          connectors: Connectors {
            id
            stationId
            evseId
            connectorId
            evseTypeConnectorId
            format
            maximumAmperage
            maximumPowerWatts
            maximumVoltage
            powerType
            termsAndConditionsUrl
            type
            status
            errorCode
            timestamp
            info
            vendorId
            vendorErrorCode
            createdAt
            updatedAt
          }
        }
      }
    }
  }
`;

export const GET_EVSE_BY_ID_QUERY = gql`
  query GetEvseById($locationId: String!, $stationId: String!, $evseId: String!) {
    Locations(where: { ocpiId: { _eq: $locationId } }) {
      chargingPool: ChargingStations(where: { id: { _eq: $stationId } }) {
        id
        isOnline
        protocol
        capabilities
        chargePointVendor
        chargePointModel
        chargePointSerialNumber
        chargeBoxSerialNumber
        coordinates
        firmwareVersion
        floorLevel
        iccid
        imsi
        meterType
        meterSerialNumber
        parkingRestrictions
        locationId
        createdAt
        updatedAt
        evses: Evses(where: { id: { _eq: $evseId } }) {
          id
          stationId
          evseTypeId
          evseId
          physicalReference
          removed
          createdAt
          updatedAt
        }
      }
    }
  }
`;

export const GET_CONNECTOR_BY_ID_QUERY = gql`
  query GetConnectorById(
    $locationId: String!
    $stationId: String!
    $evseId: String!
    $connectorId: Int!
  ) {
    Locations(where: { ocpiId: { _eq: $locationId } }) {
      chargingPool: ChargingStations(where: { id: { _eq: $stationId } }) {
        evses: Evses(where: { id: { _eq: $evseId } }) {
          connectors: Connectors(
            where: { connectorId: { _eq: $connectorId } }
          ) {
            id
            stationId
            evseId
            connectorId
            evseTypeConnectorId
            format
            maximumAmperage
            maximumPowerWatts
            maximumVoltage
            powerType
            termsAndConditionsUrl
            type
            status
            errorCode
            timestamp
            info
            vendorId
            vendorErrorCode
            createdAt
            updatedAt
          }
        }
      }
    }
  }
`;

export const GET_LOCATION_BY_COUNTRY_PARTY_AND_ID_QUERY = gql`
  query GetLocationByCountryPartyAndId($countryCode: String!, $partyId: String!, $locationId: String!) {
    Locations(where: { country: { _eq: $countryCode }, tenant: { partyId: { _eq: $partyId } }, id: { _eq: $locationId } }) {
      id
      name
      address
      city
      coordinates
      country
      createdAt
      facilities
      openingHours
      parkingType
      postalCode
      publishUpstream
      state
      timeZone
      updatedAt
      tenant: Tenant {
        partyId
        countryCode
      }
      chargingPool: ChargingStations {
        id
        isOnline
        protocol
        capabilities
      }
    }
  }
`;

export const GET_LOCATION_BY_TENANT_PARTNER_AND_ID_QUERY = gql`
  query GetLocationByTenantPartnerAndId($tenantPartnerId: Int!, $locationId: String!) {
    Locations(where: { tenantPartner: { id: { _eq: $tenantPartnerId } }, id: { _eq: $locationId } }) {
      id
    }
  }
`;

export const GET_LOCATION_BY_ID_QUERY_AND_PARTNER_ID = gql`
  query GetLocationByIdAndPartnerId($id: String!, $partnerId: Int!) {
    Locations(where: { ocpiId: { _eq: $id }, ownerTenantPartnerId: { _eq: $partnerId } }) {
      id
      name
      address
      city
      coordinates
      country
      createdAt
      facilities
      openingHours
      parkingType
      postalCode
      publishUpstream
      state
      timeZone
      updatedAt
      tenant: Tenant {
        partyId
        countryCode
      }
      chargingPool: ChargingStations {
        id
        isOnline
        protocol
        capabilities
        chargePointVendor
        chargePointModel
        chargePointSerialNumber
        chargeBoxSerialNumber
        coordinates
        firmwareVersion
        floorLevel
        iccid
        imsi
        meterType
        meterSerialNumber
        parkingRestrictions
        locationId
        createdAt
        updatedAt
        evses: Evses {
          id
          stationId
          evseTypeId
          evseId
          physicalReference
          removed
          createdAt
          updatedAt
          connectors: Connectors {
            id
            stationId
            evseId
            connectorId
            evseTypeConnectorId
            format
            maximumAmperage
            maximumPowerWatts
            maximumVoltage
            powerType
            termsAndConditionsUrl
            type
            status
            errorCode
            timestamp
            info
            vendorId
            vendorErrorCode
            createdAt
            updatedAt
          }
        }
      }
    }
  }
`;


export const GET_EVSE_BY_LOCATION_ID_AND_OWNER_PARTNER_ID = gql`
query GetEvseByLocationAndOwnerPartner(
  $partnerId: Int!,
  $locationId: String!,
  $evseId: String!
) {
  Locations(where: {
    ocpiId: { _eq: $locationId },
    ownerTenantPartnerId: { _eq: $partnerId }
  }) {
    chargingPool: ChargingStations {
      id
      evses: Evses(where: { evseId: { _eq: $evseId } }) {
        id
        evseId
      }
    }
  }
}`;


export const UPSERT_LOCATION_MUTATION = gql`
  mutation UpsertLocation($object: Locations_insert_input!) {
  insert_Locations_one(
    object: $object,
    on_conflict: {
      constraint: locations_ocpi_id_partner_unique,
      update_columns: [
        name,
        address,
        city,
        country,
        postalCode,
        state,
        parkingType,
        timeZone,
        coordinates,
        operator,
        suboperator,
        owner,
        chargingWhenClosed,
        relatedLocations,
        updatedAt
      ]
    }
  ) {
    id
  }
}
`;

export const GET_PARTNER_LOCATION_BY_OCPI_ID = gql`
query GetPartnerLocationByOcpiId($partnerId: Int!, $locationId: String!) {
  Locations(where: {
    ocpiId: { _eq: $locationId }
    ownerTenantPartnerId: { _eq: $partnerId }
  }) {
    id
    tenantId
  }
}
`;

export const UPDATE_LOCATION_PATCH_MUTATION = gql`
  mutation UpdateLocationPatch($id: Int!, $changes: Locations_set_input!) {
    update_Locations_by_pk(pk_columns: { id: $id }, _set: $changes) {
      id
      updatedAt
    }
  }
`;