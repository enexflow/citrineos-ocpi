import 'dotenv/config';

const HASURA_URL = process.env.HASURA_URL;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const TABLE = 'Authorizations';
const OLD_TENANT_ID = Number(process.env.OLD_TENANT_ID);
const NEW_TENANT_ID = Number(process.env.NEW_TENANT_ID);

if (!HASURA_URL) throw new Error('Missing HASURA_URL');

async function gql(query, variables = {}) {
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

// 1. Fetch all rows
const data = await gql(
  `{ ${TABLE} { id idToken idTokenType status tenantId additionalInfo } }`,
);
const rows = data[TABLE];
console.log(`Fetched ${rows.length} rows`);

// 2. Transform each row
const updatedRows = rows.map((row) => {
  if (row.tenantId === OLD_TENANT_ID && row.idTokenType !== 'MacAddress') {
    const additionalInfo = [
      { type: 'eMAID', additionalIdToken: `FR*ZET*${row.idToken}` },
      { type: 'visual_number', additionalIdToken: `${row.idToken}` },
      { type: 'issuer', additionalIdToken: 'Zetra' },
    ];

    return {
      ...row,
      tenantId: NEW_TENANT_ID,
      realTimeAuth: 'Always',
      additionalInfo: additionalInfo,
    };
  }
  return row;
});

// 3. Update each row in DB
const MUTATION = `
  mutation Update($id: Int!, $changes: ${TABLE}_set_input!) {
    update_${TABLE}_by_pk(pk_columns: { id: $id }, _set: $changes) { id }
  }
`;

for (const row of updatedRows) {
  const { id, ...changes } = row;
  await gql(MUTATION, { id, changes });
  console.log(`Updated row ${id}`);
}

console.log('Done');
