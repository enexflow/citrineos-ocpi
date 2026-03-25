// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type {
  ChargingPreferencesResponse,
  OcpiEmptyResponse,
  PaginatedSessionResponse,
  SessionResponse,
  VersionNumber,
} from '@citrineos/ocpi-base';

export interface ISessionsModuleApi {
  getSessions(
    version: VersionNumber,
    ...args: any[]
  ): Promise<PaginatedSessionResponse>;

  getSessionById(
    version: VersionNumber,
    countryCode: string,
    partyId: string,
    sessionId: string,
  ): Promise<SessionResponse>;

  putSession(
    version: VersionNumber,
    countryCode: string,
    partyId: string,
    sessionId: string,
    ...args: any[]
  ): Promise<OcpiEmptyResponse>;

  patchSession(
    version: VersionNumber,
    countryCode: string,
    partyId: string,
    sessionId: string,
    ...args: any[]
  ): Promise<OcpiEmptyResponse>;

  updateChargingPreferences(
    sessionId: string,
    ...args: any[]
  ): Promise<ChargingPreferencesResponse>;
}
