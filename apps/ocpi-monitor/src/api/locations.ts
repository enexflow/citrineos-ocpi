// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { LocationOwnership, OcpiLocationReceived } from '@/types/partner'
import { graphqlRequest } from './graphql.js'

interface AggregateCount {
  aggregate: { count: number } | null
}

function countOf (agg: AggregateCount | undefined): number {
  return agg?.aggregate?.count ?? 0
}

function iso (value: unknown): string | null {
  if (value == null) {
    return null
  }
  try {
    return new Date(value as string).toISOString()
  } catch {
    return String(value)
  }
}

function num (value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const ALL_LOCATIONS_QUERY = `
  query AllLocationsForMap {
    Locations(
      where: { deletedAt: { _is_null: true } }
      order_by: { id: asc }
    ) {
      id
      ocpiId
      name
      address
      city
      country
      coordinates
      updatedAt
      ownerTenantPartnerId
      roamingPartnerId
      ChargingStations_aggregate {
        aggregate {
          count
        }
      }
    }
  }
`

interface AllLocationsQueryResult {
  Locations: Array<{
    id: number
    ocpiId: string
    name: string | null
    address: string
    city: string
    country: string
    coordinates: { type: string, coordinates: [number, number] } | null
    updatedAt: string | null
    ownerTenantPartnerId: number | null
    roamingPartnerId: number | null
    ChargingStations_aggregate: AggregateCount
  }>
}

/**
 * Every location we have in DB, for the map view: our own network plus
 * everything received from a CPO partner (peer-to-peer or via a hub).
 */
export async function fetchAllLocationsForMap (): Promise<
  OcpiLocationReceived[]
> {
  const data
    = await graphqlRequest<AllLocationsQueryResult>(ALL_LOCATIONS_QUERY)

  return data.Locations.map(loc => {
    const ownership: LocationOwnership
      = loc.ownerTenantPartnerId == null && loc.roamingPartnerId == null
        ? 'own'
        : 'partner'

    return {
      id: loc.id,
      ocpiId: loc.ocpiId,
      name: loc.name,
      address: loc.address,
      city: loc.city,
      country: loc.country,
      evseCount: countOf(loc.ChargingStations_aggregate),
      latitude: num(loc.coordinates?.coordinates?.[1]),
      longitude: num(loc.coordinates?.coordinates?.[0]),
      lastUpdated: iso(loc.updatedAt),
      ownership,
    }
  })
}
