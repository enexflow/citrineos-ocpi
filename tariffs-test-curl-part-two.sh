#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
#
# SPDX-License-Identifier: Apache-2.0

# Tariffs module OCPI 2.2.1 - test curl commands with assertions
#
# Every PUT is followed by a GET that asserts the expected fields.
# Tests cover: full tariff round-trip, TariffElements, all new columns,
# update via PUT, DELETE, error cases.
#
# In this test:
#   - Our platform acts as eMSP: FR/FLO (the Tenant)
#   - Partner CPO: FR/ZTA (the TenantPartner)
#
# Usage:
#   chmod +x tariffs-test-curls.sh
#   ./tariffs-test-curls.sh

OCPI_BASE="${OCPI_BASE:-http://127.0.0.1:8085/ocpi}"
OCPI_VERSION="${OCPI_VERSION:-2.2.1}"
RECEIVER_PREFIX="$OCPI_BASE/emsp/$OCPI_VERSION"
BASE_URL="$RECEIVER_PREFIX/tariffs/FR/ZTA"

AUTH_TOKEN="Token NGVlZDhlYWItMjZkYS00YTExLWEzNzEtYjQzZGM5YWNiNGYw"
OCPI_HEADERS=(
  -H "Authorization: $AUTH_TOKEN"
  -H "X-Request-ID: $(uuidgen 2>/dev/null || echo test-req-001)"
  -H "X-Correlation-ID: $(uuidgen 2>/dev/null || echo test-corr-001)"
  -H "OCPI-from-country-code: FR"
  -H "OCPI-from-party-id: ZTA"
  -H "OCPI-to-country-code: NL"
  -H "OCPI-to-party-id: MIE"
)

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

PASS=0
FAIL=0

separator() {
  echo ""
  echo -e "${CYAN}════════════════════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}  $1${RESET}"
  echo -e "${CYAN}════════════════════════════════════════════════════════════${RESET}"
}

do_curl() {
  local expected_http="$1"
  shift

  local tmp
  tmp=$(mktemp)

  local http_code
  http_code=$(curl -sS -w "%{http_code}" -o "$tmp" "$@" 2>&1) || {
    echo -e "${RED}  Connection error — is the server running?${RESET}" >&2
    FAIL=$((FAIL + 1))
    rm -f "$tmp"
    echo ""
    return
  }

  if [ "$http_code" = "$expected_http" ]; then
    echo -e "  ${GREEN}HTTP $http_code${RESET}  ${DIM}(expected $expected_http)${RESET}" >&2
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}HTTP $http_code${RESET}  ${YELLOW}(expected $expected_http)${RESET}" >&2
    FAIL=$((FAIL + 1))
  fi

  local body
  body=$(cat "$tmp")
  rm -f "$tmp"
  echo "$body"
}

assert_field() {
  local body="$1"
  local path="$2"
  local expected="$3"

  local actual
  actual=$(echo "$body" | python3 -c "
import sys, json
data = json.load(sys.stdin)
keys = '$path'.split('.')
val = data
try:
    for k in keys:
        val = val[int(k)] if k.lstrip('-').isdigit() else val[k]
    print(val if not isinstance(val, bool) else str(val).lower())
except (KeyError, IndexError, TypeError):
    print('__MISSING__')
" 2>/dev/null)

  if [ "$actual" = "$expected" ]; then
    echo -e "    ${GREEN}✓${RESET} ${DIM}$path${RESET} = ${GREEN}$actual${RESET}"
    PASS=$((PASS + 1))
  else
    echo -e "    ${RED}✗${RESET} ${DIM}$path${RESET}: expected ${GREEN}$expected${RESET}, got ${RED}$actual${RESET}"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local body="$1"
  local path="$2"
  local expected="$3"

  local found
  found=$(echo "$body" | python3 -c "
import sys, json
data = json.load(sys.stdin)
keys = '$path'.split('.')
val = data
try:
    for k in keys:
        val = val[int(k)] if k.lstrip('-').isdigit() else val[k]
    print('true' if '$expected' in [str(x) for x in val] else 'false')
except (KeyError, TypeError):
    print('false')
" 2>/dev/null)

  if [ "$found" = "true" ]; then
    echo -e "    ${GREEN}✓${RESET} ${DIM}$path${RESET} contains ${GREEN}$expected${RESET}"
    PASS=$((PASS + 1))
  else
    echo -e "    ${RED}✗${RESET} ${DIM}$path${RESET} does not contain ${RED}$expected${RESET}"
    FAIL=$((FAIL + 1))
  fi
}

assert_length() {
  local body="$1"
  local path="$2"
  local expected="$3"

  local actual
  actual=$(echo "$body" | python3 -c "
import sys, json
data = json.load(sys.stdin)
keys = '$path'.split('.')
val = data
try:
    for k in keys:
        val = val[int(k)] if k.lstrip('-').isdigit() else val[k]
    print(len(val))
except (KeyError, TypeError):
    print(-1)
" 2>/dev/null)

  if [ "$actual" = "$expected" ]; then
    echo -e "    ${GREEN}✓${RESET} ${DIM}$path${RESET} has length ${GREEN}$actual${RESET}"
    PASS=$((PASS + 1))
  else
    echo -e "    ${RED}✗${RESET} ${DIM}$path${RESET}: expected length ${GREEN}$expected${RESET}, got ${RED}$actual${RESET}"
    FAIL=$((FAIL + 1))
  fi
}

assert_ocpi_error() {
  local body="$1"
  local label="$2"

  local actual_status
  actual_status=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status_code',''))" 2>/dev/null)
  if [ "$actual_status" != "1000" ]; then
    echo -e "    ${GREEN}✓${RESET} $label — OCPI status_code $actual_status (error as expected)"
    PASS=$((PASS + 1))
  else
    echo -e "    ${RED}✗${RESET} $label — expected error status_code, got 1000"
    FAIL=$((FAIL + 1))
  fi
}

assert_ocpi_success() {
  local body="$1"
  local label="$2"

  local actual_status
  actual_status=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status_code',''))" 2>/dev/null)
  if [ "$actual_status" = "1000" ]; then
    echo -e "    ${GREEN}✓${RESET} $label — OCPI status_code 1000"
    PASS=$((PASS + 1))
  else
    echo -e "    ${RED}✗${RESET} $label — expected 1000, got $actual_status"
    FAIL=$((FAIL + 1))
  fi
}

assert_null_or_missing() {
  local body="$1"
  local path="$2"

  local actual
  actual=$(echo "$body" | python3 -c "
import sys, json
data = json.load(sys.stdin)
keys = '$path'.split('.')
val = data
try:
    for k in keys:
        val = val[int(k)] if k.lstrip('-').isdigit() else val[k]
    print('null' if val is None else str(val))
except (KeyError, IndexError, TypeError):
    print('__MISSING__')
" 2>/dev/null)

  if [ "$actual" = "__MISSING__" ] || [ "$actual" = "null" ]; then
    echo -e "    ${GREEN}✓${RESET} ${DIM}$path${RESET} is null/missing (as expected)"
    PASS=$((PASS + 1))
  else
    echo -e "    ${RED}✗${RESET} ${DIM}$path${RESET}: expected null/missing, got ${RED}$actual${RESET}"
    FAIL=$((FAIL + 1))
  fi
}

# ===========================================================================
# PHASE 1 — PUT minimal tariff, GET and assert
# ===========================================================================

separator "1. PUT TARIFF-MINIMAL — Minimal valid tariff (currency + 1 element)"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-MINIMAL" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-MINIMAL",
    "country_code": "FR",
    "party_id": "ZTA",
    "currency": "EUR",
    "elements": [
      {
        "price_components": [
          { "type": "ENERGY", "price": 0.25, "vat": 10.0, "step_size": 1 }
        ]
      }
    ],
    "last_updated": "2026-01-01T00:00:00Z"
  }')
assert_ocpi_success "$body" "PUT TARIFF-MINIMAL"

separator "2. GET TARIFF-MINIMAL — Assert minimal round-trip"
body=$(do_curl 200 "$BASE_URL/TARIFF-MINIMAL" "${OCPI_HEADERS[@]}")
assert_field   "$body" "data.id"                              "TARIFF-MINIMAL"
assert_field   "$body" "data.country_code"                    "FR"
assert_field   "$body" "data.party_id"                        "ZTA"
assert_field   "$body" "data.currency"                        "EUR"
assert_length  "$body" "data.elements"                        "1"
assert_field   "$body" "data.elements.0.price_components.0.type"     "ENERGY"
assert_field   "$body" "data.elements.0.price_components.0.price"    "0.25"
assert_field   "$body" "data.elements.0.price_components.0.vat"      "10.0"
assert_field   "$body" "data.elements.0.price_components.0.step_size" "1"
assert_null_or_missing "$body" "data.type"
assert_null_or_missing "$body" "data.tariff_alt_url"
assert_null_or_missing "$body" "data.min_price"
assert_null_or_missing "$body" "data.max_price"
assert_null_or_missing "$body" "data.energy_mix"

# ===========================================================================
# PHASE 2 — PUT full tariff with all fields, GET and assert
# ===========================================================================

separator "3. PUT TARIFF-FULL — Full tariff with all OCPI 2.2.1 fields"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-FULL" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-FULL",
    "country_code": "FR",
    "party_id": "ZTA",
    "currency": "EUR",
    "type": "REGULAR",
    "tariff_alt_text": [
      { "language": "en", "text": "Complex tariff with tiered pricing." },
      { "language": "fr", "text": "Tarif complexe avec prix par palier." }
    ],
    "tariff_alt_url": "https://www.example-cpo.fr/tariffs/TARIFF-FULL",
    "min_price": { "excl_vat": 0.50, "incl_vat": 0.55 },
    "max_price": { "excl_vat": 50.00, "incl_vat": 55.00 },
    "elements": [
      {
        "price_components": [
          { "type": "FLAT", "price": 4.00, "vat": 20.0, "step_size": 1 }
        ],
        "restrictions": { "reservation": "RESERVATION_EXPIRES" }
      },
      {
        "price_components": [
          { "type": "FLAT", "price": 2.00, "vat": 20.0, "step_size": 1 },
          { "type": "TIME", "price": 3.00, "vat": 20.0, "step_size": 300 }
        ],
        "restrictions": { "reservation": "RESERVATION" }
      },
      {
        "price_components": [
          { "type": "FLAT", "price": 0.50, "vat": 20.0, "step_size": 1 }
        ]
      },
      {
        "price_components": [
          { "type": "ENERGY", "price": 0.20, "vat": 10.0, "step_size": 1 }
        ],
        "restrictions": { "max_power": 16.0 }
      },
      {
        "price_components": [
          { "type": "ENERGY", "price": 0.35, "vat": 10.0, "step_size": 1 }
        ],
        "restrictions": { "min_power": 16.0, "max_power": 32.0 }
      },
      {
        "price_components": [
          { "type": "ENERGY", "price": 0.50, "vat": 10.0, "step_size": 1 }
        ],
        "restrictions": { "min_power": 32.0 }
      },
      {
        "price_components": [
          { "type": "TIME", "price": 1.00, "vat": 20.0, "step_size": 900 }
        ],
        "restrictions": { "start_time": "00:00", "end_time": "17:00", "max_current": 32.0 }
      },
      {
        "price_components": [
          { "type": "TIME", "price": 2.00, "vat": 20.0, "step_size": 600 }
        ],
        "restrictions": {
          "start_time": "17:00", "end_time": "00:00", "min_current": 32.0,
          "day_of_week": ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]
        }
      },
      {
        "price_components": [
          { "type": "TIME", "price": 1.25, "vat": 20.0, "step_size": 600 }
        ],
        "restrictions": { "min_current": 32.0, "day_of_week": ["SATURDAY", "SUNDAY"] }
      },
      {
        "price_components": [
          { "type": "PARKING_TIME", "price": 5.00, "vat": 10.0, "step_size": 300 }
        ],
        "restrictions": {
          "start_time": "09:00", "end_time": "18:00",
          "day_of_week": ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
          "min_duration": 0, "max_duration": 3600
        }
      },
      {
        "price_components": [
          { "type": "PARKING_TIME", "price": 8.00, "vat": 10.0, "step_size": 300 }
        ],
        "restrictions": {
          "start_time": "09:00", "end_time": "18:00",
          "day_of_week": ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
          "min_duration": 3600
        }
      },
      {
        "price_components": [
          { "type": "PARKING_TIME", "price": 6.00, "vat": 10.0, "step_size": 300 }
        ],
        "restrictions": { "start_time": "10:00", "end_time": "17:00", "day_of_week": ["SATURDAY"] }
      }
    ],
    "start_date_time": "2026-04-01T00:00:00Z",
    "end_date_time": "2026-12-31T23:59:59Z",
    "energy_mix": {
      "is_green_energy": false,
      "energy_sources": [
        { "source": "NUCLEAR", "percentage": 70.0 },
        { "source": "GENERAL_GREEN", "percentage": 20.0 },
        { "source": "GAS", "percentage": 7.0 },
        { "source": "GENERAL_FOSSIL", "percentage": 3.0 }
      ],
      "environ_impact": [
        { "category": "NUCLEAR_WASTE", "amount": 0.0017 },
        { "category": "CARBON_DIOXIDE", "amount": 58 }
      ],
      "supplier_name": "EDF",
      "energy_product_name": "EDF Tarif Bleu"
    },
    "last_updated": "2026-04-01T00:00:00Z"
  }')
assert_ocpi_success "$body" "PUT TARIFF-FULL"

separator "4. GET TARIFF-FULL — Assert full round-trip"
body=$(do_curl 200 "$BASE_URL/TARIFF-FULL" "${OCPI_HEADERS[@]}")
echo "  -- core fields --"
assert_field   "$body" "data.id"                              "TARIFF-FULL"
assert_field   "$body" "data.currency"                        "EUR"
assert_field   "$body" "data.type"                            "REGULAR"
assert_field   "$body" "data.tariff_alt_url"                  "https://www.example-cpo.fr/tariffs/TARIFF-FULL"
echo "  -- tariff_alt_text --"
assert_field   "$body" "data.tariff_alt_text.0.language"      "en"
assert_field   "$body" "data.tariff_alt_text.1.language"      "fr"
echo "  -- min/max price --"
assert_field   "$body" "data.min_price.excl_vat"              "0.5"
assert_field   "$body" "data.min_price.incl_vat"              "0.55"
assert_field   "$body" "data.max_price.excl_vat"              "50"
assert_field   "$body" "data.max_price.incl_vat"              "55"
echo "  -- energy_mix --"
assert_field   "$body" "data.energy_mix.is_green_energy"      "false"
assert_field   "$body" "data.energy_mix.supplier_name"        "EDF"
assert_field   "$body" "data.energy_mix.energy_product_name"  "EDF Tarif Bleu"
assert_length  "$body" "data.energy_mix.energy_sources"       "4"
assert_length  "$body" "data.energy_mix.environ_impact"       "2"
echo "  -- date range --"
assert_field   "$body" "data.start_date_time"                 "2026-04-01T00:00:00.000Z"
assert_field   "$body" "data.end_date_time"                   "2026-12-31T23:59:59.000Z"
echo "  -- elements (12 total) --"
assert_length  "$body" "data.elements"                        "12"
echo "  -- element 0: FLAT RESERVATION_EXPIRES --"
assert_field   "$body" "data.elements.0.price_components.0.type"           "FLAT"
assert_field   "$body" "data.elements.0.price_components.0.price"          "4"
assert_field   "$body" "data.elements.0.restrictions.reservation"          "RESERVATION_EXPIRES"
echo "  -- element 1: FLAT+TIME RESERVATION --"
assert_length  "$body" "data.elements.1.price_components"                  "2"
assert_field   "$body" "data.elements.1.restrictions.reservation"          "RESERVATION"
echo "  -- element 2: FLAT no restriction --"
assert_field   "$body" "data.elements.2.price_components.0.type"           "FLAT"
assert_field   "$body" "data.elements.2.price_components.0.price"          "0.5"
echo "  -- element 3: ENERGY max_power 16 --"
assert_field   "$body" "data.elements.3.price_components.0.type"           "ENERGY"
assert_field   "$body" "data.elements.3.price_components.0.price"          "0.2"
assert_field   "$body" "data.elements.3.restrictions.max_power"            "16"
echo "  -- element 4: ENERGY 16-32kW --"
assert_field   "$body" "data.elements.4.restrictions.min_power"            "16"
assert_field   "$body" "data.elements.4.restrictions.max_power"            "32"
echo "  -- element 5: ENERGY min_power 32 --"
assert_field   "$body" "data.elements.5.restrictions.min_power"            "32"
echo "  -- element 6: TIME with time window --"
assert_field   "$body" "data.elements.6.price_components.0.type"           "TIME"
assert_field   "$body" "data.elements.6.restrictions.start_time"           "00:00"
assert_field   "$body" "data.elements.6.restrictions.end_time"             "17:00"
assert_field   "$body" "data.elements.6.restrictions.max_current"          "32"
echo "  -- element 7: TIME weekday evening --"
assert_contains "$body" "data.elements.7.restrictions.day_of_week"         "MONDAY"
assert_contains "$body" "data.elements.7.restrictions.day_of_week"         "FRIDAY"
echo "  -- element 8: TIME weekend --"
assert_contains "$body" "data.elements.8.restrictions.day_of_week"         "SATURDAY"
assert_contains "$body" "data.elements.8.restrictions.day_of_week"         "SUNDAY"
echo "  -- element 9: PARKING_TIME weekday with max_duration --"
assert_field   "$body" "data.elements.9.price_components.0.type"           "PARKING_TIME"
assert_field   "$body" "data.elements.9.price_components.0.price"          "5"
assert_field   "$body" "data.elements.9.restrictions.min_duration"         "0"
assert_field   "$body" "data.elements.9.restrictions.max_duration"         "3600"
echo "  -- element 10: PARKING_TIME weekday after 1h --"
assert_field   "$body" "data.elements.10.price_components.0.price"         "8"
assert_field   "$body" "data.elements.10.restrictions.min_duration"        "3600"
echo "  -- element 11: PARKING_TIME Saturday --"
assert_field   "$body" "data.elements.11.price_components.0.price"         "6"
assert_contains "$body" "data.elements.11.restrictions.day_of_week"        "SATURDAY"

# ===========================================================================
# PHASE 3 — PUT again (idempotency), assert no element duplication
# ===========================================================================

separator "5. PUT TARIFF-FULL again — Assert idempotency (no element duplication)"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-FULL" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-FULL",
    "country_code": "FR",
    "party_id": "ZTA",
    "currency": "EUR",
    "type": "REGULAR",
    "elements": [
      {
        "price_components": [
          { "type": "ENERGY", "price": 0.25, "vat": 10.0, "step_size": 1 }
        ]
      }
    ],
    "last_updated": "2026-04-02T00:00:00Z"
  }')
assert_ocpi_success "$body" "PUT TARIFF-FULL idempotent"

separator "6. GET TARIFF-FULL — Assert exactly 1 element after re-PUT"
body=$(do_curl 200 "$BASE_URL/TARIFF-FULL" "${OCPI_HEADERS[@]}")
assert_length  "$body" "data.elements"                        "1"
assert_field   "$body" "data.elements.0.price_components.0.type"  "ENERGY"
assert_field   "$body" "data.elements.0.price_components.0.price" "0.25"
assert_null_or_missing "$body" "data.type"

# ===========================================================================
# PHASE 4 — PUT with type update, assert type changes
# ===========================================================================

separator "7. PUT TARIFF-FULL — Update type to AD_HOC_PAYMENT"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-FULL" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-FULL",
    "country_code": "FR",
    "party_id": "ZTA",
    "currency": "EUR",
    "type": "AD_HOC_PAYMENT",
    "elements": [
      {
        "price_components": [
          { "type": "TIME", "price": 2.00, "vat": 20.0, "step_size": 60 }
        ]
      }
    ],
    "last_updated": "2026-04-03T00:00:00Z"
  }')
assert_ocpi_success "$body" "PUT TARIFF-FULL type update"

separator "8. GET TARIFF-FULL — Assert type updated to AD_HOC_PAYMENT"
body=$(do_curl 200 "$BASE_URL/TARIFF-FULL" "${OCPI_HEADERS[@]}")
assert_field   "$body" "data.type"                            "AD_HOC_PAYMENT"
assert_field   "$body" "data.elements.0.price_components.0.type"  "TIME"
assert_field   "$body" "data.elements.0.price_components.0.price" "2.0"
assert_length  "$body" "data.elements"                        "1"

# ===========================================================================
# PHASE 5 — PUT free tariff, assert
# ===========================================================================

separator "9. PUT TARIFF-FREE — Free of charge tariff"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-FREE" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-FREE",
    "country_code": "FR",
    "party_id": "ZTA",
    "currency": "EUR",
    "elements": [
      {
        "price_components": [
          { "type": "FLAT", "price": 0.00, "step_size": 1 }
        ]
      }
    ],
    "last_updated": "2026-01-01T00:00:00Z"
  }')
assert_ocpi_success "$body" "PUT TARIFF-FREE"

separator "10. GET TARIFF-FREE — Assert free tariff"
body=$(do_curl 200 "$BASE_URL/TARIFF-FREE" "${OCPI_HEADERS[@]}")
assert_field   "$body" "data.id"                              "TARIFF-FREE"
assert_field   "$body" "data.elements.0.price_components.0.type"  "FLAT"
assert_field   "$body" "data.elements.0.price_components.0.price" "0.0"
assert_length  "$body" "data.elements"                        "1"

# ===========================================================================
# PHASE 6 — PUT tariff with reservation elements
# ===========================================================================

separator "11. PUT TARIFF-RESERVATION — Tariff with reservation + expiry pricing"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-RESERVATION" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-RESERVATION",
    "country_code": "FR",
    "party_id": "ZTA",
    "currency": "EUR",
    "type": "REGULAR",
    "elements": [
      {
        "price_components": [
          { "type": "FLAT", "price": 4.00, "vat": 20.0, "step_size": 1 }
        ],
        "restrictions": { "reservation": "RESERVATION_EXPIRES" }
      },
      {
        "price_components": [
          { "type": "FLAT", "price": 2.00, "vat": 20.0, "step_size": 1 },
          { "type": "TIME", "price": 3.00, "vat": 20.0, "step_size": 300 }
        ],
        "restrictions": { "reservation": "RESERVATION" }
      },
      {
        "price_components": [
          { "type": "FLAT", "price": 0.50, "vat": 20.0, "step_size": 1 },
          { "type": "ENERGY", "price": 0.30, "vat": 10.0, "step_size": 1 }
        ]
      }
    ],
    "last_updated": "2026-01-01T00:00:00Z"
  }')
assert_ocpi_success "$body" "PUT TARIFF-RESERVATION"

separator "12. GET TARIFF-RESERVATION — Assert reservation elements"
body=$(do_curl 200 "$BASE_URL/TARIFF-RESERVATION" "${OCPI_HEADERS[@]}")
assert_length  "$body" "data.elements"                        "3"
assert_field   "$body" "data.elements.0.restrictions.reservation" "RESERVATION_EXPIRES"
assert_field   "$body" "data.elements.0.price_components.0.type"  "FLAT"
assert_field   "$body" "data.elements.0.price_components.0.price" "4"
assert_field   "$body" "data.elements.1.restrictions.reservation" "RESERVATION"
assert_length  "$body" "data.elements.1.price_components"         "2"
assert_field   "$body" "data.elements.1.price_components.1.type"  "TIME"
assert_length  "$body" "data.elements.2.price_components"         "2"

# ===========================================================================
# PHASE 7 — DELETE tariff, assert gone
# ===========================================================================

separator "13. DELETE TARIFF-MINIMAL — Delete the minimal tariff"
body=$(do_curl 200 \
  -X DELETE "$BASE_URL/TARIFF-MINIMAL" \
  "${OCPI_HEADERS[@]}")
assert_ocpi_success "$body" "DELETE TARIFF-MINIMAL"

separator "14. GET TARIFF-MINIMAL — Assert 404/OCPI error after delete"
body=$(do_curl 200 "$BASE_URL/TARIFF-MINIMAL" "${OCPI_HEADERS[@]}")
assert_ocpi_error "$body" "GET deleted tariff"

separator "15. DELETE TARIFF-FREE — Delete free tariff"
body=$(do_curl 200 \
  -X DELETE "$BASE_URL/TARIFF-FREE" \
  "${OCPI_HEADERS[@]}")
assert_ocpi_success "$body" "DELETE TARIFF-FREE"

separator "16. DELETE TARIFF-RESERVATION — Delete reservation tariff"
body=$(do_curl 200 \
  -X DELETE "$BASE_URL/TARIFF-RESERVATION" \
  "${OCPI_HEADERS[@]}")
assert_ocpi_success "$body" "DELETE TARIFF-RESERVATION"

# ===========================================================================
# PHASE 8 — Error cases
# ===========================================================================

separator "17. GET TARIFF-NONEXISTENT — Unknown tariff (expect OCPI error)"
body=$(do_curl 200 "$BASE_URL/TARIFF-NONEXISTENT" "${OCPI_HEADERS[@]}")
assert_ocpi_error "$body" "GET unknown tariff"

separator "18. DELETE TARIFF-NONEXISTENT — Delete unknown tariff (expect OCPI error)"
body=$(do_curl 200 \
  -X DELETE "$BASE_URL/TARIFF-NONEXISTENT" \
  "${OCPI_HEADERS[@]}")
assert_ocpi_error "$body" "DELETE unknown tariff"

separator "19. PUT TARIFF-INVALID — Missing required currency (expect error)"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-INVALID" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-INVALID",
    "country_code": "FR",
    "party_id": "ZTA",
    "elements": [],
    "last_updated": "2026-01-01T00:00:00Z"
  }')
assert_ocpi_error "$body" "PUT tariff missing currency"

separator "20. PUT TARIFF-INVALID — Missing required elements (expect error)"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-INVALID2" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-INVALID2",
    "country_code": "FR",
    "party_id": "ZTA",
    "currency": "EUR",
    "last_updated": "2026-01-01T00:00:00Z"
  }')
assert_ocpi_error "$body" "PUT tariff missing elements"

# ===========================================================================
# PHASE 9 — Cleanup TARIFF-FULL
# ===========================================================================

separator "21. DELETE TARIFF-FULL — Cleanup"
body=$(do_curl 200 \
  -X DELETE "$BASE_URL/TARIFF-FULL" \
  "${OCPI_HEADERS[@]}")
assert_ocpi_success "$body" "DELETE TARIFF-FULL cleanup"

separator "22. GET TARIFF-FULL — Confirm deleted"
body=$(do_curl 200 "$BASE_URL/TARIFF-FULL" "${OCPI_HEADERS[@]}")
assert_ocpi_error "$body" "GET TARIFF-FULL after delete"

# ===========================================================================
# Summary
# ===========================================================================

echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  RESULTS${RESET}"
echo -e "${CYAN}════════════════════════════════════════════════════════════${RESET}"
echo -e "  ${GREEN}PASS: $PASS${RESET}   ${RED}FAIL: $FAIL${RESET}   TOTAL: $((PASS + FAIL))"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi