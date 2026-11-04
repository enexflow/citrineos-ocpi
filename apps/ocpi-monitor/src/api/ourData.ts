// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type {
  LocationTariff,
  OurLocation,
  TariffElementView,
} from '@/types/partner'
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
      ChargingStations {
        Connectors {
          id
          ConnectorTariffs(
            where: { tenantPartnerId: { _is_null: true } }
            order_by: { id: asc }
          ) {
            tariffId
            tariffOcpiId
            Tariff {
              id
              ocpiTariffId
              currency
              taxRate
              startDateTime
              endDateTime
              TariffElements(order_by: { id: asc }) {
                priceComponents
                restrictions
              }
            }
          }
        }
      }
    }
  }
`

interface ConnectorTariffRow {
  tariffId: number | null
  tariffOcpiId: string | null
  Tariff: {
    id: number
    ocpiTariffId: string | null
    currency: string
    taxRate: number | null
    startDateTime: string | null
    endDateTime: string | null
    TariffElements: Array<{ priceComponents: unknown, restrictions: unknown }>
  } | null
}

/** TariffElements.priceComponents is stored in OCPI wire format (snake_case). */
function parseElements (
  rows: Array<{ priceComponents: unknown, restrictions: unknown }> | undefined,
): TariffElementView[] {
  return (rows ?? []).map(row => ({
    priceComponents: (Array.isArray(row.priceComponents) ? row.priceComponents : [])
      .map((c: Record<string, unknown>) => ({
        type: String(c.type ?? '?'),
        price: num(c.price),
        vat: num(c.vat),
        stepSize: num(c.step_size),
      })),
    restrictions:
      row.restrictions && typeof row.restrictions === 'object'
        ? (row.restrictions as Record<string, unknown>)
        : null,
  }))
}

// Mirrors selectApplicableTariff (01_Data/src/util/selectApplicableTariff.ts)
function isValidAt (
  tariff: ConnectorTariffRow['Tariff'],
  at: Date,
): boolean {
  if (!tariff) {
    return false
  }
  if (tariff.startDateTime && at < new Date(tariff.startDateTime)) {
    return false
  }
  if (tariff.endDateTime && at > new Date(tariff.endDateTime)) {
    return false
  }
  return true
}

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
    ChargingStations: Array<{
      Connectors: Array<{
        id: number
        ConnectorTariffs: ConnectorTariffRow[]
      }>
    }>
  }>
}

function ocpiIdOf (row: ConnectorTariffRow): string {
  return row.tariffOcpiId
    ?? row.Tariff?.ocpiTariffId
    ?? row.tariffId?.toString()
    ?? '?'
}

/**
 * Distinct tariffs across a location's connectors, with how many connectors
 * carry each and on how many it is the one selectApplicableTariff picks now.
 * The OCPI id is resolved the same way ConnectorMapper builds tariff_ids
 * (tariffOcpiId → Tariff.ocpiTariffId → tariffId).
 */
function tariffsOfLocation (
  stations: OurLocationsQueryResult['Locations'][number]['ChargingStations'],
): { tariffs: LocationTariff[], connectorCount: number } {
  const byKey = new Map<string, LocationTariff>()
  const now = new Date()
  let connectorCount = 0

  for (const station of stations) {
    for (const connector of station.Connectors) {
      connectorCount += 1
      const seenOnConnector = new Set<string>()
      for (const row of connector.ConnectorTariffs) {
        const ocpiTariffId = ocpiIdOf(row)
        if (seenOnConnector.has(ocpiTariffId)) {
          continue
        }
        seenOnConnector.add(ocpiTariffId)

        const existing = byKey.get(ocpiTariffId)
        if (existing) {
          existing.connectorCount += 1
          continue
        }
        byKey.set(ocpiTariffId, {
          id: row.Tariff?.id ?? row.tariffId ?? null,
          ocpiTariffId,
          currency: row.Tariff?.currency ?? null,
          taxRate: num(row.Tariff?.taxRate),
          startDateTime: iso(row.Tariff?.startDateTime),
          endDateTime: iso(row.Tariff?.endDateTime),
          connectorCount: 1,
          elements: parseElements(row.Tariff?.TariffElements),
          appliesNowOn: 0,
        })
      }

      // First valid ConnectorTariff wins, like selectApplicableTariff. Core
      // doesn't order the rows, so we assume insertion (id) order.
      const applicable = connector.ConnectorTariffs.find(row =>
        isValidAt(row.Tariff, now),
      )
      if (applicable) {
        byKey.get(ocpiIdOf(applicable))!.appliesNowOn += 1
      }
    }
  }

  return {
    // eslint-disable-next-line unicorn/no-array-sort -- toSorted needs ES2023 lib, not configured here
    tariffs: [...byKey.values()].sort((a, b) =>
      a.ocpiTariffId.localeCompare(b.ocpiTariffId),
    ),
    connectorCount,
  }
}

/**
 * Our data view: locations we operate ourselves (not received from a CPO
 * partner, not roaming) and exposed over OCPI (disableOCPI is null/false) —
 * mirrors the LocationsService.getLocations sender-GET filter. Each location
 * carries the tariffs on its connectors (our own ConnectorTariffs only,
 * tenantPartnerId null — the same rows the OCPI location GET publishes).
 */
export async function fetchOurLocations (): Promise<OurLocation[]> {
  const data
    = await graphqlRequest<OurLocationsQueryResult>(OUR_LOCATIONS_QUERY)

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
    ...tariffsOfLocation(loc.ChargingStations),
  }))
}
