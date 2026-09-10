#!/bin/sh
# SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
#
# SPDX-License-Identifier: Apache-2.0

# Generate config.js from environment variables so the same image can be
# deployed across environments without a rebuild (mirrors operator-ui).
cat > /app/dist/config.js <<EOF
window.APP_CONFIG = {
  VITE_GRAPHQL_URL: "${VITE_GRAPHQL_URL:-}",
  VITE_HASURA_ADMIN_SECRET: "${VITE_HASURA_ADMIN_SECRET:-}",
  VITE_OCPI_BASE: "${VITE_OCPI_BASE:-}",
  VITE_OCPI_VERSION: "${VITE_OCPI_VERSION:-2.2.1}",
  VITE_KEYCLOAK_URL: "${VITE_KEYCLOAK_URL:-}",
  VITE_KEYCLOAK_REALM: "${VITE_KEYCLOAK_REALM:-}",
  VITE_KEYCLOAK_CLIENT_ID: "${VITE_KEYCLOAK_CLIENT_ID:-ocpi-monitor}"
};
EOF

exec serve -s dist -l 3000
