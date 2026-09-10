// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// Matches operator-ui's window.APP_CONFIG runtime-override pattern so the
// Docker image can be configured per-environment without a rebuild.
declare global {
  interface Window {
    APP_CONFIG?: Record<string, string>;
  }
}

export function readEnv(key: string): string | undefined {
  return (
    window.APP_CONFIG?.[key] ??
    (import.meta.env as Record<string, string | undefined>)[key]
  );
}
