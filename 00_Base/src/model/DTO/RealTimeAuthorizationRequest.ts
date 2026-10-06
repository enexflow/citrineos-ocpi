// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { RealTimeAuthorizationRequestBody } from '@zetra/citrineos-util';

export type RealTimeAuthorizationRequest = Omit<
  RealTimeAuthorizationRequestBody,
  'tenantPartnerId'
> & {
  tenantPartnerId?: number;
  tenantId?: number;
};
