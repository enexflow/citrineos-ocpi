// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Call OCPI CPO sender APIs so SessionMapper / CdrMapper run on the server
 * (same path as GET /ocpi/cpo/.../sessions|cdrs).
 */

const OCPI_BASE = import.meta.env.VITE_OCPI_BASE ?? '/ocpi'
const OCPI_VERSION = import.meta.env.VITE_OCPI_VERSION ?? '2.2.1'

export interface OurTenantIdentity {
  countryCode: string
  partyId: string
}

function encodeAuthToken (rawToken: string): string {
  // AuthMiddleware expects `Token <base64(serverCredentials.token)>`
  const bytes = new TextEncoder().encode(rawToken)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte)
  }
  return `Token ${btoa(binary)}`
}

function uuid (): string {
  return crypto.randomUUID()
}

async function ocpiSenderGet<T> (args: {
  module: 'sessions' | 'cdrs'
  rawServerToken: string
  fromCountryCode: string
  fromPartyId: string
  toCountryCode: string
  toPartyId: string
}): Promise<T[]> {
  const url = `${OCPI_BASE}/cpo/${OCPI_VERSION}/${args.module}?limit=200&offset=0`
  const response = await fetch(url, {
    headers: {
      'Authorization': encodeAuthToken(args.rawServerToken),
      'Content-Type': 'application/json',
      'OCPI-from-country-code': args.fromCountryCode,
      'OCPI-from-party-id': args.fromPartyId,
      'OCPI-to-country-code': args.toCountryCode,
      'OCPI-to-party-id': args.toPartyId,
      'X-Request-ID': uuid(),
      'X-Correlation-ID': uuid(),
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `OCPI GET ${args.module} failed (${response.status}): ${body.slice(0, 300)}`,
    )
  }

  const payload = (await response.json()) as { data?: T[] }
  return payload.data ?? []
}

export async function fetchMappedSessionsForPartner (args: {
  rawServerToken: string
  partnerCountryCode: string
  partnerPartyId: string
  ourTenant: OurTenantIdentity
}): Promise<Record<string, unknown>[]> {
  return ocpiSenderGet<Record<string, unknown>>({
    module: 'sessions',
    rawServerToken: args.rawServerToken,
    fromCountryCode: args.partnerCountryCode,
    fromPartyId: args.partnerPartyId,
    toCountryCode: args.ourTenant.countryCode,
    toPartyId: args.ourTenant.partyId,
  })
}

export async function fetchMappedCdrsForPartner (args: {
  rawServerToken: string
  partnerCountryCode: string
  partnerPartyId: string
  ourTenant: OurTenantIdentity
}): Promise<Record<string, unknown>[]> {
  return ocpiSenderGet<Record<string, unknown>>({
    module: 'cdrs',
    rawServerToken: args.rawServerToken,
    fromCountryCode: args.partnerCountryCode,
    fromPartyId: args.partnerPartyId,
    toCountryCode: args.ourTenant.countryCode,
    toPartyId: args.ourTenant.partyId,
  })
}
