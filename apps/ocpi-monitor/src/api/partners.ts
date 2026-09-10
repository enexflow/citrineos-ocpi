// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type {
  CdrFinancials,
  CpoPartnerDetail,
  CurrencyAmount,
  EmspPartnerDetail,
  OcpiCdrReceived,
  OcpiCdrSent,
  OcpiLocationReceived,
  OcpiSessionReceived,
  OcpiSessionSent,
  PartnerOverview,
  PartnerProfileOcpi,
  PartnerRoleCounts,
} from '@/types/partner';
import { graphqlRequest } from './graphql.js';
import { fetchMappedSessionsForPartner } from './ocpiSender';

interface AggregateCount {
  aggregate: { count: number } | null;
}

function countOf(agg: AggregateCount | undefined): number {
  return agg?.aggregate?.count ?? 0;
}

function mapIdentity(row: {
  id: number;
  countryCode: string;
  partyId: string;
  partnerProfileOCPI: PartnerProfileOcpi | null;
}): Pick<
  PartnerOverview,
  'id' | 'countryCode' | 'partyId' | 'role' | 'name' | 'website'
> {
  const profile = row.partnerProfileOCPI;
  const primaryRole = profile?.roles?.[0];
  const role = primaryRole?.role ?? 'OTHER';
  const name =
    primaryRole?.businessDetails?.name ?? `${row.countryCode}/${row.partyId}`;

  return {
    id: row.id,
    countryCode: row.countryCode,
    partyId: row.partyId,
    role,
    name,
    website: primaryRole?.businessDetails?.website,
  };
}

function emptyMetrics(): Pick<
  PartnerOverview,
  | 'locationCount'
  | 'tariffCount'
  | 'cdrCount'
  | 'tokenCount'
  | 'sessionCount'
  | 'sessionsSentCount'
  | 'cdrsSentCount'
> {
  return {
    locationCount: 0,
    tariffCount: 0,
    cdrCount: 0,
    tokenCount: 0,
    sessionCount: 0,
    sessionsSentCount: 0,
    cdrsSentCount: 0,
  };
}

function serverTokenFromProfile(
  profile: PartnerProfileOcpi | null,
): string | null {
  const token = profile?.serverCredentials?.token;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

function iso(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  try {
    return new Date(value as string).toISOString();
  } catch {
    return String(value);
  }
}

function num(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const EMSP_PARTNERS_QUERY = `
  query EmspPartnersOverview {
    TenantPartners(order_by: [{ countryCode: asc }, { partyId: asc }]) {
      id
      countryCode
      partyId
      partnerProfileOCPI
      Tariffs_aggregate {
        aggregate {
          count
        }
      }
      Sessions_aggregate {
        aggregate {
          count
        }
      }
      FromCdrs_aggregate {
        aggregate {
          count
        }
      }
    }
    Locations(where: { ownerTenantPartnerId: { _is_null: false } }) {
      ownerTenantPartnerId
    }
  }
`;

interface EmspPartnersQueryResult {
  TenantPartners: Array<{
    id: number;
    countryCode: string;
    partyId: string;
    partnerProfileOCPI: PartnerProfileOcpi | null;
    Tariffs_aggregate: AggregateCount;
    Sessions_aggregate: AggregateCount;
    FromCdrs_aggregate: AggregateCount;
  }>;
  Locations: Array<{ ownerTenantPartnerId: number | null }>;
}

/**
 * EMSP view: partners that send us locations/tariffs (CPO and HUB).
 * Sessions/CDRs here are received rows stored under tenantPartnerId.
 */
export async function fetchEmspPartners(): Promise<PartnerOverview[]> {
  const data =
    await graphqlRequest<EmspPartnersQueryResult>(EMSP_PARTNERS_QUERY);

  const locationCounts = new Map<number, number>();
  for (const location of data.Locations) {
    const partnerId = location.ownerTenantPartnerId;
    if (partnerId == null) {
      continue;
    }
    locationCounts.set(partnerId, (locationCounts.get(partnerId) ?? 0) + 1);
  }

  return data.TenantPartners.map((row) => ({
    ...mapIdentity(row),
    ...emptyMetrics(),
    locationCount: locationCounts.get(row.id) ?? 0,
    tariffCount: countOf(row.Tariffs_aggregate),
    sessionCount: countOf(row.Sessions_aggregate),
    cdrCount: countOf(row.FromCdrs_aggregate),
  })).filter((partner) => partner.role === 'CPO' || partner.role === 'HUB');
}

const EMSP_PARTNER_DETAIL_QUERY = `
  query EmspPartnerDetail($id: Int!) {
    TenantPartners_by_pk(id: $id) {
      id
      countryCode
      partyId
      partnerProfileOCPI
      Tariffs_aggregate {
        aggregate {
          count
        }
      }
      Sessions_aggregate {
        aggregate {
          count
          sum {
            kwh
          }
        }
      }
      FromCdrs_aggregate {
        aggregate {
          count
        }
      }
    }
    Locations(
      where: { ownerTenantPartnerId: { _eq: $id } }
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
    Sessions(where: { tenantPartnerId: { _eq: $id } }, order_by: { id: asc }) {
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
    Cdrs(where: { fromTenantPartnerId: { _eq: $id } }, order_by: { id: asc }) {
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
`;

interface EmspPartnerDetailQueryResult {
  TenantPartners_by_pk: {
    id: number;
    countryCode: string;
    partyId: string;
    partnerProfileOCPI: PartnerProfileOcpi | null;
    Tariffs_aggregate: AggregateCount;
    Sessions_aggregate: {
      aggregate: { count: number; sum: { kwh: number | null } | null } | null;
    };
    FromCdrs_aggregate: AggregateCount;
  } | null;
  Locations: Array<{
    id: number;
    ocpiId: string;
    name: string | null;
    address: string;
    city: string;
    country: string;
    coordinates: { type: string; coordinates: [number, number] } | null;
    updatedAt: string | null;
    ChargingStations_aggregate: AggregateCount;
  }>;
  Sessions: Array<{
    id: number;
    ocpiSessionId: string;
    status: string | null;
    startDateTime: string;
    endDateTime: string | null;
    kwh: number | null;
    totalCost: unknown;
    currency: string;
    lastUpdated: string;
  }>;
  Cdrs: Array<{
    id: number;
    ocpiCdrId: string;
    sessionId: string | null;
    startDateTime: string;
    endDateTime: string;
    totalEnergy: number;
    totalCost: unknown;
    currency: string;
    lastUpdated: string;
  }>;
}

/**
 * EMSP view detail: locations/sessions/CDRs actually received and stored for
 * this CPO/HUB partner (ownerTenantPartnerId / tenantPartnerId / fromTenantPartnerId) —
 * no OCPI sender GET involved, this is what we pulled/received and persisted.
 */
export async function fetchEmspPartnerDetail(
  partnerId: number,
): Promise<EmspPartnerDetail | null> {
  const data = await graphqlRequest<EmspPartnerDetailQueryResult>(
    EMSP_PARTNER_DETAIL_QUERY,
    { id: partnerId },
  );

  const row = data.TenantPartners_by_pk;
  if (!row) {
    return null;
  }

  const partner: PartnerOverview = {
    ...mapIdentity(row),
    ...emptyMetrics(),
    locationCount: data.Locations.length,
    tariffCount: countOf(row.Tariffs_aggregate),
    sessionCount: countOf(row.Sessions_aggregate),
    cdrCount: countOf(row.FromCdrs_aggregate),
  };

  const locations: OcpiLocationReceived[] = data.Locations.map((loc) => ({
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
  }));

  const sessions: OcpiSessionReceived[] = data.Sessions.map((session) => ({
    id: session.id,
    ocpiSessionId: session.ocpiSessionId,
    status: session.status,
    startDateTime: iso(session.startDateTime),
    endDateTime: iso(session.endDateTime),
    kwh: num(session.kwh),
    totalCost: session.totalCost,
    currency: session.currency,
    lastUpdated: iso(session.lastUpdated),
  }));

  const cdrs: OcpiCdrReceived[] = data.Cdrs.map((cdr) => ({
    id: cdr.id,
    ocpiCdrId: cdr.ocpiCdrId,
    sessionId: cdr.sessionId,
    startDateTime: iso(cdr.startDateTime),
    endDateTime: iso(cdr.endDateTime),
    totalEnergy: num(cdr.totalEnergy),
    totalCost: cdr.totalCost,
    currency: cdr.currency,
    lastUpdated: iso(cdr.lastUpdated),
  }));

  return {
    partner,
    locations,
    sessions,
    cdrs,
    totalKwh: row.Sessions_aggregate.aggregate?.sum?.kwh ?? 0,
  };
}

const CPO_PARTNERS_QUERY = `
  query CpoPartnersOverview {
    TenantPartners(order_by: [{ countryCode: asc }, { partyId: asc }]) {
      id
      countryCode
      partyId
      partnerProfileOCPI
      Authorizations_aggregate {
        aggregate {
          count
        }
      }
      ToCdrs_aggregate {
        aggregate {
          count
        }
      }
    }
    # Sessions we send as CPO are mapped from Transactions, not the Sessions table.
    Transactions(
      where: { Authorization: { tenantPartnerId: { _is_null: false } } }
    ) {
      endTime
      Authorization {
        tenantPartnerId
      }
    }
  }
`;

interface CpoPartnersQueryResult {
  TenantPartners: Array<{
    id: number;
    countryCode: string;
    partyId: string;
    partnerProfileOCPI: PartnerProfileOcpi | null;
    Authorizations_aggregate: AggregateCount;
    ToCdrs_aggregate: AggregateCount;
  }>;
  Transactions: Array<{
    endTime: string | null;
    Authorization: { tenantPartnerId: number | null } | null;
  }>;
}

/**
 * CPO view: EMSP/HUB partners — tokens + transactions we map/send as OCPI sessions/CDRs.
 */
export async function fetchCpoPartners(): Promise<PartnerOverview[]> {
  const data = await graphqlRequest<CpoPartnersQueryResult>(CPO_PARTNERS_QUERY);

  const allTx = new Map<number, number>();
  const endedTx = new Map<number, number>();
  for (const tx of data.Transactions) {
    const partnerId = tx.Authorization?.tenantPartnerId;
    if (partnerId == null) {
      continue;
    }
    allTx.set(partnerId, (allTx.get(partnerId) ?? 0) + 1);
    if (tx.endTime != null) {
      endedTx.set(partnerId, (endedTx.get(partnerId) ?? 0) + 1);
    }
  }

  return data.TenantPartners.map((row) => {
    const ended = endedTx.get(row.id) ?? 0;
    return {
      ...mapIdentity(row),
      ...emptyMetrics(),
      tokenCount: countOf(row.Authorizations_aggregate),
      sessionCount: ended,
      // Mapped from transactions (SessionBroadcaster / sender GET), not Sessions table
      sessionsSentCount: allTx.get(row.id) ?? 0,
      // CDRs actually stored in our DB and sent to this partner (Cdrs.toTenantPartnerId)
      cdrsSentCount: countOf(row.ToCdrs_aggregate),
      cdrCount: ended,
    };
  }).filter((partner) => partner.role === 'EMSP' || partner.role === 'HUB');
}

const CPO_PARTNER_DETAIL_QUERY = `
  query CpoPartnerDetail($id: Int!) {
    TenantPartners_by_pk(id: $id) {
      id
      countryCode
      partyId
      partnerProfileOCPI
      Authorizations_aggregate {
        aggregate {
          count
        }
      }
      ToCdrs_aggregate {
        aggregate {
          count
        }
      }
      Tenant {
        countryCode
        partyId
      }
    }
    allTx: Transactions_aggregate(
      where: { Authorization: { tenantPartnerId: { _eq: $id } } }
    ) {
      aggregate {
        count
      }
    }
    endedTx: Transactions_aggregate(
      where: {
        endTime: { _is_null: false }
        Authorization: { tenantPartnerId: { _eq: $id } }
      }
    ) {
      aggregate {
        count
      }
    }
  }
`;

interface CpoPartnerDetailQueryResult {
  TenantPartners_by_pk: {
    id: number;
    countryCode: string;
    partyId: string;
    partnerProfileOCPI: PartnerProfileOcpi | null;
    Authorizations_aggregate: AggregateCount;
    ToCdrs_aggregate: AggregateCount;
    Tenant: { countryCode: string; partyId: string } | null;
  } | null;
  allTx: AggregateCount;
  endedTx: AggregateCount;
}

function sessionFromOcpi(
  payload: Record<string, unknown>,
  index: number,
): OcpiSessionSent {
  return {
    id: index + 1,
    ocpiSessionId: String(payload.id ?? ''),
    status: payload.status == null ? null : String(payload.status),
    startDateTime: iso(payload.start_date_time),
    endDateTime: iso(payload.end_date_time),
    kwh: num(payload.kwh),
    totalCost: payload.total_cost ?? null,
    lastUpdated: iso(payload.last_updated),
    countryCode: String(payload.country_code ?? ''),
    partyId: String(payload.party_id ?? ''),
    ocpiJson: payload,
  };
}

const CPO_STORED_CDRS_QUERY = `
  query CpoStoredCdrs($toTenantPartnerId: Int!) {
    Cdrs(
      where: { toTenantPartnerId: { _eq: $toTenantPartnerId } }
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
`;

interface StoredCdrRow {
  id: number;
  ocpiCdrId: string;
  countryCode: string;
  partyId: string;
  startDateTime: string;
  endDateTime: string;
  sessionId: string | null;
  cdrToken: Record<string, unknown>;
  authMethod: string;
  authorizationReference: string | null;
  cdrLocation: Record<string, unknown>;
  meterId: string | null;
  currency: string;
  tariffs: unknown[] | null;
  chargingPeriods: unknown[];
  signedData: Record<string, unknown> | null;
  totalCost: unknown;
  totalFixedCost: unknown;
  totalEnergy: number;
  totalEnergyCost: unknown;
  totalTime: number;
  totalTimeCost: unknown;
  totalParkingTime: number | null;
  totalParkingCost: unknown;
  totalReservationCost: unknown;
  remark: string | null;
  invoiceReferenceId: string | null;
  credit: boolean | null;
  creditReferenceId: string | null;
  homeChargingCompensation: boolean | null;
  lastUpdated: string;
}

interface StoredCdrsQueryResult {
  Cdrs: StoredCdrRow[];
}

/**
 * Rebuild the OCPI-wire CDR shape from a stored row — mirrors CdrMapper.mapCdrReceiver
 * (00_Base/src/mapper/CdrMapper.ts), the same mapper used to serve this CDR to the eMSP.
 */
function cdrFromStoredRow(row: StoredCdrRow): OcpiCdrSent {
  const ocpiJson: Record<string, unknown> = {
    country_code: row.countryCode,
    party_id: row.partyId,
    id: row.ocpiCdrId,
    start_date_time: row.startDateTime,
    end_date_time: row.endDateTime,
    session_id: row.sessionId ?? undefined,
    cdr_token: row.cdrToken,
    auth_method: row.authMethod,
    authorization_reference: row.authorizationReference ?? undefined,
    cdr_location: row.cdrLocation,
    meter_id: row.meterId ?? undefined,
    currency: row.currency,
    tariffs: row.tariffs ?? undefined,
    charging_periods: row.chargingPeriods,
    signed_data: row.signedData ?? undefined,
    total_cost: row.totalCost,
    total_fixed_cost: row.totalFixedCost ?? undefined,
    total_energy: row.totalEnergy,
    total_energy_cost: row.totalEnergyCost ?? undefined,
    total_time: row.totalTime,
    total_time_cost: row.totalTimeCost ?? undefined,
    total_parking_time: row.totalParkingTime ?? undefined,
    total_parking_cost: row.totalParkingCost ?? undefined,
    total_reservation_cost: row.totalReservationCost ?? undefined,
    remark: row.remark ?? undefined,
    invoice_reference_id: row.invoiceReferenceId ?? undefined,
    credit: row.credit ?? undefined,
    credit_reference_id: row.creditReferenceId ?? undefined,
    home_charging_compensation: row.homeChargingCompensation ?? undefined,
    last_updated: row.lastUpdated,
  };

  return {
    id: row.id,
    ocpiCdrId: row.ocpiCdrId,
    sessionId: row.sessionId,
    startDateTime: iso(row.startDateTime),
    endDateTime: iso(row.endDateTime),
    totalEnergy: num(row.totalEnergy),
    totalCost: row.totalCost,
    lastUpdated: iso(row.lastUpdated),
    countryCode: row.countryCode,
    partyId: row.partyId,
    ocpiJson,
  };
}

async function fetchStoredCdrsForPartner(
  partnerId: number,
): Promise<OcpiCdrSent[]> {
  const data = await graphqlRequest<StoredCdrsQueryResult>(
    CPO_STORED_CDRS_QUERY,
    { toTenantPartnerId: partnerId },
  );
  return data.Cdrs.map((row) => cdrFromStoredRow(row));
}

/**
 * Partner detail for CPO view: sessions as mapped live by SessionMapper via OCPI
 * sender GET; CDRs as actually stored in our DB when sent to this partner.
 */
export async function fetchCpoPartnerDetail(
  partnerId: number,
): Promise<CpoPartnerDetail | null> {
  const data = await graphqlRequest<CpoPartnerDetailQueryResult>(
    CPO_PARTNER_DETAIL_QUERY,
    { id: partnerId },
  );

  const row = data.TenantPartners_by_pk;
  if (!row) {
    return null;
  }

  const ended = countOf(data.endedTx);
  const partner: PartnerOverview = {
    ...mapIdentity(row),
    ...emptyMetrics(),
    tokenCount: countOf(row.Authorizations_aggregate),
    sessionCount: ended,
    sessionsSentCount: countOf(data.allTx),
    cdrsSentCount: countOf(row.ToCdrs_aggregate),
    cdrCount: ended,
  };

  const cdrsSent = await fetchStoredCdrsForPartner(partnerId);

  const rawToken = serverTokenFromProfile(row.partnerProfileOCPI);
  const ourTenant = row.Tenant;
  if (!rawToken || !ourTenant) {
    return {
      partner,
      sessionsSent: [],
      cdrsSent,
    };
  }

  try {
    const sessions = await fetchMappedSessionsForPartner({
      rawServerToken: rawToken,
      partnerCountryCode: row.countryCode,
      partnerPartyId: row.partyId,
      ourTenant: {
        countryCode: ourTenant.countryCode,
        partyId: ourTenant.partyId,
      },
    });

    return {
      partner,
      sessionsSent: sessions.map((session, index) =>
        sessionFromOcpi(session, index),
      ),
      cdrsSent,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not load mapped sessions via OCPI sender GET: ${message}`,
    );
  }
}

const ROLE_COUNTS_QUERY = `
  query PartnerRoleCounts {
    TenantPartners {
      id
      partnerProfileOCPI
    }
  }
`;

function primaryRole(profile: PartnerProfileOcpi | null): string {
  return profile?.roles?.[0]?.role ?? 'OTHER';
}

/** Home dashboard: how many partners per OCPI role. */
export async function fetchPartnerRoleCounts(): Promise<PartnerRoleCounts> {
  const data = await graphqlRequest<{
    TenantPartners: Array<{
      id: number;
      partnerProfileOCPI: PartnerProfileOcpi | null;
    }>;
  }>(ROLE_COUNTS_QUERY);

  const counts: PartnerRoleCounts = {
    total: data.TenantPartners.length,
    cpo: 0,
    emsp: 0,
    hub: 0,
    other: 0,
  };

  for (const partner of data.TenantPartners) {
    switch (primaryRole(partner.partnerProfileOCPI)) {
      case 'CPO': {
        counts.cpo += 1;
        break;
      }
      case 'EMSP': {
        counts.emsp += 1;
        break;
      }
      case 'HUB': {
        counts.hub += 1;
        break;
      }
      default: {
        counts.other += 1;
      }
    }
  }

  return counts;
}

const CDR_FINANCIALS_QUERY = `
  query CdrFinancials($from: timestamptz!, $to: timestamptz!) {
    earned: Cdrs(
      where: {
        toTenantPartnerId: { _is_null: false }
        endDateTime: { _gte: $from, _lte: $to }
      }
    ) {
      currency
      totalCost
    }
    owed: Cdrs(
      where: {
        fromTenantPartnerId: { _is_null: false }
        endDateTime: { _gte: $from, _lte: $to }
      }
    ) {
      currency
      totalCost
    }
  }
`;

interface CdrFinancialsQueryResult {
  earned: Array<{ currency: string; totalCost: unknown }>;
  owed: Array<{ currency: string; totalCost: unknown }>;
}

function amountOf(totalCost: unknown): number {
  if (typeof totalCost === 'number') {
    return totalCost;
  }
  if (totalCost != null && typeof totalCost === 'object') {
    const price = totalCost as { incl_vat?: number | null; excl_vat?: number };
    return price.incl_vat ?? price.excl_vat ?? 0;
  }
  return 0;
}

function sumByCurrency(
  rows: Array<{ currency: string; totalCost: unknown }>,
): CurrencyAmount[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(
      row.currency,
      (totals.get(row.currency) ?? 0) + amountOf(row.totalCost),
    );
  }
  return [...totals.entries()].map(([currency, amount]) => ({
    currency,
    amount,
  }));
}

/**
 * Home dashboard: cumulative CDR money earned (sent to eMSPs) vs owed
 * (received from CPOs) within a date range, summed per currency.
 */
export async function fetchCdrFinancials(
  from: string,
  to: string,
): Promise<CdrFinancials> {
  const data = await graphqlRequest<CdrFinancialsQueryResult>(
    CDR_FINANCIALS_QUERY,
    { from, to },
  );

  return {
    earned: sumByCurrency(data.earned),
    owed: sumByCurrency(data.owed),
  };
}
