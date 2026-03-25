import { gql } from 'graphql-request';

export const UPSERT_EVSE_MUTATION = gql`
  mutation UpsertEvse($object: Evses_insert_input!) {
    insert_Evses_one(
      object: $object,
      on_conflict: {
        constraint: evses_ocpi_uid_station_unique,
        update_columns: [
          evseId,
          physicalReference,
          capabilities,
          floorLevel,
          coordinates,
          parkingRestrictions,
          statusSchedule,
          images,
          directions,
          ocpiStatus,
          updatedAt
        ]
      }
    ) {
      id
    }
  }
`;

export const GET_EVSE_OWNERSHIP_BY_ID = gql`
  query GetEvseOwnershipById($id: Int!) {
    Evses_by_pk(id: $id) {
      id
      ocpiUid
      stationId
      chargingStation: ChargingStation {
        location: Location {
          ownerTenantPartnerId
        }
      }
    }
  }
`;

export const GET_PARTNER_EVSE_BY_OCPI_ID = gql`
query GetPartnerEvseByOcpiIds(
  $partnerId: Int!,
  $locationId: String!,
  $evseUid: String!
) {
  Locations(where: {
    ocpiId: { _eq: $locationId }
    ownerTenantPartnerId: { _eq: $partnerId }
  }) {
    id
    chargingPool: ChargingStations {
      evses: Evses(where: { ocpiUid: { _eq: $evseUid } }) {
        id
      }
    }
  }
}
`;

export const UPDATE_EVSE_PATCH_MUTATION = gql`
  mutation UpdateEvsePatch($id: Int!, $changes: Evses_set_input!) {
    update_Evses_by_pk(pk_columns: { id: $id }, _set: $changes) {
      id
      updatedAt
    }
  }
`;


export const GET_EVSE_BY_OCPI_ID_AND_PARTNER_ID_QUERY = gql`
query GetEvseByOcpiIdAndPartnerId($partnerId: Int!, $locationId: String!, $evseUid: String!) {
  Evses(where: { 
    ocpiUid: { _eq: $evseUid },
    ChargingStation: { 
      Location: { 
        ocpiId: { _eq: $locationId },
        ownerTenantPartnerId: { _eq: $partnerId }
      }
    }
  }) {
    id
    stationId
    evseTypeId
    evseId
    ocpiUid
    ocpiStatus
    coordinates
    parkingRestrictions
    statusSchedule
    floorLevel
    capabilities
    images
    directions
    physicalReference
    removed
    createdAt
    updatedAt
    ChargingStation {
      id
      location: Location {
        id
        ocpiId
        ownerTenantPartnerId
        updatedAt
      }
    }
    connectors: Connectors {
      id
      ocpiId
      stationId
      connectorId
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
      createdAt
      updatedAt
    }
  }
}
`;
