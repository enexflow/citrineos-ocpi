// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import {
  InvalidParamException,
  type NetworkOperation,
} from '@citrineos/ocpi-base';

/** An operation kept for onboarding, split into its OCPI identity. */
export type SelectedOperation = {
  operation: string;
  countryCode: string;
  partyId: string;
};

/** An operation left out because it belongs to another owner. */
export type SkippedOperation = {
  operation: string;
  reason: string;
};

const normalizeOwner = (owner: string) => owner.trim().toLowerCase();

/**
 * Picks the operations to onboard out of a hub export and splits each eMI3
 * operator id (FR*S13) into country code and party id.
 *
 * - With `operationOwner`, only the operations of that owner are kept.
 * - Without it, the operations must not have several owners.
 *
 * Throws InvalidParamException when no operation is left.
 */
export const selectNetworkOperations = (
  operations: NetworkOperation[],
  operationOwner?: string,
): { selected: SelectedOperation[]; skipped: SkippedOperation[] } => {
  if (operationOwner === undefined) {
    const owners = new Map<string, string>();
    for (const operation of operations) {
      const owner = operation['Operation Owner'];
      if (owner?.trim()) {
        owners.set(normalizeOwner(owner), owner.trim());
      }
    }
    if (owners.size > 1) {
      throw new InvalidParamException(
        `operations have ${owners.size} owners (${[...owners.values()].join(', ')}); set operationOwner to pick one`,
      );
    }
  }

  const wanted =
    operationOwner === undefined ? undefined : normalizeOwner(operationOwner);
  const selected: SelectedOperation[] = [];
  const skipped: SkippedOperation[] = [];

  for (const operation of operations) {
    const id = operation['Operation Emi3'].trim();
    const owner = operation['Operation Owner'];
    if (wanted !== undefined && normalizeOwner(owner ?? '') !== wanted) {
      skipped.push({
        operation: id,
        reason: owner?.trim() ? `owned by ${owner.trim()}` : 'no owner',
      });
      continue;
    }
    const [countryCode, partyId] = id.split('*');
    selected.push({ operation: id, countryCode, partyId });
  }

  if (selected.length === 0) {
    throw new InvalidParamException(
      `no operation owned by ${operationOwner?.trim()}`,
    );
  }
  return { selected, skipped };
};
