// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type {
  ComplianceIssue,
  GireveComplianceReport,
  LocationCompliance,
} from '@/types/gireveCompliance'
import { adminGetJson } from './adminHttp'

/** Gireve checks computed server-side on the OCPI-mapped locations (GireveComplianceService). */
export async function fetchGireveCompliance (): Promise<GireveComplianceReport> {
  const payload = await adminGetJson<{ data: GireveComplianceReport }>(
    '/our-locations/gireve-compliance',
  )
  return payload.data
}

/** One line per backend rule code; unknown codes fall back to the backend message. */
export const GIREVE_ISSUE_LABELS: Record<string, string> = {
  LOCATION_MAPPING_FAILED: 'Location cannot be mapped to OCPI',
  COORDINATES_MISSING: 'Coordinates missing',
  COORDINATES_ZERO: 'Coordinates set to 0,0',
  COORDINATES_OUT_OF_RANGE: 'Coordinates out of range',
  COORDINATES_PRECISION: 'Coordinates need 5 to 7 decimals',
  EVSE_ID_MISSING: 'EVSE has no evse_id',
  EVSE_ID_NOT_EMI3: 'evse_id is not eMI3',
  EVSE_ID_DUPLICATE: 'evse_id used by another EVSE',
  EVSE_CAPABILITY_MISSING: 'No authentication or payment capability',
  EVSE_NO_VALID_CONNECTOR: 'No publishable connector',
  EVSE_DUPLICATE_CONNECTOR_STANDARD: 'Two connectors with the same standard',
  CONNECTOR_DC_STANDARD: 'DC connector is neither COMBO nor CHAdeMO',
  CONNECTOR_COMBO_SOCKET: 'COMBO connector declared as SOCKET',
  CONNECTOR_POWER_INCONSISTENT: 'Max power above voltage x amperage',
  CONNECTOR_INVALID: 'Connector dropped from the OCPI payload',
  CONNECTOR_TARIFF_MISSING: 'Connector has no tariff',
  CONNECTOR_MAX_POWER_MISSING: 'Connector max power missing',
  CONNECTOR_DC_AMPERAGE_LOW: 'DC amperage below 32 A',
  LOCATION_OWNER_NAME_MISSING: 'Owner name missing',
  LOCATION_OPENING_TIMES_MISSING: 'Opening times missing',
  LOCATION_REGULAR_HOURS_TOO_MANY_SLOTS: 'More than 2 opening slots on a day',
  EVSE_FLOOR_LEVEL_NOT_INTEGER: 'floor_level is not an integer',
  EVSE_STATUS_PLANNED: 'EVSE is PLANNED',
  LOCATION_TIME_ZONE_NOT_PARIS: 'Time zone is not Europe/Paris',
  LOCATION_PARKING_TYPE_MISSING: 'Parking type missing',
  EVSE_STATUS_REMOVED: 'EVSE is REMOVED (not checked)',
}

export function issueLabel (issue: ComplianceIssue): string {
  return GIREVE_ISSUE_LABELS[issue.code] ?? issue.message
}

export interface ComplianceChip {
  label: string
  color: string
  icon: string
}

function plural (count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function complianceChip (
  compliance: LocationCompliance | undefined,
): ComplianceChip {
  if (!compliance) {
    return { label: 'Not checked', color: 'grey', icon: 'mdi-help-circle-outline' }
  }
  const { error, warning } = compliance.counts
  if (error > 0) {
    return { label: plural(error, 'blocker'), color: 'compliance-error', icon: 'mdi-close-octagon' }
  }
  if (warning > 0) {
    return { label: plural(warning, 'warning'), color: 'compliance-warning', icon: 'mdi-alert' }
  }
  return { label: 'OK', color: 'compliance-ok', icon: 'mdi-check-circle' }
}

/** Higher is worse; any blocker outranks any number of warnings. Unchecked sorts first. */
export function complianceSortValue (
  compliance: LocationCompliance | undefined,
): number {
  if (!compliance) {
    return -1
  }
  const { error, warning, info } = compliance.counts
  return error * 1_000_000 + warning * 1000 + info
}

export type RoamingFilter = 'enabled' | 'disabled' | 'all'

export function filterByRoaming<T extends { disableOCPI: boolean }> (
  locations: T[],
  filter: RoamingFilter,
): T[] {
  if (filter === 'all') {
    return locations
  }
  const wantDisabled = filter === 'disabled'
  return locations.filter(location => location.disableOCPI === wantDisabled)
}

export interface IssueGroup {
  key: string
  evseUid: string | null
  evseId: string | null
  issues: ComplianceIssue[]
}

/** Location-level issues first, then one group per EVSE in backend order. */
export function groupIssues (issues: ComplianceIssue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>([['location', { key: 'location', evseUid: null, evseId: null, issues: [] }]])
  for (const issue of issues) {
    const key = issue.evseUid ? `evse:${issue.evseUid}` : 'location'
    let group = groups.get(key)
    if (!group) {
      group = { key, evseUid: issue.evseUid ?? null, evseId: null, issues: [] }
      groups.set(key, group)
    }
    group.evseId ??= issue.evseId ?? null
    group.issues.push(issue)
  }
  return [...groups.values()].filter(group => group.issues.length > 0)
}
