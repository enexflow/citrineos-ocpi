// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { OcpiLocationReceived } from '@/types/partner'
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

const OUR_LOCATIONS_QUERY = `
  query OurLocations {
    Locations(
      where: {
        ownerTenantPartnerId: { _is_null: true }
        roamingPartnerId: { _is_null: true }
        deletedAt: { _is_null: true }
        _or: [{ disableOCPI: { _is_null: true } }, { disableOCPI: { _eq: false } }]
      }
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
      ChargingStations_aggregate {
        aggregate {
          count
        }
      }
    }
  }
`

interface OurLocationsQueryResult {
  Locations: Array<{
    id: number
    ocpiId: string
    name: string | null
    address: string
    city: string
    country: string
    coordinates: { type: string, coordinates: [number, number] } | null
    updatedAt: string | null
    ChargingStations_aggregate: AggregateCount
  }>
}

/**
 * Our data view: locations we operate ourselves (not received from a CPO
 * partner, not roaming) and exposed over OCPI (disableOCPI is null/false) —
 * mirrors the LocationsService.getLocations sender-GET filter.
 */
export async function fetchOurLocations (): Promise<OcpiLocationReceived[]> {
  const data = await graphqlRequest<OurLocationsQueryResult>(OUR_LOCATIONS_QUERY)

  return data.Locations.map(loc => ({
    id: loc.id,
    ocpiId: loc.ocpiId,
    name: loc.name,
    address: loc.address,
    city: loc.city,
    country: loc.country,
    evseCount: countOf(loc.ChargingStations_aggregate),
    // GeoJSON Point: coordinates = [longitude, latitude]
    latitude: num(loc.coordinates?.coordinates?.[1]),
    longitude: num(loc.coordinates?.coordinates?.[0]),
    lastUpdated: iso(loc.updatedAt),
  }))
}
