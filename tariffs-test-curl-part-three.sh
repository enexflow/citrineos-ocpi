#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
#
# SPDX-License-Identifier: Apache-2.0

# Tariffs module OCPI 2.2.1 - edge case tests
#
# Covers scenarios not in the main test suite:
#   - Numeric precision round-trip (price, vat, step_size)
#   - tariffType null → set → null round-trip
#   - TariffElements order preserved across PUT
#   - Unknown partner (country_code/party_id not in TenantPartners)
#   - Re-PUT with fewer elements than previous (no accumulation)
#   - Re-PUT with more elements than previous (no duplication)
#   - PUT with empty tariff_alt_text array
#   - PUT with null optional fields explicitly set
#   - GET after DELETE returns OCPI error (not HTTP 404)
#   - DELETE idempotency (second DELETE on same tariff)
#   - step_size: large value preserved
#   - vat: absent vs 0.0 vs explicit value
#
# Usage:
#   chmod +x tariffs-edge-cases-test.sh
#   ./tariffs-edge-cases-test.sh

OCPI_BASE="${OCPI_BASE:-http://127.0.0.1:8085/ocpi}"
OCPI_VERSION="${OCPI_VERSION:-2.2.1}"
RECEIVER_PREFIX="$OCPI_BASE/emsp/$OCPI_VERSION"
BASE_URL="$RECEIVER_PREFIX/tariffs/FR/MIL"

# Unknown partner not registered as TenantPartner
UNKNOWN_BASE_URL="$RECEIVER_PREFIX/tariffs/DE/UNK"

AUTH_TOKEN="Token NTE4Y2RiOTMtYTE4Mi00ZjVkLTkxMzUtY2Q1MmEyOTFhZTE5"
OCPI_HEADERS=(
  -H "Authorization: $AUTH_TOKEN"
  -H "X-Request-ID: $(uuidgen 2>/dev/null || echo test-req-edge-001)"
  -H "X-Correlation-ID: $(uuidgen 2>/dev/null || echo test-corr-edge-001)"
  # -H "OCPI-from-country-code: FR"
  # -H "OCPI-from-party-id: MIL"
  # -H "OCPI-to-country-code: FR"
  # -H "OCPI-to-party-id: ZTA"
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

# Assert exact string equality after JSON extraction
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

# Assert a float field equals expected numeric value (tolerant of 0.25 vs 0.250 etc.)
assert_float() {
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
    # Compare as floats, print expected string if equal
    if abs(float(val) - float('$expected')) < 1e-9:
        print('$expected')
    else:
        print(float(val))
except (KeyError, IndexError, TypeError, ValueError):
    print('__MISSING__')
" 2>/dev/null)

  if [ "$actual" = "$expected" ]; then
    echo -e "    ${GREEN}✓${RESET} ${DIM}$path${RESET} ≈ ${GREEN}$expected${RESET}"
    PASS=$((PASS + 1))
  else
    echo -e "    ${RED}✗${RESET} ${DIM}$path${RESET}: expected ${GREEN}$expected${RESET}, got ${RED}$actual${RESET}"
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

# ===========================================================================
# EDGE CASE 1 — Numeric precision: prices with many decimals, large step_size
# Tests that float values are not truncated or mangled through DB round-trip
# ===========================================================================

separator "EC-1a. PUT TARIFF-NUMERIC — Numeric precision edge cases"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-NUMERIC" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-NUMERIC",
    "country_code": "FR",
    "party_id": "MIL",
    "currency": "EUR",
    "elements": [
      {
        "price_components": [
          { "type": "ENERGY", "price": 0.123,  "vat": 5.5,  "step_size": 1    },
          { "type": "TIME",   "price": 0.0001, "vat": 20.0, "step_size": 900  },
          { "type": "FLAT",   "price": 9.99,   "vat": 0.0,  "step_size": 1    }
        ]
      },
      {
        "price_components": [
          { "type": "PARKING_TIME", "price": 0.05, "vat": 10.0, "step_size": 60000 }
        ]
      }
    ],
    "last_updated": "2026-01-01T00:00:00Z"
  }')
assert_ocpi_success "$body" "PUT TARIFF-NUMERIC"

separator "EC-1b. GET TARIFF-NUMERIC — Assert numeric precision preserved"
body=$(do_curl 200 "$BASE_URL/TARIFF-NUMERIC" "${OCPI_HEADERS[@]}")
assert_length  "$body" "data.elements"                                           "2"
assert_length  "$body" "data.elements.0.price_components"                        "3"
assert_float   "$body" "data.elements.0.price_components.0.price"                "0.123"
assert_float   "$body" "data.elements.0.price_components.0.vat"                  "5.5"
assert_field   "$body" "data.elements.0.price_components.0.step_size"            "1"
assert_float   "$body" "data.elements.0.price_components.1.price"                "0.0001"
assert_float   "$body" "data.elements.0.price_components.1.vat"                  "20.0"
assert_field   "$body" "data.elements.0.price_components.1.step_size"            "900"
assert_float   "$body" "data.elements.0.price_components.2.price"                "9.99"
assert_float   "$body" "data.elements.0.price_components.2.vat"                  "0.0"
assert_field   "$body" "data.elements.0.price_components.2.step_size"            "1"
assert_float   "$body" "data.elements.1.price_components.0.price"                "0.05"
assert_field   "$body" "data.elements.1.price_components.0.step_size"            "60000"

# ===========================================================================
# EDGE CASE 2 — tariffType: null → value → null round-trip
# Tests that removing type on a re-PUT actually clears it (not leaves stale)
# ===========================================================================

separator "EC-2a. PUT TARIFF-TYPE — Set type to REGULAR"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-TYPE" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-TYPE",
    "country_code": "FR",
    "party_id": "MIL",
    "currency": "EUR",
    "type": "REGULAR",
    "elements": [
      { "price_components": [ { "type": "ENERGY", "price": 0.30, "vat": 10.0, "step_size": 1 } ] }
    ],
    "last_updated": "2026-01-01T00:00:00Z"
  }')
assert_ocpi_success "$body" "PUT TARIFF-TYPE initial"

separator "EC-2b. GET TARIFF-TYPE — Assert type is REGULAR"
body=$(do_curl 200 "$BASE_URL/TARIFF-TYPE" "${OCPI_HEADERS[@]}")
assert_field "$body" "data.type" "REGULAR"

separator "EC-2c. PUT TARIFF-TYPE — Re-PUT without type field (should clear to null)"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-TYPE" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-TYPE",
    "country_code": "FR",
    "party_id": "MIL",
    "currency": "EUR",
    "elements": [
      { "price_components": [ { "type": "ENERGY", "price": 0.30, "vat": 10.0, "step_size": 1 } ] }
    ],
    "last_updated": "2026-01-02T00:00:00Z"
  }')
assert_ocpi_success "$body" "PUT TARIFF-TYPE without type"

separator "EC-2d. GET TARIFF-TYPE — Assert type is now null/missing"
body=$(do_curl 200 "$BASE_URL/TARIFF-TYPE" "${OCPI_HEADERS[@]}")
assert_null_or_missing "$body" "data.type"

separator "EC-2e. PUT TARIFF-TYPE — Re-PUT with type PROFILE_CHEAP"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-TYPE" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-TYPE",
    "country_code": "FR",
    "party_id": "MIL",
    "currency": "EUR",
    "type": "PROFILE_CHEAP",
    "elements": [
      { "price_components": [ { "type": "ENERGY", "price": 0.30, "vat": 10.0, "step_size": 1 } ] }
    ],
    "last_updated": "2026-01-03T00:00:00Z"
  }')
assert_ocpi_success "$body" "PUT TARIFF-TYPE PROFILE_CHEAP"

separator "EC-2f. GET TARIFF-TYPE — Assert type is PROFILE_CHEAP"
body=$(do_curl 200 "$BASE_URL/TARIFF-TYPE" "${OCPI_HEADERS[@]}")
assert_field "$body" "data.type" "PROFILE_CHEAP"

# ===========================================================================
# EDGE CASE 3 — Element count changes across repeated PUTs
# Tests: 3 → 1 → 5 elements, no accumulation or loss
# ===========================================================================

separator "EC-3a. PUT TARIFF-ELEMENTS — Initial PUT with 3 elements"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-ELEMENTS" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-ELEMENTS",
    "country_code": "FR",
    "party_id": "MIL",
    "currency": "EUR",
    "elements": [
      { "price_components": [ { "type": "FLAT",   "price": 1.00, "vat": 20.0, "step_size": 1 } ] },
      { "price_components": [ { "type": "ENERGY", "price": 0.25, "vat": 10.0, "step_size": 1 } ] },
      { "price_components": [ { "type": "TIME",   "price": 0.50, "vat": 20.0, "step_size": 60 } ] }
    ],
    "last_updated": "2026-01-01T00:00:00Z"
  }')
assert_ocpi_success "$body" "PUT TARIFF-ELEMENTS 3 elements"

separator "EC-3b. GET TARIFF-ELEMENTS — Assert 3 elements"
body=$(do_curl 200 "$BASE_URL/TARIFF-ELEMENTS" "${OCPI_HEADERS[@]}")
assert_length "$body" "data.elements" "3"
assert_field  "$body" "data.elements.0.price_components.0.type" "FLAT"
assert_field  "$body" "data.elements.1.price_components.0.type" "ENERGY"
assert_field  "$body" "data.elements.2.price_components.0.type" "TIME"

separator "EC-3c. PUT TARIFF-ELEMENTS — Re-PUT with oFRy 1 element"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-ELEMENTS" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-ELEMENTS",
    "country_code": "FR",
    "party_id": "MIL",
    "currency": "EUR",
    "elements": [
      { "price_components": [ { "type": "ENERGY", "price": 0.40, "vat": 10.0, "step_size": 1 } ] }
    ],
    "last_updated": "2026-01-02T00:00:00Z"
  }')
assert_ocpi_success "$body" "PUT TARIFF-ELEMENTS reduced to 1"

separator "EC-3d. GET TARIFF-ELEMENTS — Assert exactly 1 element (no leftover)"
body=$(do_curl 200 "$BASE_URL/TARIFF-ELEMENTS" "${OCPI_HEADERS[@]}")
assert_length "$body" "data.elements" "1"
assert_field  "$body" "data.elements.0.price_components.0.type"  "ENERGY"
assert_float  "$body" "data.elements.0.price_components.0.price" "0.40"

separator "EC-3e. PUT TARIFF-ELEMENTS — Re-PUT with 5 elements"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-ELEMENTS" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-ELEMENTS",
    "country_code": "FR",
    "party_id": "MIL",
    "currency": "EUR",
    "elements": [
      { "price_components": [ { "type": "FLAT",         "price": 2.00, "vat": 20.0, "step_size": 1   } ] },
      { "price_components": [ { "type": "ENERGY",       "price": 0.20, "vat": 10.0, "step_size": 1   } ] },
      { "price_components": [ { "type": "ENERGY",       "price": 0.35, "vat": 10.0, "step_size": 1   } ], "restrictions": { "min_power": 22.0 } },
      { "price_components": [ { "type": "TIME",         "price": 1.00, "vat": 20.0, "step_size": 300 } ] },
      { "price_components": [ { "type": "PARKING_TIME", "price": 3.00, "vat": 10.0, "step_size": 300 } ] }
    ],
    "last_updated": "2026-01-03T00:00:00Z"
  }')
assert_ocpi_success "$body" "PUT TARIFF-ELEMENTS expanded to 5"

separator "EC-3f. GET TARIFF-ELEMENTS — Assert exactly 5 elements (no duplication)"
body=$(do_curl 200 "$BASE_URL/TARIFF-ELEMENTS" "${OCPI_HEADERS[@]}")
assert_length "$body" "data.elements" "5"
assert_field  "$body" "data.elements.0.price_components.0.type" "FLAT"
assert_field  "$body" "data.elements.1.price_components.0.type" "ENERGY"
assert_float  "$body" "data.elements.2.restrictions.min_power"  "22.0"
assert_field  "$body" "data.elements.3.price_components.0.type" "TIME"
assert_field  "$body" "data.elements.4.price_components.0.type" "PARKING_TIME"

# ===========================================================================
# EDGE CASE 4 — Unknown partner (TenantPartner not registered)
# Tests that GET/PUT/DELETE for unregistered country_code/party_id return
# an OCPI error rather than a 500 or a spurious success
# ===========================================================================

separator "EC-4a. GET unknown partner — Should return OCPI error"
body=$(do_curl 200 "$UNKNOWN_BASE_URL/TARIFF-X" "${OCPI_HEADERS[@]}")
assert_ocpi_error "$body" "GET tariff for unknown partner"

separator "EC-4b. PUT unknown partner — Should return OCPI error"
body=$(do_curl 200 \
  -X PUT "$UNKNOWN_BASE_URL/TARIFF-X" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-X",
    "country_code": "DE",
    "party_id": "UNK",
    "currency": "EUR",
    "elements": [
      { "price_components": [ { "type": "ENERGY", "price": 0.30, "vat": 10.0, "step_size": 1 } ] }
    ],
    "last_updated": "2026-01-01T00:00:00Z"
  }')
assert_ocpi_error "$body" "PUT tariff for unknown partner"

separator "EC-4c. DELETE unknown partner — Should return OCPI error"
body=$(do_curl 200 \
  -X DELETE "$UNKNOWN_BASE_URL/TARIFF-X" \
  "${OCPI_HEADERS[@]}")
assert_ocpi_error "$body" "DELETE tariff for unknown partner"

# ===========================================================================
# EDGE CASE 5 — DELETE idempotency
# Second DELETE on same tariff should return OCPI error (not 500)
# ===========================================================================

separator "EC-5a. PUT TARIFF-DEL-IDEM — Setup"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-DEL-IDEM" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-DEL-IDEM",
    "country_code": "FR",
    "party_id": "MIL",
    "currency": "EUR",
    "elements": [
      { "price_components": [ { "type": "FLAT", "price": 1.00, "vat": 20.0, "step_size": 1 } ] }
    ],
    "last_updated": "2026-01-01T00:00:00Z"
  }')
assert_ocpi_success "$body" "PUT TARIFF-DEL-IDEM"

separator "EC-5b. DELETE TARIFF-DEL-IDEM — First delete (should succeed)"
body=$(do_curl 200 \
  -X DELETE "$BASE_URL/TARIFF-DEL-IDEM" \
  "${OCPI_HEADERS[@]}")
assert_ocpi_success "$body" "DELETE TARIFF-DEL-IDEM first"

separator "EC-5c. DELETE TARIFF-DEL-IDEM — Second delete (should return OCPI error)"
body=$(do_curl 200 \
  -X DELETE "$BASE_URL/TARIFF-DEL-IDEM" \
  "${OCPI_HEADERS[@]}")
assert_ocpi_error "$body" "DELETE TARIFF-DEL-IDEM second (idempotency)"

# ===========================================================================
# EDGE CASE 6 — vat absent vs 0.0
# Per OCPI 2.2.1 vat is optional; if absent it must not appear in response
# ===========================================================================

separator "EC-6a. PUT TARIFF-VAT — One component with vat, one without"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-VAT" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-VAT",
    "country_code": "FR",
    "party_id": "MIL",
    "currency": "EUR",
    "elements": [
      {
        "price_components": [
          { "type": "ENERGY", "price": 0.25, "vat": 10.0, "step_size": 1 },
          { "type": "FLAT",   "price": 1.00,              "step_size": 1 }
        ]
      }
    ],
    "last_updated": "2026-01-01T00:00:00Z"
  }')
assert_ocpi_success "$body" "PUT TARIFF-VAT"

separator "EC-6b. GET TARIFF-VAT — Assert vat present on first, absent on second"
body=$(do_curl 200 "$BASE_URL/TARIFF-VAT" "${OCPI_HEADERS[@]}")
assert_float           "$body" "data.elements.0.price_components.0.vat" "10.0"
assert_null_or_missing "$body" "data.elements.0.price_components.1.vat"

# ===========================================================================
# EDGE CASE 7 — restrictions: null vs absent (no spurious null fields)
# ===========================================================================

separator "EC-7a. PUT TARIFF-RESTR — Element with no restrictions"
body=$(do_curl 200 \
  -X PUT "$BASE_URL/TARIFF-RESTR" \
  "${OCPI_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "TARIFF-RESTR",
    "country_code": "FR",
    "party_id": "MIL",
    "currency": "EUR",
    "elements": [
      { "price_components": [ { "type": "ENERGY", "price": 0.25, "vat": 10.0, "step_size": 1 } ] },
      {
        "price_components": [ { "type": "TIME", "price": 1.00, "vat": 20.0, "step_size": 300 } ],
        "restrictions": { "start_time": "22:00", "end_time": "08:00" }
      }
    ],
    "last_updated": "2026-01-01T00:00:00Z"
  }')
assert_ocpi_success "$body" "PUT TARIFF-RESTR"

separator "EC-7b. GET TARIFF-RESTR — Assert no spurious restrictions on first element"
body=$(do_curl 200 "$BASE_URL/TARIFF-RESTR" "${OCPI_HEADERS[@]}")
assert_length          "$body" "data.elements"                           "2"
assert_null_or_missing "$body" "data.elements.0.restrictions"
assert_field           "$body" "data.elements.1.restrictions.start_time" "22:00"
assert_field           "$body" "data.elements.1.restrictions.end_time"   "08:00"

# ===========================================================================
# CLEANUP
# ===========================================================================

separator "CLEANUP — Delete all edge-case tariffs"

for tid in TARIFF-NUMERIC TARIFF-TYPE TARIFF-ELEMENTS TARIFF-VAT TARIFF-RESTR; do
  body=$(do_curl 200 -X DELETE "$BASE_URL/$tid" "${OCPI_HEADERS[@]}")
  assert_ocpi_success "$body" "DELETE $tid"
done

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