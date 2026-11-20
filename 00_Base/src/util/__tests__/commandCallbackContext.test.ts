// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import {
  parseCommandCallbackContext,
  serializeCommandCallbackContext,
  swapRoutingForCallback,
} from '../commandCallbackContext.js';
import type { OcpiHeaders } from '../../model/OcpiHeaders.js';

const RESPONSE_URL =
  'https://emsp.example/ocpi/emsp/2.2.1/commands/START_SESSION/1';

describe('command callback context', () => {
  it('keeps the response URL when the eMSP sent no routing headers', () => {
    // What the commands controller builds for a peer-to-peer eMSP: all four headers undefined.
    const headers = {} as OcpiHeaders;

    const context = parseCommandCallbackContext(
      serializeCommandCallbackContext(RESPONSE_URL, headers),
    );

    expect(context).toEqual({ responseUrl: RESPONSE_URL, routing: null });
  });

  it('drops a partial set of routing headers', () => {
    const headers = {
      fromCountryCode: 'FR',
      fromPartyId: 'Q47',
    } as OcpiHeaders;

    const context = parseCommandCallbackContext(
      serializeCommandCallbackContext(RESPONSE_URL, headers),
    );

    expect(context).toEqual({ responseUrl: RESPONSE_URL, routing: null });
  });

  it('round-trips complete routing headers and swaps them for the callback', () => {
    const headers: OcpiHeaders = {
      fromCountryCode: 'FR',
      fromPartyId: 'Q47',
      toCountryCode: 'FR',
      toPartyId: 'ZET',
    };

    const context = parseCommandCallbackContext(
      serializeCommandCallbackContext(RESPONSE_URL, headers),
    );

    expect(context?.responseUrl).toBe(RESPONSE_URL);
    expect(swapRoutingForCallback(context!.routing!)).toEqual({
      fromCountryCode: 'FR',
      fromPartyId: 'ZET',
      toCountryCode: 'FR',
      toPartyId: 'Q47',
    });
  });

  it('returns null for a cache value that is not a serialized context', () => {
    expect(parseCommandCallbackContext(RESPONSE_URL)).toBeNull();
    expect(parseCommandCallbackContext('{"foo":"bar"}')).toBeNull();
    expect(parseCommandCallbackContext('null')).toBeNull();
  });
});
