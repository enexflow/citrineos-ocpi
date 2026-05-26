// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { gql } from 'graphql-request';

import { TENANT_PARTNER_OCPI_GRAPHQL_RELATION } from './tenantPartner.queries.js';

export const GET_TRANSACTIONS_QUERY = gql`
  query GetTransactions(
    $offset: Int
    $limit: Int
    $where: Transactions_bool_exp!
  ) {
    Transactions(
      offset: $offset
      limit: $limit
      order_by: { createdAt: asc }
      where: $where
    ) {
      id
      stationId
      transactionId
      isActive
      chargingState
      timeSpentCharging
      totalKwh
      stoppedReason
      remoteStartId
      totalCost
      startTime
      endTime
      createdAt
      updatedAt
      evseId
      connectorId
      locationId
      authorizationId
      tariffId
      transactionEvents: TransactionEvents {
        id
        eventType
        EvseType {
          id
        }
        transactionInfo
      }
      startTransaction: StartTransaction {
        timestamp
      }
      stopTransaction: StopTransaction {
        timestamp
      }
      meterValues: MeterValues {
        timestamp
        sampledValue
      }
    }
  }
`;

export function GET_TRANSACTION_BY_TRANSACTION_ID_QUERY(): string {
  return `
  query GetTransactionByTransactionId($transactionId: String!) {
    Transactions(where: { transactionId: { _eq: $transactionId } }) {
      tenant: Tenant {
        countryCode
        partyId
      }
      id
      stationId
      transactionId
      isActive
      chargingState
      timeSpentCharging
      totalKwh
      stoppedReason
      remoteStartId
      totalCost
      startTime
      endTime
      createdAt
      updatedAt
      evseId
      connectorId
      locationId
      authorizationId
      tariffId
      authorization: Authorization {
        tenantPartner: TenantPartner {
          id
          countryCode
          partyId
          ocpiIntegrationId
          ${TENANT_PARTNER_OCPI_GRAPHQL_RELATION} {
            id
            partnerProfileOCPI
          }
          tenant: Tenant {
            id
            countryCode
            partyId
          }
        }
      }
      chargingStation: ChargingStation {
        id
      }
      transactionEvents: TransactionEvents {
        id
        eventType
        EvseType {
          id
        }
        transactionInfo
      }
      startTransaction: StartTransaction {
        timestamp
      }
      stopTransaction: StopTransaction {
        timestamp
      }
      meterValues: MeterValues {
        timestamp
        sampledValue
      }
    }
  }
`;
}
