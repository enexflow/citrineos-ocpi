// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

export function prettyOcpiJson (payload: Record<string, unknown>): string {
  return JSON.stringify(payload, null, 2)
}
