// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/** Fields used to pick the CDR that overrides a session on the home dashboard. */
export interface CdrLinkFields {
  sessionId: string | null
  credit: boolean | null
}

/**
 * Latest non-credit CDR per key. `rows` must be ordered by lastUpdated desc;
 * rows whose key is null are skipped.
 */
export function latestCdrByKey<T extends CdrLinkFields> (
  rows: T[],
  keyOf: (row: T) => string | null,
): Map<string, T> {
  const byKey = new Map<string, T>()
  for (const row of rows) {
    const key = keyOf(row)
    if (key == null || row.credit === true || byKey.has(key)) {
      continue
    }
    byKey.set(key, row)
  }
  return byKey
}

/**
 * Sent CDR of each Transaction (by its DB id), through the Cdrs.transactionId
 * FK. CDRs without the FK are never linked.
 */
export function sentCdrByTransactionDbId<
  T extends CdrLinkFields & { Transaction: { id: number } | null },
> (cdrs: T[]): { get: (transactionDbId: number) => T | undefined } {
  const byKey = latestCdrByKey(cdrs, cdr =>
    cdr.Transaction ? String(cdr.Transaction.id) : null,
  )
  return { get: transactionDbId => byKey.get(String(transactionDbId)) }
}
