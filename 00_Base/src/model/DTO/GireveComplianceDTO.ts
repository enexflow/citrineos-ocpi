// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { GireveRuleCode } from '../../services/gireveStaticDataRules.js';

export type ComplianceLevel = 'ERROR' | 'WARNING' | 'INFO';

export interface ComplianceIssue {
  level: ComplianceLevel;
  code: GireveRuleCode;
  message: string;
  field?: string;
  value?: string | number | null;
  evseUid?: string;
  evseId?: string | null;
  connectorId?: string;
}

export interface ComplianceCounts {
  error: number;
  warning: number;
  info: number;
}

export interface LocationCompliance {
  locationId: number;
  name: string | null;
  disableOCPI: boolean;
  countryCode: string | null;
  partyId: string | null;
  evseCount: number;
  connectorCount: number;
  counts: ComplianceCounts;
  issues: ComplianceIssue[];
}

export interface GireveComplianceReport {
  generatedAt: string;
  rulesVersion: string;
  locations: LocationCompliance[];
}
