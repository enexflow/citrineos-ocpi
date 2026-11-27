// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Ids of the OCPI objects we emit as CPO: {country_code}*{party_id}*{type letter}{number},
 * e.g. FR*ZET*R009876 (page "Format des identifiants Zetra"). The prefix is the tenant's,
 * the number a unique key from the database, zero-padded to OCPI_OBJECT_ID_MIN_DIGITS.
 */
export enum OcpiObjectIdType {
  /** Session ("Recharge"), number = Transactions.id */
  SESSION = 'R',
  /** CDR ("Facture"), number = Transactions.id, the same as its session */
  CDR = 'F',
}

export const OCPI_OBJECT_ID_MIN_DIGITS = 6;

// Hasura Int is a signed 32-bit integer: a larger number cannot be a database id
const MAX_DB_ID = 2_147_483_647;

const OCPI_OBJECT_ID_PATTERN = /^([A-Z]{2})\*([A-Z0-9]{3})\*([A-Z])(\d+)$/;

export interface ParsedOcpiObjectId {
  countryCode: string;
  partyId: string;
  type: OcpiObjectIdType;
  number: number;
}

export function buildOcpiObjectId(
  countryCode: string | null | undefined,
  partyId: string | null | undefined,
  type: OcpiObjectIdType,
  number: number | null | undefined,
): string {
  if (!countryCode || !partyId) {
    throw new Error(
      `Cannot build ${type} id ${number}: missing country code or party id`,
    );
  }
  if (number == null || !Number.isSafeInteger(number) || number < 0) {
    throw new Error(
      `Cannot build ${type} id for ${countryCode}*${partyId}: invalid number ${number}`,
    );
  }
  const digits = String(number).padStart(OCPI_OBJECT_ID_MIN_DIGITS, '0');
  return `${countryCode}*${partyId}*${type}${digits}`;
}

/**
 * Reads back an id built by buildOcpiObjectId. Returns undefined when the id is not in our
 * format, is of another type, or its number cannot be a database id.
 */
export function parseOcpiObjectId(
  id: string,
  type: OcpiObjectIdType,
): ParsedOcpiObjectId | undefined {
  const match = OCPI_OBJECT_ID_PATTERN.exec(id);
  if (!match || match[3] !== type) {
    return undefined;
  }
  const number = Number(match[4]);
  if (!Number.isSafeInteger(number) || number > MAX_DB_ID) {
    return undefined;
  }
  return { countryCode: match[1], partyId: match[2], type, number };
}

/** OCPI Session.id of a transaction, also the CDR's session_id. */
export function getOcpiSessionId(transaction: {
  id?: number | null;
  tenant?: { countryCode?: string | null; partyId?: string | null } | null;
}): string {
  return buildOcpiObjectId(
    transaction.tenant?.countryCode,
    transaction.tenant?.partyId,
    OcpiObjectIdType.SESSION,
    transaction.id,
  );
}

/** OCPI CDR.id of a transaction: same number as its session. */
export function getOcpiCdrId(transaction: {
  id?: number | null;
  tenant?: { countryCode?: string | null; partyId?: string | null } | null;
}): string {
  return buildOcpiObjectId(
    transaction.tenant?.countryCode,
    transaction.tenant?.partyId,
    OcpiObjectIdType.CDR,
    transaction.id,
  );
}
