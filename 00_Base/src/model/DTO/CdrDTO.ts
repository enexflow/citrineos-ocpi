// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { AuthMethod } from '../AuthMethod.js';
import { CdrTokenSchema } from '../CdrToken.js';
import { CdrLocationSchema } from '../CdrLocation.js';
import { TariffSchema } from '../Tariff.js';
import { ChargingPeriodSchema } from '../ChargingPeriod.js';
import { SignedDataSchema } from '../SignedData.js';
import { PriceSchema } from '../Price.js';
import { OcpiResponseSchema, OcpiResponseStatusCode } from '../OcpiResponse.js';

// ── Wire shape (OCPI 2.2.1 CDR object) ──────────────────────────────────────

export const CdrDTOSchema = z.object({
  country_code: z.string().length(2),
  party_id: z.string().max(3),
  id: z.string().max(39),
  start_date_time: z.coerce.date(),
  end_date_time: z.coerce.date(),
  session_id: z.string().max(36).nullable().optional(),
  cdr_token: CdrTokenSchema,
  auth_method: z.nativeEnum(AuthMethod),
  authorization_reference: z.string().max(36).nullable().optional(),
  cdr_location: CdrLocationSchema,
  meter_id: z.string().max(255).nullable().optional(),
  currency: z.string().length(3),
  tariffs: z.array(TariffSchema).nullable().optional(),
  charging_periods: z.array(ChargingPeriodSchema).min(1),
  signed_data: SignedDataSchema.nullable().optional(),
  total_cost: PriceSchema,
  total_fixed_cost: PriceSchema.nullable().optional(),
  total_energy: z.number(),
  total_energy_cost: PriceSchema.nullable().optional(),
  total_time: z.number(),
  total_time_cost: PriceSchema.nullable().optional(),
  total_parking_time: z.number().nullable().optional(),
  total_parking_cost: PriceSchema.nullable().optional(),
  total_reservation_cost: PriceSchema.nullable().optional(),
  remark: z.string().max(255).nullable().optional(),
  invoice_reference_id: z.string().max(39).nullable().optional(),
  credit: z.boolean().nullable().optional(),
  credit_reference_id: z.string().max(39).nullable().optional(),
  home_charging_compensation: z.boolean().nullable().optional(),
  last_updated: z.coerce.date(),
});

export const CdrDTOSchemaName = 'CdrDTOSchema';

/** Partial CDR for OCPI Receiver PATCH (if ever needed). */
export const CdrPatchSchema = CdrDTOSchema.partial();
export const CdrPatchSchemaName = 'CdrPatchSchema';

export const CdrResponseSchema = OcpiResponseSchema(CdrDTOSchema);
export const CdrResponseSchemaName = 'CdrResponseSchema';

export const PaginatedCdrResponseSchema = z.object({
  status_code: z.nativeEnum(OcpiResponseStatusCode),
  status_message: z.string().optional(),
  timestamp: z.coerce.date(),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(0).max(200),
  link: z.string(),
  data: z.array(CdrDTOSchema),
});
export const PaginatedCdrResponseSchemaName = 'PaginatedCdrResponse';

export type CdrDTO = z.infer<typeof CdrDTOSchema>;
export type CdrResponse = z.infer<typeof CdrResponseSchema>;
export type PaginatedCdrResponse = z.infer<typeof PaginatedCdrResponseSchema>;

// ── Persistence shape (DB entity, never sent over the wire) ─────────────────

import type { AuthMethod as AuthMethodType } from '../AuthMethod.js';
import type { TokenType } from '../TokenType.js';
import type { TariffDimensionType } from '../TariffDimensionType.js';
import type { CdrDimensionType } from '../CdrDimensionType.js';
import type { SignedData } from '../SignedData.js';

export interface CdrEntity {
  id: number;
  ocpiCdrId: string;
  countryCode: string;
  partyId: string;
  startDateTime: Date;
  endDateTime: Date;
  sessionId?: string | null;
  cdrToken: {
    uid: string;
    type: TokenType;
    party_id: string;
    contract_id: string;
    country_code: string;
  };
  authMethod: AuthMethodType;
  authorizationReference?: string | null;
  cdrLocation: {
    id: string;
    name?: string | null;
    address: string;
    city: string;
    postal_code?: string | null;
    state?: string | null;
    country: string;
    coordinates: { latitude: string; longitude: string };
    evse_uid: string;
    evse_id: string;
    connector_id: string;
    connector_standard: string;
    connector_format: string;
    connector_power_type: string;
  };
  meterId?: string | null;
  currency: string;
  tariffs: Array<{
    id: string;
    currency: string;
    elements: Array<{
      price_components: Array<{
        type: TariffDimensionType;
        price: number;
        vat?: number | null;
        step_size: number;
      }>;
    }>;
    party_id: string;
    country_code: string;
    last_updated: string;
  }>;
  chargingPeriods: Array<{
    start_date_time: Date;
    dimensions: Array<{ type: CdrDimensionType; volume: number }>;
    tariff_id?: string | null;
  }>;
  signedData?: SignedData | null;
  totalCost: { excl_vat: number; incl_vat?: number | null };
  totalFixedCost?: { excl_vat: number; incl_vat?: number | null } | null;
  totalEnergy: number;
  totalEnergyCost?: { excl_vat: number; incl_vat?: number | null } | null;
  totalTime: number;
  totalTimeCost?: { excl_vat: number; incl_vat?: number | null } | null;
  totalParkingTime?: number | null;
  totalParkingCost?: { excl_vat: number; incl_vat?: number | null } | null;
  totalReservationCost?: { excl_vat: number; incl_vat?: number | null } | null;
  remark?: string | null;
  invoiceReferenceId?: string | null;
  credit?: boolean | null;
  creditReferenceId?: string | null;
  homeChargingCompensation?: boolean | null;
  lastUpdated: Date;
  // Internal fields — excluded from OCPI response
  tenantId?: number;
  tenantPartnerId?: number;
  createdAt?: Date;
  updatedAt?: Date;
}
