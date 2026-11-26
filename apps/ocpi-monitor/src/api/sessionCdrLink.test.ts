// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { latestCdrByKey, sentCdrByTransactionDbId } from './sessionCdrLink'

interface TestCdr {
  sessionId: string | null
  credit: boolean | null
  Transaction: { id: number } | null
  tag: string
}

function cdr (over: Partial<TestCdr>): TestCdr {
  return { sessionId: null, credit: false, Transaction: null, tag: '', ...over }
}

describe('latestCdrByKey', () => {
  it('keeps the first (latest) row per key', () => {
    const byKey = latestCdrByKey(
      [cdr({ sessionId: 'S1', tag: 'latest' }), cdr({ sessionId: 'S1', tag: 'older' })],
      row => row.sessionId,
    )

    expect(byKey.get('S1')?.tag).toBe('latest')
  })

  it('skips credit CDRs and rows without a key', () => {
    const byKey = latestCdrByKey(
      [
        cdr({ sessionId: 'S1', credit: true, tag: 'credit' }),
        cdr({ sessionId: 'S1', tag: 'cdr' }),
        cdr({ sessionId: null, tag: 'no key' }),
      ],
      row => row.sessionId,
    )

    expect([...byKey.keys()]).toEqual(['S1'])
    expect(byKey.get('S1')?.tag).toBe('cdr')
  })

  it('keeps a null credit flag as a regular CDR', () => {
    const byKey = latestCdrByKey(
      [cdr({ sessionId: 'S1', credit: null, tag: 'legacy' })],
      row => row.sessionId,
    )

    expect(byKey.get('S1')?.tag).toBe('legacy')
  })
})

describe('sentCdrByTransactionDbId', () => {
  it('links a CDR to its Transaction through the FK', () => {
    const find = sentCdrByTransactionDbId([
      cdr({ Transaction: { id: 10 }, sessionId: 'T-10', tag: 'fk' }),
    ])

    expect(find.get(10)?.tag).toBe('fk')
    expect(find.get(11)).toBeUndefined()
  })

  it('uses the latest non-credit CDR of the Transaction', () => {
    const find = sentCdrByTransactionDbId([
      cdr({ Transaction: { id: 20 }, credit: true, tag: 'credit' }),
      cdr({ Transaction: { id: 20 }, tag: 'latest' }),
      cdr({ Transaction: { id: 20 }, tag: 'older' }),
    ])

    expect(find.get(20)?.tag).toBe('latest')
  })

  it('never links a CDR without the FK, even with a matching sessionId', () => {
    const find = sentCdrByTransactionDbId([cdr({ sessionId: '30', tag: 'no fk' })])

    expect(find.get(30)).toBeUndefined()
  })
})
