// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type {
  CurrencyAmount,
  HubCdrExportGroup,
  HubCdrExportRow,
  HubCpoView,
  HubEmspView,
  HubOverview,
  OcpiCdrReceived,
  OcpiLocationReceived,
  OcpiSessionReceived,
  OcpiSessionSent,
  RoamingCpoDetail,
  RoamingCpoSummary,
  RoamingEmspDetail,
  RoamingEmspSummary,
  RoamingTariffSummary,
  RoamingTokenReceived,
} from '@/types/partner'
import { graphqlRequest } from './graphql.js'
import { fetchMappedSessionsForPartner } from './ocpiSender'
import { fetchPartnerIdentities } from './partnerIdentity'
import {
  type AggregateCount,
  amountOf,
  cdrFromStoredRow,
  countOf,
  iso,
  num,
  sessionFromOcpi,
  type StoredCdrRow,
} from './partners'

/** Every direct TenantPartner connection whose OCPI role is HUB. */
export async function fetchHubs (): Promise<HubOverview[]> {
  const identities = await fetchPartnerIdentities()
  return identities
    .filter(identity => identity.role === 'HUB')
    .map(identity => ({
      id: identity.id,
      countryCode: identity.countryCode,
      partyId: identity.partyId,
      name:
        identity.businessDetails?.name
        ?? `${identity.countryCode}/${identity.partyId}`,
    }))
}

function countBy<T> (
  rows: T[],
  keyOf: (row: T) => number | null,
): Map<number, number> {
  const counts = new Map<number, number>()
  for (const row of rows) {
    const key = keyOf(row)
    if (key == null) {
      continue
    }
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

interface CdrAggRow {
  roamingPartnerId: number | null
  currency: string
  totalCost: unknown
  totalEnergy: number | null
}

interface CdrAgg {
  count: number
  energy: number
  costTotals: Map<string, number>
}

function aggregateCdrsByRoamingPartner (rows: CdrAggRow[]): Map<number, CdrAgg> {
  const byId = new Map<number, CdrAgg>()
  for (const row of rows) {
    if (row.roamingPartnerId == null) {
      continue
    }
    let entry = byId.get(row.roamingPartnerId)
    if (!entry) {
      entry = { count: 0, energy: 0, costTotals: new Map() }
      byId.set(row.roamingPartnerId, entry)
    }
    entry.count += 1
    entry.energy += row.totalEnergy ?? 0
    entry.costTotals.set(
      row.currency,
      (entry.costTotals.get(row.currency) ?? 0) + amountOf(row.totalCost),
    )
  }
  return byId
}

function costList (costTotals: Map<string, number> | undefined): CurrencyAmount[] {
  if (!costTotals) {
    return []
  }
  return [...costTotals.entries()].map(([currency, amount]) => ({ currency, amount }))
}

function byCountryParty<T extends { countryCode: string, partyId: string }> (rows: T[]) {
  // eslint-disable-next-line unicorn/no-array-sort -- toSorted needs ES2023 lib, not configured here
  return rows.sort(
    (a, b) => `${a.countryCode}${a.partyId}`.localeCompare(`${b.countryCode}${b.partyId}`),
  )
}

const HUB_EMSP_VIEW_QUERY = `
  query HubEmspView($hubId: Int!) {
    RoamingPartners(where: { tenantPartnerId: { _eq: $hubId } }) {
      id
      countryCode
      partyId
      name
    }
    Locations(where: { ownerTenantPartnerId: { _eq: $hubId } }) {
      roamingPartnerId
    }
    Tariffs(where: { tenantPartnerId: { _eq: $hubId } }) {
      roamingPartnerId
    }
    Cdrs(where: { fromTenantPartnerId: { _eq: $hubId } }) {
      roamingPartnerId
      currency
      totalCost
      totalEnergy
    }
  }
`

interface HubEmspViewQueryResult {
  RoamingPartners: Array<{
    id: number
    countryCode: string
    partyId: string
    name: string | null
  }>
  Locations: Array<{ roamingPartnerId: number | null }>
  Tariffs: Array<{ roamingPartnerId: number | null }>
  Cdrs: CdrAggRow[]
}

/**
 * eMSP side of a hub: the roaming CPOs relayed through it, combining what
 * they've pushed (locations/tariffs) with what they've sent us (CDRs).
 */
export async function fetchHubEmspView (hubId: number): Promise<HubEmspView | null> {
  const [hubs, data] = await Promise.all([
    fetchHubs(),
    graphqlRequest<HubEmspViewQueryResult>(HUB_EMSP_VIEW_QUERY, { hubId }),
  ])

  const hub = hubs.find(h => h.id === hubId)
  if (!hub) {
    return null
  }

  const locationCounts = countBy(data.Locations, r => r.roamingPartnerId)
  const tariffCounts = countBy(data.Tariffs, r => r.roamingPartnerId)
  const cdrAgg = aggregateCdrsByRoamingPartner(data.Cdrs)

  // Only surface roaming partners that have actually pushed data — with no
  // stored role, that's the only signal we have that one is acting as CPO.
  const roamingCpos: RoamingCpoSummary[] = byCountryParty(
    data.RoamingPartners.map(rp => {
      const agg = cdrAgg.get(rp.id)
      return {
        roamingPartnerId: rp.id,
        countryCode: rp.countryCode,
        partyId: rp.partyId,
        name: rp.name,
        locationCount: locationCounts.get(rp.id) ?? 0,
        tariffCount: tariffCounts.get(rp.id) ?? 0,
        cdrCount: agg?.count ?? 0,
        totalEnergyKwh: agg?.energy ?? 0,
        totalCost: costList(agg?.costTotals),
      }
    }).filter(rp => rp.locationCount > 0 || rp.tariffCount > 0),
  )

  return { hub, roamingCpos }
}

const HUB_CPO_VIEW_QUERY = `
  query HubCpoView($hubId: Int!) {
    RoamingPartners(where: { tenantPartnerId: { _eq: $hubId } }) {
      id
      countryCode
      partyId
      name
    }
    Authorizations(where: { tenantPartnerId: { _eq: $hubId } }) {
      roamingPartnerId
    }
    Transactions(
      where: {
        endTime: { _is_null: false }
        Authorization: { tenantPartnerId: { _eq: $hubId } }
      }
    ) {
      Authorization {
        roamingPartnerId
      }
    }
    Cdrs(where: { toTenantPartnerId: { _eq: $hubId } }) {
      roamingPartnerId
      currency
      totalCost
      totalEnergy
    }
  }
`

interface HubCpoViewQueryResult {
  RoamingPartners: Array<{
    id: number
    countryCode: string
    partyId: string
    name: string | null
  }>
  Authorizations: Array<{ roamingPartnerId: number | null }>
  Transactions: Array<{ Authorization: { roamingPartnerId: number | null } | null }>
  Cdrs: CdrAggRow[]
}

/**
 * CPO side of a hub: the roaming eMSPs relayed through it — tokens they've
 * registered with us plus what we've sent them (CDRs).
 */
export async function fetchHubCpoView (hubId: number): Promise<HubCpoView | null> {
  const [hubs, data] = await Promise.all([
    fetchHubs(),
    graphqlRequest<HubCpoViewQueryResult>(HUB_CPO_VIEW_QUERY, { hubId }),
  ])

  const hub = hubs.find(h => h.id === hubId)
  if (!hub) {
    return null
  }

  const tokenCounts = countBy(data.Authorizations, r => r.roamingPartnerId)
  const sessionCounts = countBy(data.Transactions, r => r.Authorization?.roamingPartnerId ?? null)
  const cdrAgg = aggregateCdrsByRoamingPartner(data.Cdrs)

  const roamingEmsps: RoamingEmspSummary[] = byCountryParty(
    data.RoamingPartners.map(rp => {
      const agg = cdrAgg.get(rp.id)
      return {
        roamingPartnerId: rp.id,
        countryCode: rp.countryCode,
        partyId: rp.partyId,
        name: rp.name,
        tokenCount: tokenCounts.get(rp.id) ?? 0,
        sessionCount: sessionCounts.get(rp.id) ?? 0,
        cdrCount: agg?.count ?? 0,
        totalEnergyKwh: agg?.energy ?? 0,
        totalCost: costList(agg?.costTotals),
      }
    }),
  )

  return { hub, roamingEmsps }
}

const ROAMING_CPO_DETAIL_QUERY = `
  query RoamingCpoDetail($id: Int!) {
    RoamingPartners_by_pk(id: $id) {
      id
      countryCode
      partyId
      name
    }
    Locations(where: { roamingPartnerId: { _eq: $id } }, order_by: { id: asc }) {
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
    Tariffs(where: { roamingPartnerId: { _eq: $id } }, order_by: { id: asc }) {
      id
      ocpiTariffId
      currency
      taxRate
      startDateTime
      endDateTime
    }
    Sessions(where: { roamingPartnerId: { _eq: $id } }, order_by: { id: asc }) {
      id
      ocpiSessionId
      status
      startDateTime
      endDateTime
      kwh
      totalCost
      currency
      lastUpdated
    }
    Sessions_aggregate(where: { roamingPartnerId: { _eq: $id } }) {
      aggregate {
        sum {
          kwh
        }
      }
    }
    Cdrs(
      where: {
        roamingPartnerId: { _eq: $id }
        fromTenantPartnerId: { _is_null: false }
      }
      order_by: { id: asc }
    ) {
      id
      ocpiCdrId
      sessionId
      startDateTime
      endDateTime
      totalEnergy
      totalCost
      currency
      lastUpdated
    }
  }
`

interface RoamingCpoDetailQueryResult {
  RoamingPartners_by_pk: {
    id: number
    countryCode: string
    partyId: string
    name: string | null
  } | null
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
  Tariffs: Array<{
    id: number
    ocpiTariffId: string | null
    currency: string
    taxRate: number | null
    startDateTime: string | null
    endDateTime: string | null
  }>
  Sessions: Array<{
    id: number
    ocpiSessionId: string
    status: string | null
    startDateTime: string
    endDateTime: string | null
    kwh: number | null
    totalCost: unknown
    currency: string
    lastUpdated: string
  }>
  Sessions_aggregate: {
    aggregate: { sum: { kwh: number | null } | null } | null
  }
  Cdrs: Array<{
    id: number
    ocpiCdrId: string
    sessionId: string | null
    startDateTime: string
    endDateTime: string
    totalEnergy: number
    totalCost: unknown
    currency: string
    lastUpdated: string
  }>
}

/** Full detail for one roaming CPO behind a hub — its own locations/tariffs/sessions/CDRs. */
export async function fetchRoamingCpoDetail (
  roamingPartnerId: number,
): Promise<RoamingCpoDetail | null> {
  const data = await graphqlRequest<RoamingCpoDetailQueryResult>(
    ROAMING_CPO_DETAIL_QUERY,
    { id: roamingPartnerId },
  )

  const row = data.RoamingPartners_by_pk
  if (!row) {
    return null
  }

  const locations: OcpiLocationReceived[] = data.Locations.map(loc => ({
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

  const tariffs: RoamingTariffSummary[] = data.Tariffs.map(t => ({
    id: t.id,
    ocpiTariffId: t.ocpiTariffId,
    currency: t.currency,
    taxRate: num(t.taxRate),
    startDateTime: iso(t.startDateTime),
    endDateTime: iso(t.endDateTime),
  }))

  const sessions: OcpiSessionReceived[] = data.Sessions.map(session => ({
    id: session.id,
    ocpiSessionId: session.ocpiSessionId,
    status: session.status,
    startDateTime: iso(session.startDateTime),
    endDateTime: iso(session.endDateTime),
    kwh: num(session.kwh),
    totalCost: session.totalCost,
    currency: session.currency,
    lastUpdated: iso(session.lastUpdated),
  }))

  const cdrs: OcpiCdrReceived[] = data.Cdrs.map(cdr => ({
    id: cdr.id,
    ocpiCdrId: cdr.ocpiCdrId,
    sessionId: cdr.sessionId,
    startDateTime: iso(cdr.startDateTime),
    endDateTime: iso(cdr.endDateTime),
    totalEnergy: num(cdr.totalEnergy),
    totalCost: cdr.totalCost,
    currency: cdr.currency,
    lastUpdated: iso(cdr.lastUpdated),
  }))

  return {
    partner: row,
    locations,
    tariffs,
    sessions,
    cdrs,
    totalKwh: data.Sessions_aggregate.aggregate?.sum?.kwh ?? 0,
  }
}

const ROAMING_EMSP_DETAIL_QUERY = `
  query RoamingEmspDetail($id: Int!) {
    RoamingPartners_by_pk(id: $id) {
      id
      countryCode
      partyId
      name
      tenantPartnerId
    }
    Authorizations_aggregate(where: { roamingPartnerId: { _eq: $id } }) {
      aggregate {
        count
      }
    }
    Authorizations(
      where: { roamingPartnerId: { _eq: $id } }
      order_by: { id: asc }
    ) {
      id
      idToken
      idTokenType
      status
      ocpiAuthMethod
      createdAt
      updatedAt
    }
    endedTx: Transactions_aggregate(
      where: {
        endTime: { _is_null: false }
        Authorization: { roamingPartnerId: { _eq: $id } }
      }
    ) {
      aggregate {
        count
      }
    }
    Cdrs(
      where: {
        roamingPartnerId: { _eq: $id }
        toTenantPartnerId: { _is_null: false }
      }
      order_by: { id: asc }
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
    }
  }
`

interface RoamingEmspDetailQueryResult {
  RoamingPartners_by_pk: {
    id: number
    countryCode: string
    partyId: string
    name: string | null
    tenantPartnerId: number
  } | null
  Authorizations_aggregate: AggregateCount
  Authorizations: Array<{
    id: number
    idToken: string
    idTokenType: string | null
    status: string
    ocpiAuthMethod: string | null
    createdAt: string | null
    updatedAt: string | null
  }>
  endedTx: AggregateCount
  Cdrs: StoredCdrRow[]
}

/**
 * Full detail for one roaming eMSP behind a hub — tokens, ended transactions,
 * and CDRs sent. Live-mapped sessions come from the hub's own OCPI sender GET
 * (there's no separate connection per roaming partner), filtered down to this
 * roaming partner's country_code/party_id afterward.
 */
export async function fetchRoamingEmspDetail (
  roamingPartnerId: number,
): Promise<RoamingEmspDetail | null> {
  const data = await graphqlRequest<RoamingEmspDetailQueryResult>(
    ROAMING_EMSP_DETAIL_QUERY,
    { id: roamingPartnerId },
  )

  const row = data.RoamingPartners_by_pk
  if (!row) {
    return null
  }

  const cdrsSent = data.Cdrs.map(cdr => cdrFromStoredRow(cdr))

  const tokens: RoamingTokenReceived[] = data.Authorizations.map(auth => ({
    id: auth.id,
    idToken: auth.idToken,
    idTokenType: auth.idTokenType,
    status: auth.status,
    ocpiAuthMethod: auth.ocpiAuthMethod,
    createdAt: iso(auth.createdAt),
    updatedAt: iso(auth.updatedAt),
  }))

  let sessionsSent: OcpiSessionSent[] = []
  try {
    const allSessions = await fetchMappedSessionsForPartner(row.tenantPartnerId)
    sessionsSent = allSessions
      .filter(
        session =>
          String(session.country_code) === row.countryCode
          && String(session.party_id) === row.partyId,
      )
      .map((session, index) => sessionFromOcpi(session, index))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Could not load mapped sessions via OCPI sender GET: ${message}`,
    )
  }

  return {
    partner: {
      id: row.id,
      countryCode: row.countryCode,
      partyId: row.partyId,
      name: row.name,
    },
    tokenCount: countOf(data.Authorizations_aggregate),
    sessionCount: countOf(data.endedTx),
    tokens,
    sessionsSent,
    cdrsSent,
  }
}

interface RawCdrExportRow {
  ocpiCdrId: string
  roamingPartnerId: number
  sessionId: string | null
  startDateTime: string | null
  endDateTime: string | null
  totalEnergy: number | null
  totalCost: unknown
  currency: string
}

interface RawRoamingPartnerIdentity {
  id: number
  countryCode: string
  partyId: string
}

function mapCdrExportRow (
  row: RawCdrExportRow,
  identity: RawRoamingPartnerIdentity,
): HubCdrExportRow {
  return {
    countryCode: identity.countryCode,
    partyId: identity.partyId,
    ocpiCdrId: row.ocpiCdrId,
    sessionId: row.sessionId,
    startDateTime: iso(row.startDateTime),
    endDateTime: iso(row.endDateTime),
    totalEnergy: num(row.totalEnergy),
    totalCost: row.totalCost,
    currency: row.currency,
  }
}

/**
 * Group CDR export rows by roaming partner. Grouped by Cdrs.roamingPartnerId
 * (an FK), not by the CDR's own country_code/party_id — those identify
 * whichever party *issued* the CDR (always the CPO, i.e. us on the sent
 * side — see CdrBroadcaster's cpoCountryCode/cpoPartyId), not necessarily the
 * roaming counterpart, so they can't be used to tell partners apart.
 */
function groupCdrExportRows (
  rows: RawCdrExportRow[],
  roamingPartners: RawRoamingPartnerIdentity[],
): HubCdrExportGroup[] {
  const identityById = new Map(roamingPartners.map(rp => [rp.id, rp]))

  const byId = new Map<
    number,
    {
      countryCode: string
      partyId: string
      cdrCount: number
      energy: number
      costTotals: Map<string, number>
      cdrs: HubCdrExportRow[]
    }
  >()

  for (const row of rows) {
    const identity = identityById.get(row.roamingPartnerId)
    if (!identity) {
      continue
    }
    let entry = byId.get(row.roamingPartnerId)
    if (!entry) {
      entry = {
        countryCode: identity.countryCode,
        partyId: identity.partyId,
        cdrCount: 0,
        energy: 0,
        costTotals: new Map(),
        cdrs: [],
      }
      byId.set(row.roamingPartnerId, entry)
    }
    entry.cdrCount += 1
    entry.energy += row.totalEnergy ?? 0
    entry.costTotals.set(
      row.currency,
      (entry.costTotals.get(row.currency) ?? 0) + amountOf(row.totalCost),
    )
    entry.cdrs.push(mapCdrExportRow(row, identity))
  }

  return [...byId.values()]
    .map(({ costTotals, energy, ...rest }) => ({
      ...rest,
      totalEnergyKwh: energy,
      totalCost: costList(costTotals),
    }))
    // eslint-disable-next-line unicorn/no-array-sort -- toSorted needs ES2023 lib, not configured here
    .sort((a, b) => `${a.countryCode}${a.partyId}`.localeCompare(`${b.countryCode}${b.partyId}`))
}

const HUB_EMSP_CDR_EXPORT_QUERY = `
  query HubEmspCdrExport($hubId: Int!, $from: timestamptz!, $to: timestamptz!) {
    RoamingPartners(where: { tenantPartnerId: { _eq: $hubId } }) {
      id
      countryCode
      partyId
    }
    Cdrs(
      where: {
        fromTenantPartnerId: { _eq: $hubId }
        roamingPartnerId: { _is_null: false }
        startDateTime: { _lte: $to }
        endDateTime: { _gte: $from }
      }
      order_by: { startDateTime: asc }
    ) {
      ocpiCdrId
      roamingPartnerId
      sessionId
      startDateTime
      endDateTime
      totalEnergy
      totalCost
      currency
    }
  }
`

interface HubCdrExportQueryResult {
  RoamingPartners: RawRoamingPartnerIdentity[]
  Cdrs: RawCdrExportRow[]
}

/**
 * eMSP side: every CDR received through this hub (fromTenantPartnerId) that's
 * attributed to a roaming partner (roamingPartnerId not null — otherwise it
 * can't be placed on a partner sheet), whose [start, end] overlaps [from, to].
 * A session straddling either boundary is included, and both boundary days
 * are inclusive (pass from as <day>T00:00:00.000Z and to as <day>T23:59:59.999Z).
 * Grouped by roaming partner: one Totals row plus its own CDR list, for the
 * Totals sheet + one detail sheet per partner.
 */
export async function fetchHubEmspCdrExport (
  hubId: number,
  from: string,
  to: string,
): Promise<HubCdrExportGroup[]> {
  const data = await graphqlRequest<HubCdrExportQueryResult>(
    HUB_EMSP_CDR_EXPORT_QUERY,
    { hubId, from, to },
  )
  return groupCdrExportRows(data.Cdrs, data.RoamingPartners)
}

const HUB_CPO_CDR_EXPORT_QUERY = `
  query HubCpoCdrExport($hubId: Int!, $from: timestamptz!, $to: timestamptz!) {
    RoamingPartners(where: { tenantPartnerId: { _eq: $hubId } }) {
      id
      countryCode
      partyId
    }
    Cdrs(
      where: {
        toTenantPartnerId: { _eq: $hubId }
        roamingPartnerId: { _is_null: false }
        startDateTime: { _lte: $to }
        endDateTime: { _gte: $from }
      }
      order_by: { startDateTime: asc }
    ) {
      ocpiCdrId
      roamingPartnerId
      sessionId
      startDateTime
      endDateTime
      totalEnergy
      totalCost
      currency
    }
  }
`

/**
 * CPO side: every CDR sent through this hub (toTenantPartnerId) that's
 * attributed to a roaming partner, whose [start, end] overlaps [from, to].
 */
export async function fetchHubCpoCdrExport (
  hubId: number,
  from: string,
  to: string,
): Promise<HubCdrExportGroup[]> {
  const data = await graphqlRequest<HubCdrExportQueryResult>(
    HUB_CPO_CDR_EXPORT_QUERY,
    { hubId, from, to },
  )
  return groupCdrExportRows(data.Cdrs, data.RoamingPartners)
}
