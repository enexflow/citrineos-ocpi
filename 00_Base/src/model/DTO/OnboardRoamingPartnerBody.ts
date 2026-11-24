// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';

/**
 * Admin trigger body: OCPI identity + optional GET List pagination (Sender 8.2.1.1).
 */
export const OnboardRoamingPartnerBodySchema = z.object({
  ourCountryCode: z.string().min(2).max(2),
  ourPartyId: z.string().min(1).max(3),
  partnerCountryCode: z.string().min(2).max(2),
  partnerPartyId: z.string().min(1).max(3),
  roamingPartnerCountryCode: z
    .string()
    .regex(/^[A-Z]{2}$/, 'must be 2 uppercase letters'),
  roamingPartnerPartyId: z
    .string()
    .regex(/^[A-Za-z0-9]{3}$/, 'must be 3 alphanumeric characters'),
  roamingPartnerName: z.string().trim().min(1).max(100),
  // Strict YYYY-MM-DD (rejects time parts and impossible dates like 2026-02-30).
  roamingPartnerSignatureDate: z.string().date(),
  roamingPartnerContractStartDate: z.string().date(),
  roamingPartnerIsHdv: z.boolean().optional(),
});

export const OnboardRoamingPartnerBodySchemaName =
  'OnboardRoamingPartnerBodySchema';

export type OnboardRoamingPartnerBody = z.infer<
  typeof OnboardRoamingPartnerBodySchema
>;

/**
 * Billing details used to create a Pennylane company customer (TS API).
 * Shared by the roaming partner and tenant partner EMSP onboarding bodies.
 */
const PennylaneBillingShape = {
  // Values accepted by the TS API.
  paymentConditions: z.enum(['upon_receipt', '30_days']),
  emails: z.array(z.string().email()).min(1),
  billingAddress: z.object({
    address: z.string().trim().min(1),
    postalCode: z.string().trim().min(1),
    city: z.string().trim().min(1),
    countryAlpha2: z
      .string()
      .regex(/^[A-Z]{2}$/, 'must be 2 uppercase letters'),
  }),
  vatNumber: z
    .string()
    .regex(
      /^[A-Z]{2}[A-Z0-9]{2,13}$/,
      'must be a VAT number, e.g. FR32123456789',
    ),
  // Optional (the TS API accepts them missing); still format-checked when sent.
  regNo: z.string().trim().min(1).optional(),
  phone: z
    .string()
    .regex(/^\+?[0-9 .()-]{6,20}$/, 'must be a phone number')
    .optional(),
  recipient: z.string().trim().min(1).optional(),
  billingIban: z
    .string()
    .regex(/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/, 'must be an IBAN without spaces')
    .optional(),
  notes: z.string().trim().min(1).optional(),
  billingLanguage: z
    .string()
    .regex(/^[a-z]{2}_[A-Z]{2}$/, 'must be a locale, e.g. fr_FR'),
  reference: z.string().trim().min(1).optional(),
  externalReference: z.string().trim().min(1).optional(),
};

export type PennylaneBilling = z.infer<
  z.ZodObject<typeof PennylaneBillingShape>
>;

/**
 * EMSP onboarding body: roaming partner identity + the billing details used to
 * create its Pennylane company customer (TS API). The customer name is
 * roamingPartnerName.
 */
export const OnboardRoamingPartnerEmspBodySchema =
  OnboardRoamingPartnerBodySchema.extend({
    ...PennylaneBillingShape,
    // Gireve contract number, stored by the TS API on the OCPI partner link.
    contractNb: z.string().trim().min(1).max(100),
  });

export const OnboardRoamingPartnerEmspBodySchemaName =
  'OnboardRoamingPartnerEmspBodySchema';

export type OnboardRoamingPartnerEmspBody = z.infer<
  typeof OnboardRoamingPartnerEmspBodySchema
>;

/**
 * EMSP onboarding body for a direct (peer-to-peer) partner: the TenantPartner
 * identity + the billing details of its Pennylane company customer. The
 * TenantPartner itself comes from the credentials exchange and must already
 * exist. The customer name is tenantPartnerName.
 */
export const OnboardTenantPartnerEmspBodySchema =
  OnboardRoamingPartnerBodySchema.pick({
    ourCountryCode: true,
    ourPartyId: true,
    partnerCountryCode: true,
    partnerPartyId: true,
  }).extend({
    tenantPartnerName: z.string().trim().min(1).max(100),
    ...PennylaneBillingShape,
  });

export const OnboardTenantPartnerEmspBodySchemaName =
  'OnboardTenantPartnerEmspBodySchema';

export type OnboardTenantPartnerEmspBody = z.infer<
  typeof OnboardTenantPartnerEmspBodySchema
>;

/**
 * One row of a hub operations export (the Gireve CSV converted to JSON as is).
 * Only "Operation Emi3" (e.g. FR*S13) is required; "Operation Owner" is used
 * to pick a network out of the export.
 */
export const NetworkOperationSchema = z.object({
  // Upper-cased before the check: party ids are compared with a case-sensitive
  // _eq, so FR*s13 must not create a twin of FR*S13.
  'Operation Emi3': z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z]{2}\*[A-Z0-9]{3}$/,
      'must be an eMI3 operator id, e.g. FR*S13',
    ),
  // nullish: some CSV-to-JSON converters turn an empty cell into null.
  'Operation Name': z.string().nullish(),
  'Operation Owner': z.string().nullish(),
});

export type NetworkOperation = z.infer<typeof NetworkOperationSchema>;

/**
 * Operations per network call. EMSP: one synchronous TS API call per operation.
 * CPO: keeps the registration short. A bigger network is split into several
 * calls (CPO: wait for `Network pull completed` between two calls).
 */
export const NETWORK_MAX_OPERATIONS = 50;

/**
 * Shared by the network routes: every selected operation becomes one
 * RoamingPartner with the body's name and contract dates.
 */
const NetworkShape = {
  // Only the operations whose "Operation Owner" matches it (trimmed, case
  // insensitive) are onboarded. Required when the operations have several
  // owners, so two networks are never mixed by mistake.
  operationOwner: z.string().trim().min(1).optional(),
  operations: z
    .array(NetworkOperationSchema)
    .min(1)
    .max(
      NETWORK_MAX_OPERATIONS,
      `at most ${NETWORK_MAX_OPERATIONS} operations per call; split the network into several calls with the same body`,
    )
    .superRefine((operations, ctx) => {
      const seen = new Set<string>();
      operations.forEach((operation, index) => {
        const id = operation['Operation Emi3'];
        if (seen.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'Operation Emi3'],
            message: `duplicate operation ${id}`,
          });
        }
        seen.add(id);
      });
    }),
};

const NetworkIdentitySchema = OnboardRoamingPartnerBodySchema.omit({
  roamingPartnerCountryCode: true,
  roamingPartnerPartyId: true,
});

/**
 * CPO network onboarding: one RoamingPartner (role CPO) per operation, then a
 * background pull of tariffs and locations, one partner after another.
 */
export const OnboardRoamingNetworkCpoBodySchema = NetworkIdentitySchema.extend({
  ...NetworkShape,
  // Also pull the operations that were already onboarded (e.g. to finish a
  // network pull interrupted by a restart).
  forcePull: z.boolean().optional(),
});

export const OnboardRoamingNetworkCpoBodySchemaName =
  'OnboardRoamingNetworkCpoBodySchema';

export type OnboardRoamingNetworkCpoBody = z.infer<
  typeof OnboardRoamingNetworkCpoBodySchema
>;

/**
 * EMSP network onboarding: one RoamingPartner (role EMSP) per operation, all
 * linked to the same Pennylane customer (named roamingPartnerName).
 */
export const OnboardRoamingNetworkEmspBodySchema = NetworkIdentitySchema.extend(
  {
    ...NetworkShape,
    ...PennylaneBillingShape,
    contractNb: z.string().trim().min(1).max(100),
  },
);

export const OnboardRoamingNetworkEmspBodySchemaName =
  'OnboardRoamingNetworkEmspBodySchema';

export type OnboardRoamingNetworkEmspBody = z.infer<
  typeof OnboardRoamingNetworkEmspBodySchema
>;

export type PullSummary = {
  module: string;
  processed: number;
  upsertSucceeded: number;
  upsertFailed: number;
  skippedInvalid: number;
  LocationsMarkedRemoved?: number;
  LocationsMarkedRemovedFailed?: number;
};

export const PullSummarySchema = z.object({
  module: z.string(),
  processed: z.number(),
  upsertSucceeded: z.number(),
  upsertFailed: z.number(),
  skippedInvalid: z.number(),
  LocationsMarkedRemoved: z.number().optional(),
  LocationsMarkedRemovedFailed: z.number().optional(),
});
