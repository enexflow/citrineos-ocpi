// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { readEnv } from '@/config'
import { useAuthStore } from '@/stores/auth'

const OCPI_BASE = readEnv('VITE_OCPI_BASE') ?? '/ocpi'

/** GET a CitrineOS /ocpi/admin endpoint with the signed-in user's token. */
export async function adminGetJson<T> (path: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = await useAuthStore().getToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${OCPI_BASE}/admin${path}`, { headers })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Admin GET ${path} failed (${response.status}): ${body.slice(0, 300)}`,
    )
  }

  return (await response.json()) as T
}
