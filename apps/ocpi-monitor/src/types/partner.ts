// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

export type OcpiRole = 'CPO' | 'EMSP' | 'HUB' | 'NSP' | 'OTHER' | string

export type PartnersView = 'emsp' | 'cpo'

export interface PartnerOverview {
  id: number
  countryCode: string
  partyId: string
  role: OcpiRole
  name: string
  website?: string
  locationCount: number
  tariffCount: number
  cdrCount: number
  tokenCount: number
  sessionCount: number
  sessionsSentCount: number
  cdrsSentCount: number
}

export interface PartnerRoleCounts {
  total: number
  cpo: number
  emsp: number
  hub: number
  other: number
}

export interface OcpiSessionSent {
  id: number
  ocpiSessionId: string
  status: string | null
  startDateTime: string | null
  endDateTime: string | null
  kwh: number | null
  totalCost: unknown
  lastUpdated: string | null
  countryCode: string
  partyId: string
  /** Final OCPI Session JSON (wire format) */
  ocpiJson: Record<string, unknown>
}

export interface OcpiCdrSent {
  id: number
  ocpiCdrId: string
  sessionId: string | null
  startDateTime: string | null
  endDateTime: string | null
  totalEnergy: number | null
  totalCost: unknown
  lastUpdated: string | null
  countryCode: string
  partyId: string
  /** Final OCPI CDR JSON (wire format) */
  ocpiJson: Record<string, unknown>
}

export interface CpoPartnerDetail {
  partner: PartnerOverview
  sessionsSent: OcpiSessionSent[]
  cdrsSent: OcpiCdrSent[]
}

export type LocationOwnership = 'own' | 'partner'

export interface OcpiLocationReceived {
  id: number
  ocpiId: string
  name: string | null
  address: string
  city: string
  country: string
  evseCount: number
  latitude: number | null
  longitude: number | null
  lastUpdated: string | null
  /** Only populated by fetchAllLocationsForMap; absent elsewhere. */
  ownership?: LocationOwnership
}

export interface OcpiSessionReceived {
  id: number
  ocpiSessionId: string
  status: string | null
  startDateTime: string | null
  endDateTime: string | null
  kwh: number | null
  totalCost: unknown
  currency: string
  lastUpdated: string | null
}

export interface OcpiCdrReceived {
  id: number
  ocpiCdrId: string
  sessionId: string | null
  startDateTime: string | null
  endDateTime: string | null
  totalEnergy: number | null
  totalCost: unknown
  currency: string
  lastUpdated: string | null
}

export interface EmspPartnerDetail {
  partner: PartnerOverview
  locations: OcpiLocationReceived[]
  sessions: OcpiSessionReceived[]
  cdrs: OcpiCdrReceived[]
  totalKwh: number
}

export interface CurrencyAmount {
  currency: string
  amount: number
}

export interface CdrFinancials {
  /** CDRs we sent (Cdrs.toTenantPartnerId) — money the eMSP owes us. */
  earned: CurrencyAmount[]
  /** CDRs we received (Cdrs.fromTenantPartnerId) — money we owe the CPO. */
  owed: CurrencyAmount[]
}

export interface HubOverview {
  id: number
  countryCode: string
  partyId: string
  name: string
}

export interface RoamingPartnerIdentity {
  id: number
  countryCode: string
  partyId: string
  name: string | null
}

/** A roaming CPO relayed through a hub — the eMSP (received) side. */
export interface RoamingCpoSummary {
  roamingPartnerId: number
  countryCode: string
  partyId: string
  name: string | null
  locationCount: number
  tariffCount: number
  cdrCount: number
  totalEnergyKwh: number
  totalCost: CurrencyAmount[]
}

/** A roaming eMSP relayed through a hub — the CPO (sent) side. */
export interface RoamingEmspSummary {
  roamingPartnerId: number
  countryCode: string
  partyId: string
  name: string | null
  tokenCount: number
  sessionCount: number
  cdrCount: number
  totalEnergyKwh: number
  totalCost: CurrencyAmount[]
}

export interface HubEmspView {
  hub: HubOverview
  roamingCpos: RoamingCpoSummary[]
}

export interface HubCpoView {
  hub: HubOverview
  roamingEmsps: RoamingEmspSummary[]
}

export interface RoamingTariffSummary {
  id: number
  ocpiTariffId: string | null
  currency: string
  taxRate: number | null
  startDateTime: string | null
  endDateTime: string | null
}

export interface RoamingCpoDetail {
  partner: RoamingPartnerIdentity
  locations: OcpiLocationReceived[]
  tariffs: RoamingTariffSummary[]
  sessions: OcpiSessionReceived[]
  cdrs: OcpiCdrReceived[]
  totalKwh: number
}

export interface RoamingTokenReceived {
  id: number
  idToken: string
  idTokenType: string | null
  status: string
  ocpiAuthMethod: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface RoamingEmspDetail {
  partner: RoamingPartnerIdentity
  tokenCount: number
  sessionCount: number
  /** Tokens this roaming eMSP has registered with us (Authorizations.roamingPartnerId) — received data. */
  tokens: RoamingTokenReceived[]
  /**
   * Live OCPI sender GET, mapped via SessionMapper against the hub's client
   * credentials then filtered to this roaming partner's country_code/party_id
   * — there's no separate OCPI connection per roaming partner to query.
   * Sessions/CDRs here are sent data.
   */
  sessionsSent: OcpiSessionSent[]
  cdrsSent: OcpiCdrSent[]
}

/** One CDR row for the hub-level, date-ranged CDR export (Excel). */
export interface HubCdrExportRow {
  countryCode: string
  partyId: string
  ocpiCdrId: string
  sessionId: string | null
  startDateTime: string | null
  endDateTime: string | null
  totalEnergy: number | null
  totalCost: unknown
  currency: string
}

/** One roaming partner's CDRs for the hub-level export — a Totals row plus its own detail sheet. */
export interface HubCdrExportGroup {
  countryCode: string
  partyId: string
  cdrCount: number
  totalEnergyKwh: number
  totalCost: CurrencyAmount[]
  cdrs: HubCdrExportRow[]
}
