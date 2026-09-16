// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Partner identity (role/business details) via the admin endpoint, which
 * projects only these safe fields out of partnerProfileOCPI server-side.
 * The browser never receives serverCredentials/credentials tokens (SEC-001).
 */

import { readEnv } from '@/config'
import { useAuthStore } from '@/stores/auth'

const OCPI_BASE = readEnv('VITE_OCPI_BASE') ?? '/ocpi'

export interface PartnerIdentity {
  id: number
  countryCode: string
  partyId: string
  role: string
  businessDetails: { name?: string, website?: string } | null
}

async function adminGet<T> (path: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = await useAuthStore().getToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${OCPI_BASE}${path}`, { headers })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Admin GET ${path} failed (${response.status}): ${body.slice(0, 300)}`,
    )
  }

  return (await response.json()) as T
}

export async function fetchPartnerIdentities (): Promise<PartnerIdentity[]> {
  const payload = await adminGet<{ data: PartnerIdentity[] }>('/admin/partners')
  return payload.data
}

export async function fetchPartnerIdentity (
  id: number,
): Promise<PartnerIdentity | null> {
  const payload = await adminGet<{ data: PartnerIdentity | null }>(
    `/admin/partners/${id}`,
  )
  return payload.data
}
