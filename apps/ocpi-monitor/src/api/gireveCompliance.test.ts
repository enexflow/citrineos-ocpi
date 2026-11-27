// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type {
  ComplianceIssue,
  LocationCompliance,
} from '@/types/gireveCompliance'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adminGetJson } from './adminHttp'
import {
  complianceChip,
  complianceSortValue,
  fetchGireveCompliance,
  filterByRoaming,
  groupIssues,
  issueLabel,
} from './gireveCompliance'

vi.mock('./adminHttp', () => ({ adminGetJson: vi.fn() }))

function compliance (
  counts: Partial<LocationCompliance['counts']> = {},
): LocationCompliance {
  return {
    locationId: 1,
    name: 'Corbas',
    disableOCPI: false,
    countryCode: 'FR',
    partyId: 'ZET',
    evseCount: 1,
    connectorCount: 1,
    counts: { error: 0, warning: 0, info: 0, ...counts },
    issues: [],
  }
}

function issue (over: Partial<ComplianceIssue>): ComplianceIssue {
  return { level: 'ERROR', code: 'EVSE_ID_MISSING', message: 'm', ...over }
}

describe('fetchGireveCompliance', () => {
  beforeEach(() => vi.mocked(adminGetJson).mockReset())

  it('unwraps the admin endpoint payload', async () => {
    const report = { generatedAt: 'now', rulesVersion: 'v', locations: [] }
    vi.mocked(adminGetJson).mockResolvedValue({ data: report })

    await expect(fetchGireveCompliance()).resolves.toBe(report)
    expect(adminGetJson).toHaveBeenCalledWith('/our-locations/gireve-compliance')
  })
})

describe('complianceChip', () => {
  it('flags a location without a report as not checked', () => {
    expect(complianceChip(undefined).label).toBe('Not checked')
  })

  it('shows blockers before warnings', () => {
    expect(complianceChip(compliance({ error: 2, warning: 5 }))).toMatchObject({
      label: '2 blockers',
      color: 'compliance-error',
    })
  })

  it('shows warnings when there is no blocker', () => {
    expect(complianceChip(compliance({ warning: 1 }))).toMatchObject({
      label: '1 warning',
      color: 'compliance-warning',
    })
  })

  it('is OK when only infos remain', () => {
    expect(complianceChip(compliance({ info: 3 }))).toMatchObject({
      label: 'OK',
      color: 'compliance-ok',
    })
  })
})

describe('complianceSortValue', () => {
  it('ranks one blocker above many warnings, and unchecked first', () => {
    const blocker = complianceSortValue(compliance({ error: 1 }))
    const warnings = complianceSortValue(compliance({ warning: 999, info: 999 }))
    expect(blocker).toBeGreaterThan(warnings)
    expect(complianceSortValue(undefined)).toBeLessThan(
      complianceSortValue(compliance()),
    )
  })
})

describe('filterByRoaming', () => {
  const on = { id: 1, disableOCPI: false }
  const off = { id: 2, disableOCPI: true }

  it('splits on disableOCPI and keeps everything for all', () => {
    expect(filterByRoaming([on, off], 'enabled')).toEqual([on])
    expect(filterByRoaming([on, off], 'disabled')).toEqual([off])
    expect(filterByRoaming([on, off], 'all')).toEqual([on, off])
  })
})

describe('groupIssues', () => {
  it('puts location issues first, then one group per EVSE in backend order', () => {
    const groups = groupIssues([
      issue({ evseUid: 'SN2::1', evseId: 'FR*ZET*ESN2*1' }),
      issue({ code: 'COORDINATES_MISSING' }),
      issue({ evseUid: 'SN1::1', connectorId: '10' }),
      issue({ evseUid: 'SN2::1', level: 'WARNING' }),
    ])

    expect(groups.map(g => [g.evseUid, g.evseId, g.issues.length])).toEqual([
      [null, null, 1],
      ['SN2::1', 'FR*ZET*ESN2*1', 2],
      ['SN1::1', null, 1],
    ])
  })

  it('returns no group when there is no issue', () => {
    expect(groupIssues([])).toEqual([])
  })
})

describe('issueLabel', () => {
  it('uses the label of a known code and the backend message otherwise', () => {
    expect(issueLabel(issue({ code: 'EVSE_ID_NOT_EMI3' }))).toBe(
      'evse_id is not eMI3',
    )
    expect(issueLabel(issue({ code: 'SOME_FUTURE_RULE', message: 'from backend' }))).toBe(
      'from backend',
    )
  })
})
