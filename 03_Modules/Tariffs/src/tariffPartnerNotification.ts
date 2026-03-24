// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { TariffDto } from '@citrineos/base';

/**
 * DB/pg_notify payload for Tariff DTO events may include tenantPartnerId even though
 * {@link TariffDto} from @citrineos/base is inferred from a schema without that column.
 */
export type TariffNotificationPayload = (TariffDto | Partial<TariffDto>) & {
  tenantPartnerId?: number | null;
};

/**
 * Tariffs received from a partner CPO (Receiver PUT) are stored with tenantPartnerId set.
 * Those must not be broadcast to other partners as "our" CPO tariffs.
 */
export function isPartnerReceivedTariff(
  tariff: TariffDto | Partial<TariffDto>,
): boolean {
  return (tariff as TariffNotificationPayload).tenantPartnerId != null;
}

export function getTenantPartnerId(
  tariff: TariffDto | Partial<TariffDto>,
): number | null | undefined {
  return (tariff as TariffNotificationPayload).tenantPartnerId;
}
