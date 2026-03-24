// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { TariffDto } from '@citrineos/base';
import {
  getTenantPartnerId,
  isPartnerReceivedTariff,
} from '../tariffPartnerNotification.js';

describe('tariffPartnerNotification', () => {
  describe('isPartnerReceivedTariff', () => {
    it('returns true when tenantPartnerId is a positive number', () => {
      const t = { tenantPartnerId: 15 } as unknown as TariffDto;
      expect(isPartnerReceivedTariff(t)).toBe(true);
    });

    it('returns false when tenantPartnerId is null', () => {
      const t = { tenantPartnerId: null } as unknown as TariffDto;
      expect(isPartnerReceivedTariff(t)).toBe(false);
    });

    it('returns false when tenantPartnerId is undefined', () => {
      const t = {} as TariffDto;
      expect(isPartnerReceivedTariff(t)).toBe(false);
    });
  });

  describe('getTenantPartnerId', () => {
    it('returns the id when set', () => {
      const t = { tenantPartnerId: 99 } as unknown as TariffDto;
      expect(getTenantPartnerId(t)).toBe(99);
    });

    it('returns undefined when absent', () => {
      const t = {} as TariffDto;
      expect(getTenantPartnerId(t)).toBeUndefined();
    });
  });
});
