// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { OcpiResponseSchema } from '../OcpiResponse.js';
import { VersionDTOSchema } from './VersionDTO.js';
import { VersionNumber } from '../VersionNumber.js';
import { z } from 'zod';

const KNOWN_VERSIONS = new Set<string>(Object.values(VersionNumber));

export const VersionListResponseDTOSchema = OcpiResponseSchema(
  z.preprocess(
    (val) =>
      Array.isArray(val)
        ? val.filter((v) => KNOWN_VERSIONS.has(v?.version))
        : val,
    z.array(VersionDTOSchema),
  ),
);
export const VersionListResponseDTOSchemaName = 'VersionListResponseDTOSchema';

export type VersionListResponseDTO = z.infer<
  typeof VersionListResponseDTOSchema
>;
