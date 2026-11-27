// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { Locations_Bool_Exp } from '../graphql/operations.js';

/**
 * Our own, non-roamed, non-deleted locations: the scope of the OCPI Sender GET
 * and of the Gireve compliance report (which also covers OCPI-disabled ones).
 */
export function buildOurLocationsWhere(options: {
  tenant?: { countryCode: string; partyId: string };
  includeOcpiDisabled: boolean;
}): Locations_Bool_Exp {
  return {
    ...(options.tenant && {
      Tenant: {
        countryCode: { _eq: options.tenant.countryCode },
        partyId: { _eq: options.tenant.partyId },
      },
    }),
    ownerTenantPartnerId: { _is_null: true },
    roamingPartnerId: { _is_null: true },
    deletedAt: { _is_null: true },
    // null = not disabled
    ...(!options.includeOcpiDisabled && {
      _or: [
        { disableOCPI: { _is_null: true } },
        { disableOCPI: { _eq: false } },
      ],
    }),
  };
}
