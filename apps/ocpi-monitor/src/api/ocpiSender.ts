// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Call CitrineOS's admin endpoints so SessionMapper / CdrMapper run on the
 * server (GET /ocpi/admin/partners/:id/sessions|cdrs). These endpoints
 * resolve the partner's OCPI identity and credential server-side — the
 * browser never sees the partner's serverCredentials.token.
 */

import { readEnv } from '@/config';
import { useAuthStore } from '@/stores/auth';

const OCPI_BASE = readEnv('VITE_OCPI_BASE') ?? '/ocpi';

async function adminGet<T>(
  module: 'sessions' | 'cdrs',
  partnerId: number,
): Promise<T[]> {
  const url = `${OCPI_BASE}/admin/partners/${partnerId}/${module}?limit=200&offset=0`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = await useAuthStore().getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Admin GET ${module} failed (${response.status}): ${body.slice(0, 300)}`,
    );
  }

  const payload = (await response.json()) as { data?: T[] };
  return payload.data ?? [];
}

export async function fetchMappedSessionsForPartner(
  partnerId: number,
): Promise<Record<string, unknown>[]> {
  return adminGet<Record<string, unknown>>('sessions', partnerId);
}

export async function fetchMappedCdrsForPartner(
  partnerId: number,
): Promise<Record<string, unknown>[]> {
  return adminGet<Record<string, unknown>>('cdrs', partnerId);
}
