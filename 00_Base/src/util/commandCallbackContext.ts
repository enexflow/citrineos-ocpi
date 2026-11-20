// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { OcpiHeaders } from '../model/OcpiHeaders.js';

export interface OcpiRoutingHeaders {
  fromCountryCode: string;
  fromPartyId: string;
  toCountryCode: string;
  toPartyId: string;
}

export interface CommandCallbackContext {
  responseUrl: string;
  // null when the eMSP sent no complete set of routing headers (peer-to-peer): the callback routes from the tenant partner.
  routing: OcpiRoutingHeaders | null;
}

type SerializedCommandCallbackContext = {
  responseUrl: string;
} & Partial<OcpiRoutingHeaders>;

export function serializeCommandCallbackContext(
  responseUrl: string,
  ocpiHeaders: OcpiHeaders,
): string {
  return JSON.stringify({
    responseUrl,
    fromCountryCode: ocpiHeaders.fromCountryCode,
    fromPartyId: ocpiHeaders.fromPartyId,
    toCountryCode: ocpiHeaders.toCountryCode,
    toPartyId: ocpiHeaders.toPartyId,
  } satisfies SerializedCommandCallbackContext);
}

export function parseCommandCallbackContext(
  cached: string,
): CommandCallbackContext | null {
  let parsed: Partial<SerializedCommandCallbackContext>;
  try {
    parsed = JSON.parse(cached) as Partial<SerializedCommandCallbackContext>;
  } catch {
    return null;
  }
  if (typeof parsed?.responseUrl !== 'string') {
    return null;
  }
  const { fromCountryCode, fromPartyId, toCountryCode, toPartyId } = parsed;
  const hasRouting =
    typeof fromCountryCode === 'string' &&
    typeof fromPartyId === 'string' &&
    typeof toCountryCode === 'string' &&
    typeof toPartyId === 'string';
  return {
    responseUrl: parsed.responseUrl,
    routing: hasRouting
      ? { fromCountryCode, fromPartyId, toCountryCode, toPartyId }
      : null,
  };
}

/** Swap inbound command routing headers for the CPO → eMSP callback. */
export function swapRoutingForCallback(
  routing: OcpiRoutingHeaders,
): OcpiRoutingHeaders {
  return {
    fromCountryCode: routing.toCountryCode,
    fromPartyId: routing.toPartyId,
    toCountryCode: routing.fromCountryCode,
    toPartyId: routing.fromPartyId,
  };
}
