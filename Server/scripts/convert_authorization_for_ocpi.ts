// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(import.meta.dirname, '.env') });

const HASURA_URL = process.env.HASURA_URL;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const TABLE = 'Authorizations';
const OLD_TENANT_ID = Number(process.env.OLD_TENANT_ID);
const NEW_TENANT_ID = Number(process.env.NEW_TENANT_ID);

if (!HASURA_URL) throw new Error('Missing HASURA_URL');

async function gql(query: string, variables: Record<string, unknown> = {}) {
  if (!HASURA_URL || !ADMIN_SECRET)
    throw new Error('Missing HASURA_URL / ADMIN_SECRET');
  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

const INSERT_MUTATION = `
  mutation Insert($object: ${TABLE}_insert_input!) {
    insert_${TABLE}_one(object: $object) { id }
  }
`;

// 1. Fetch all rows from OLD_TENANT_ID
const data = await gql(
  `{ ${TABLE}(where: { tenantId: { _eq: ${OLD_TENANT_ID} } }) { idToken idTokenType status additionalInfo } }`,
);
const rows = data[TABLE];
console.log(`Fetched ${rows.length} rows from tenant ${OLD_TENANT_ID}`);

// 2. Insert new rows for NEW_TENANT_ID
let inserted = 0;
let skipped = 0;

for (const row of rows) {
  if (row.idTokenType === 'MacAddress') {
    skipped++;
    continue;
  }
  const { id, ...rowWithoutId } = row;

  const newRow = {
    ...rowWithoutId,
    tenantId: NEW_TENANT_ID,
    realTimeAuth: 'Always',
    additionalInfo: [
      { type: 'eMAID', additionalIdToken: `FR*ZET*${row.idToken}` },
      { type: 'visual_number', additionalIdToken: `${row.idToken}` },
      { type: 'issuer', additionalIdToken: 'Zetra' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  console.log(newRow);

  try {
    await gql(INSERT_MUTATION, { object: newRow });
    console.log(`Inserted new authorization for token ${row.idToken}`);
    inserted++;
  } catch (err: any) {
    console.warn(`Skipped token ${row.idToken}: ${err.message}`);
    skipped++;
  }
}

console.log(`Done — inserted: ${inserted}, skipped: ${skipped}`);