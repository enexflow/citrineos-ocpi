// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Call CitrineOS's admin endpoints so SessionMapper / CdrMapper run on the
 * server (GET /ocpi/admin/partners/:id/sessions|cdrs). These endpoints
 * resolve the partner's OCPI identity and credential server-side — the
 * browser never sees the partner's serverCredentials.token.
 */

import { readEnv } from '@/config'
import { useAuthStore } from '@/stores/auth'

const OCPI_BASE = readEnv('VITE_OCPI_BASE') ?? '/ocpi'

async function adminGet<T> (
  module: 'sessions' | 'cdrs',
  partnerId: number,
): Promise<T[]> {
  const url = `${OCPI_BASE}/admin/partners/${partnerId}/${module}?limit=200&offset=0`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = await useAuthStore().getToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Admin GET ${module} failed (${response.status}): ${body.slice(0, 300)}`,
    )
  }

  const payload = (await response.json()) as { data?: T[] }
  return payload.data ?? []
}

export async function fetchMappedSessionsForPartner (
  partnerId: number,
): Promise<Record<string, unknown>[]> {
  return adminGet<Record<string, unknown>>('sessions', partnerId)
}

export async function fetchMappedCdrsForPartner (
  partnerId: number,
): Promise<Record<string, unknown>[]> {
  return adminGet<Record<string, unknown>>('cdrs', partnerId)
}

export interface PartnerTokenLookup {
  partner: {
    id: number
    countryCode: string
    partyId: string
    role: string
    businessDetails: { name?: string, website?: string } | null
  }
  request: {
    method: 'GET'
    countryCode: string
    partyId: string
    uid: string
    type: string | null
  }
  /** URL called on the partner (null when it exposes no Tokens RECEIVER) */
  url: string | null
  /** true when the partner answered with a 2xx HTTP status */
  ok: boolean
  /** HTTP status when the partner answered with an error status */
  httpStatus: number | null
  /** partner's raw response body */
  body: unknown
  error: string | null
}

/**
 * Debug: GET one of our tokens from a partner's Tokens RECEIVER through
 * GET /ocpi/admin/partners/:id/tokens/:uid — the server holds the partner
 * credential, uses our own country/party and returns the partner's raw answer.
 */
export async function fetchPartnerToken (
  partnerId: number,
  uid: string,
): Promise<PartnerTokenLookup> {
  const url = `${OCPI_BASE}/admin/partners/${partnerId}/tokens/${encodeURIComponent(uid)}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = await useAuthStore().getToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Admin GET token failed (${response.status}): ${body.slice(0, 300)}`,
    )
  }

  const payload = (await response.json()) as { data: PartnerTokenLookup }
  return payload.data
}
