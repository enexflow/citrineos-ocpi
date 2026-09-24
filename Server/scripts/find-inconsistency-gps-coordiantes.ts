// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * List partner-owned Locations / Evses with bad GPS coordinates:
 * - likely inverted lon/lat
 * - or outside Europe bounds when read as [longitude, latitude]
 *
 * PostGIS / GeoJSON Point is [longitude, latitude].
 *
 * Usage (from citrineos-ocpi):
 *   npx tsx ./Server/scripts/outside-europe.ts
 *
 * Optional .env / env:
 *   HASURA_URL, ADMIN_SECRET
 *   TENANT_ID (default 1)
 *   TENANT_PARTNER_ID (optional)
 *   BATCH_SIZE (default 200)
 *   INCLUDE_EVSES=true (default true)
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(import.meta.dirname, '.env') });

const HASURA_URL = process.env.HASURA_URL;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const TENANT_ID = Number(process.env.TENANT_ID ?? '1');
const TENANT_PARTNER_ID = process.env.TENANT_PARTNER_ID
  ? Number(process.env.TENANT_PARTNER_ID)
  : null;
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? '200');
const INCLUDE_EVSES = process.env.INCLUDE_EVSES !== 'false';

/** Europe-ish bounds — same as arrange-gps-coordinates.ts */
const LAT_MIN = 34;
const LAT_MAX = 72;
const LON_MIN = -31;
const LON_MAX = 45;

function isInsideEurope(lon: number, lat: number): boolean {
  return lat >= LAT_MIN && lat <= LAT_MAX && lon >= LON_MIN && lon <= LON_MAX;
}

/** True when stored lon looks like Europe lat and stored lat looks like Europe lon. */
function looksSwapped(lon: number, lat: number): boolean {
  return lon >= LAT_MIN && lon <= LAT_MAX && lat >= LON_MIN && lat <= LON_MAX;
}

if (!HASURA_URL || !ADMIN_SECRET) {
  throw new Error('Missing HASURA_URL / ADMIN_SECRET');
}
if (TENANT_PARTNER_ID != null && !Number.isFinite(TENANT_PARTNER_ID)) {
  throw new Error('Invalid TENANT_PARTNER_ID');
}

type GeoPoint = { type: 'Point'; coordinates: [number, number] };

type LocRow = {
  id: number;
  ocpiId?: string | null;
  name?: string | null;
  country?: string | null;
  ownerTenantPartnerId?: number | null;
  coordinates: GeoPoint | null;
};

type EvseRow = {
  id: number;
  ocpiUid?: string | null;
  coordinates: GeoPoint | null;
  ChargingStation?: {
    Location?: {
      id: number;
      name?: string | null;
      ownerTenantPartnerId?: number | null;
    } | null;
  } | null;
};

type ReportRow = {
  kind: 'Location' | 'Evse';
  id: number;
  partnerId?: number | null;
  label: string;
  lon: number;
  lat: number;
  outsideEurope: boolean;
  looksSwapped: boolean;
};

async function gql<T = any>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(HASURA_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET!,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(JSON.stringify(json.errors, null, 2));
  }
  return json.data;
}

function parsePoint(raw: unknown): GeoPoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<GeoPoint>;
  if (
    p.type !== 'Point' ||
    !Array.isArray(p.coordinates) ||
    p.coordinates.length < 2
  ) {
    return null;
  }
  const lon = Number(p.coordinates[0]);
  const lat = Number(p.coordinates[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { type: 'Point', coordinates: [lon, lat] };
}

function evaluateCoords(lon: number, lat: number) {
  const swapped = looksSwapped(lon, lat);
  const inside = isInsideEurope(lon, lat);
  return {
    outsideEurope: !inside,
    looksSwapped: swapped,
    report: swapped || !inside,
  };
}

function partnerLocationWhere() {
  return {
    tenantId: { _eq: TENANT_ID },
    ownerTenantPartnerId:
      TENANT_PARTNER_ID != null
        ? { _eq: TENANT_PARTNER_ID }
        : { _is_null: true },
    coordinates: { _is_null: false },
  };
}

async function scanLocations(): Promise<ReportRow[]> {
  const out: ReportRow[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const data = await gql<{ Locations: LocRow[] }>(
      `
      query GetLocations($where: Locations_bool_exp!, $limit: Int!, $offset: Int!) {
        Locations(
          where: $where
          limit: $limit
          offset: $offset
          order_by: { id: asc }
        ) {
          id
          ocpiId
          name
          country
          ownerTenantPartnerId
          coordinates
        }
      }
    `,
      { where: partnerLocationWhere(), limit: BATCH_SIZE, offset },
    );

    const rows = data.Locations ?? [];
    if (rows.length === 0) {
      hasMore = false;
      continue;
    }

    for (const row of rows) {
      const point = parsePoint(row.coordinates);
      if (!point) continue;

      const [lon, lat] = point.coordinates;
      const evalResult = evaluateCoords(lon, lat);
      if (!evalResult.report) continue;

      out.push({
        kind: 'Location',
        id: row.id,
        partnerId: row.ownerTenantPartnerId,
        label: `${row.ocpiId ?? row.id} "${row.name ?? ''}" (${row.country ?? '?'})`,
        lon,
        lat,
        outsideEurope: evalResult.outsideEurope,
        looksSwapped: evalResult.looksSwapped,
      });
    }

    offset += rows.length;
    hasMore = rows.length >= BATCH_SIZE;
  }

  return out;
}

async function scanEvses(): Promise<ReportRow[]> {
  const out: ReportRow[] = [];
  let offset = 0;

  const where = {
    tenantId: { _eq: TENANT_ID },
    coordinates: { _is_null: false },
  };

  let hasMore = true;

  while (hasMore) {
    const data = await gql<{ Evses: EvseRow[] }>(
      `
      query GetEvses($where: Evses_bool_exp!, $limit: Int!, $offset: Int!) {
        Evses(
          where: $where
          limit: $limit
          offset: $offset
          order_by: { id: asc }
        ) {
          id
          ocpiUid
          coordinates
          ChargingStation {
            Location {
              id
              name
              ownerTenantPartnerId
            }
          }
        }
      }
    `,
      { where, limit: BATCH_SIZE, offset },
    );

    const rows = data.Evses ?? [];
    if (rows.length === 0) {
      hasMore = false;
      continue;
    }

    for (const row of rows) {
      const point = parsePoint(row.coordinates);
      if (!point) continue;

      const [lon, lat] = point.coordinates;
      const evalResult = evaluateCoords(lon, lat);
      if (!evalResult.report) continue;

      const loc = row.ChargingStation?.Location;
      out.push({
        kind: 'Evse',
        id: row.id,
        partnerId: loc?.ownerTenantPartnerId,
        label: `uid=${row.ocpiUid} location=${loc?.id} "${loc?.name ?? ''}"`,
        lon,
        lat,
        outsideEurope: evalResult.outsideEurope,
        looksSwapped: evalResult.looksSwapped,
      });
    }

    offset += rows.length;
    hasMore = rows.length >= BATCH_SIZE;
  }

  return out;
}

function formatTags(row: ReportRow): string {
  const tags: string[] = [];
  if (row.looksSwapped) tags.push('LIKELY SWAPPED');
  if (row.outsideEurope && !row.looksSwapped) tags.push('OUTSIDE EUROPE');
  return tags.length ? ` [${tags.join(', ')}]` : '';
}

const FIX_SWAPPED = process.env.FIX_SWAPPED === 'true';
const DRY_RUN = process.env.DRY_RUN !== 'false';

async function swapLocationCoordinates(id: number, lon: number, lat: number) {
  const fixed = {
    type: 'Point',
    coordinates: [lat, lon],
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::4326' } },
  };
  await gql(
    `mutation UpdateLoc($id: Int!, $coordinates: geometry!) {
       update_Locations_by_pk(pk_columns: { id: $id }, _set: { coordinates: $coordinates }) { id }
     }`,
    { id, coordinates: fixed },
  );
}

async function main() {
  console.log({
    TENANT_ID,
    TENANT_PARTNER_ID,
    BATCH_SIZE,
    INCLUDE_EVSES,
    bounds: { LAT_MIN, LAT_MAX, LON_MIN, LON_MAX },
  });

  const locations = await scanLocations();
  const evses = INCLUDE_EVSES ? await scanEvses() : [];
  const all = [...locations, ...evses];

  const swapped = all.filter((r) => r.looksSwapped);
  const outsideOnly = all.filter((r) => r.outsideEurope && !r.looksSwapped);

  console.log(`\nBad coordinates: ${all.length} total`);
  console.log(`  Locations: ${locations.length}`);
  console.log(`  Evses: ${evses.length}`);
  console.log(`  Likely inverted: ${swapped.length}`);
  console.log(`  Outside Europe (not inverted): ${outsideOnly.length}\n`);

  for (const row of all) {
    console.log(
      `[${row.kind} ${row.id}] partner=${row.partnerId} ` +
        `${row.label} lon=${row.lon} lat=${row.lat}` +
        formatTags(row),
    );
  }
  const toFix = locations.filter((r) => r.looksSwapped);
  // only fix swapped locations
  if (FIX_SWAPPED) {
    for (const row of toFix) {
      console.log(
        `${DRY_RUN ? '[DRY] ' : ''}swap Location ${row.id}: [${row.lon},${row.lat}] → [${row.lat},${row.lon}]`,
      );
      if (!DRY_RUN) await swapLocationCoordinates(row.id, row.lon, row.lat);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
