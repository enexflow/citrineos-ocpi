// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/// <reference types="vite/client" />
/// <reference types="vite-plugin-vue-layouts-next/client" />

interface ImportMetaEnv {
  readonly VITE_GRAPHQL_URL: string;
  readonly VITE_HASURA_TARGET: string;
  readonly VITE_HASURA_ADMIN_SECRET?: string;
  readonly VITE_OCPI_BASE?: string;
  readonly VITE_OCPI_TARGET?: string;
  readonly VITE_OCPI_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
