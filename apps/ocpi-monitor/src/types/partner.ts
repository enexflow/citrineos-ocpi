// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

export type OcpiRole = 'CPO' | 'EMSP' | 'HUB' | 'NSP' | 'OTHER' | string

export type PartnersView = 'emsp' | 'cpo'

export interface PartnerProfileRole {
  role?: OcpiRole
  businessDetails?: {
    name?: string
    website?: string
  }
}

export interface PartnerProfileOcpi {
  roles?: PartnerProfileRole[]
  version?: { version?: string }
  endpoints?: Array<{ identifier?: string, url?: string }>
  serverCredentials?: { token?: string, versionsUrl?: string }
  credentials?: { token?: string, versionsUrl?: string }
}

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
