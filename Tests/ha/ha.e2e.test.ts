// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * High-availability scenario (TECH-2897): two OCPI instances, A and B, on one
 * Postgres/Hasura/RabbitMQ/Redis stack, with a mock partner, mock core and mock IdP on the
 * host. Checks that both instances serve the same API, that one database change reaches the
 * partner exactly once, that command callbacks work across instances, and that event
 * processing fails over on SIGTERM and SIGKILL.
 *
 * Requires `npm run build` first: the instances run from Server/dist.
 *
 * Every check is recorded in a results table (e2e-ha-results.md at the repo root) before the
 * final assertion, so a failing run still shows the whole picture.
 *
 * Comparing with another build: DIST_ROOT=/path/to/other/checkout/ HA_REDIS=false
 * HA_LABEL=baseline runs the same scenario against that checkout's dist, with the in-memory
 * cache. Mock core always calls back the OTHER instance, so every callback is cross-instance.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createWriteStream, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:net';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, describe, expect, it } from 'vitest';
import { startOcpiTestStack } from '../helpers/setupOcpiTestStack.js';
import type { OcpiTestStack } from '../helpers/setupOcpiTestStack.js';
import testImages from '../helpers/testImages.json' with { type: 'json' };

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const DIST_ROOT = process.env.DIST_ROOT ?? REPO_ROOT;
const LABEL = process.env.HA_LABEL ?? 'branch';
const USE_REDIS = process.env.HA_REDIS !== 'false';
const RESULTS = `${REPO_ROOT}e2e-ha-results${LABEL === 'branch' ? '' : `-${LABEL}`}`;
const COMMAND_TIMEOUT = 8;
const CPO_AUTH_TOKEN = '707b4484-0448-4baf-8acb-c79d73c75869'; // seeded FR/CPO
const SEEDERS = [
  '20250806120001-default-tenant.ts',
  '20250806120002-default-tenant-partner.ts',
  '20260803171237-default-roaming-partner.ts',
];

type Name = 'A' | 'B';
type Row = {
  section: string;
  check: string;
  expected: string;
  A?: string;
  B?: string;
  result: string;
  ok: boolean;
};
const rows: Row[] = [];
function record(row: Row) {
  rows.push(row);
  console.log(
    `[${row.ok ? 'OK' : 'KO'}] ${row.section} | ${row.check} | A=${row.A ?? '-'} B=${row.B ?? '-'} | ${row.result}`,
  );
}
const per = (name: Name, value: string): Partial<Record<Name, string>> => ({
  [name]: value,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitUntil<T>(
  probe: () => T | Promise<T>,
  done: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await probe();
  while (!done(value) && Date.now() < deadline) {
    await sleep(200);
    value = await probe();
  }
  return value;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

/* ---------------- mock partner / core / IdP ---------------- */

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const KID = 'ha-test';
const ISSUER = 'http://mock-idp/realms/test';
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: KID,
  use: 'sig',
  alg: 'RS256',
};
const coreToken = () =>
  jwt.sign({ sub: 'core' }, privateKey, {
    algorithm: 'RS256',
    keyid: KID,
    issuer: ISSUER,
    expiresIn: '5m',
  });

type Hit = { method: string; path: string; body: any };
const hits: Hit[] = [];
let coreMode: 'callback' | 'silent' = 'callback';
const callbacks: { url: string; status: number }[] = [];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

function ocpiOk(res: ServerResponse) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      status_code: 1000,
      status_message: 'Success',
      timestamp: new Date().toISOString(),
    }),
  );
}

async function startMock(port: number): Promise<Server> {
  const server = createHttpServer(async (req, res) => {
    const raw = await readBody(req);
    let body: any = raw;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      /* keep raw */
    }
    const url = new URL(req.url!, `http://127.0.0.1:${port}`);
    hits.push({ method: req.method!, path: url.pathname, body });

    if (url.pathname === '/jwks') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (url.pathname.startsWith('/core/')) {
      // Mock CitrineOS core: accept, then call back as if the charger had answered.
      const callbackUrl = url.searchParams.get('callbackUrl')!;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ success: true }]));
      if (coreMode === 'callback') {
        setTimeout(async () => {
          const r = await fetch(callbackUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${coreToken()}`,
            },
            body: JSON.stringify({ status: 'Unlocked' }),
          });
          callbacks.push({ url: callbackUrl, status: r.status });
        }, 500);
      }
      return;
    }
    ocpiOk(res);
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return server;
}

/* ---------------- OCPI client ---------------- */

type Instance = { name: Name; port: number; base: string; proc?: ChildProcess };

function headers() {
  return {
    Authorization: `Token ${Buffer.from(CPO_AUTH_TOKEN).toString('base64')}`,
    'Content-Type': 'application/json',
    'X-Request-ID': randomUUID(),
    'X-Correlation-ID': randomUUID(),
    'OCPI-from-country-code': 'FR',
    'OCPI-from-party-id': 'CPO',
    'OCPI-to-country-code': 'FR',
    'OCPI-to-party-id': 'ZET',
  };
}

async function call(method: string, url: string, body?: unknown) {
  try {
    const r = await fetch(url, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* raw */
    }
    return { status: r.status, data };
  } catch (e: any) {
    return { status: 0, data: String(e?.cause?.code ?? e) };
  }
}

const fmt = (r: { status: number; data: any }) =>
  `${r.status}${r.data?.status_code ? `/${r.data.status_code}` : ''}`;
const count = (data: any) =>
  Array.isArray(data?.data) ? data.data.length : '-';

const ready = (inst: Instance) => call('GET', `${inst.base}/health/ready`);

async function waitListening(inst: Instance, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (inst.proc?.exitCode !== null && inst.proc?.exitCode !== undefined) {
      throw new Error(`${inst.name} exited with ${inst.proc.exitCode}`);
    }
    if ((await call('GET', `${inst.base}/versions/1`)).status !== 0) return;
    await sleep(500);
  }
  throw new Error(`${inst.name} not listening after ${timeoutMs} ms`);
}

/* ---------------- scenario ---------------- */

describe(`HA: two OCPI instances (${LABEL})`, () => {
  let stack: OcpiTestStack | undefined;
  let rabbit: StartedTestContainer | undefined;
  let redis: StartedTestContainer | undefined;
  let mock: Server | undefined;
  const insts: Instance[] = [];

  afterAll(async () => {
    for (const i of insts) i.proc?.kill('SIGKILL');
    mock?.close();
    await redis?.stop();
    await rabbit?.stop();
    await stack?.stop();
    const md = [
      `| Section | Check | Expected | A | B | Result | |`,
      `|---|---|---|---|---|---|---|`,
      ...rows.map(
        (r) =>
          `| ${r.section} | ${r.check} | ${r.expected} | ${r.A ?? '-'} | ${r.B ?? '-'} | ${r.result} | ${r.ok ? '✅' : '❌'} |`,
      ),
    ].join('\n');
    writeFileSync(`${RESULTS}.md`, md + '\n');
    writeFileSync(`${RESULTS}.json`, JSON.stringify(rows, null, 2));
    console.log('\n' + md);
  });

  it('serves the same API, broadcasts once and fails over', async () => {
    /* --- stack --- */
    stack = await startOcpiTestStack();
    const db = stack.sequelize;
    const select = <T = any>(sql: string) =>
      db.query(sql, { type: 'SELECT' as any }) as unknown as Promise<T[]>;

    const qi = db.getQueryInterface();
    for (const file of SEEDERS) {
      const mod: any = await import(`${REPO_ROOT}seeders/${file}`);
      await (mod.default ?? mod).up(qi, db);
    }
    // Seeders insert explicit ids: move the sequences past them.
    await db.query(`
      DO $$ DECLARE r record; BEGIN
        FOR r IN SELECT table_name, pg_get_serial_sequence(format('%I', table_name), 'id') AS seq
          FROM information_schema.columns WHERE table_schema='public' AND column_name='id'
        LOOP IF r.seq IS NOT NULL THEN
          EXECUTE format('SELECT setval(%L, COALESCE((SELECT MAX(id) FROM %I),0)+1, false)', r.seq, r.table_name);
        END IF; END LOOP; END $$;`);

    rabbit = await new GenericContainer(testImages.rabbitmq)
      .withExposedPorts(5672)
      .withEnvironment({
        RABBITMQ_DEFAULT_USER: 'e2e',
        RABBITMQ_DEFAULT_PASS: 'e2e',
      })
      .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
      .withStartupTimeout(120_000)
      .start();
    if (USE_REDIS) {
      redis = await new GenericContainer(testImages.redis)
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
        .start();
    }

    const mockPort = await freePort();
    const MOCK = `http://127.0.0.1:${mockPort}`;
    mock = await startMock(mockPort);

    /* --- data: partners -> mock, a token receiver partner, one station --- */
    await db.query(
      `UPDATE "TenantPartners" SET "partnerProfileOCPI" =
         replace("partnerProfileOCPI"::text, 'http://host.docker.internal:8083', '${MOCK}/partner')::jsonb`,
    );
    // Seeded logos are .svg, which RegistrationMapper rejects (GET credentials -> 500).
    for (const table of ['TenantPartners', 'Tenants']) {
      const cols = await select<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='${table}' AND data_type='jsonb'`,
      );
      for (const { column_name } of cols) {
        await db.query(
          `UPDATE "${table}" SET "${column_name}" =
             replace(replace("${column_name}"::text, '.svg', '.png'), '"svg"', '"png"')::jsonb
           WHERE "${column_name}" IS NOT NULL`,
        );
      }
    }
    const [{ id: tenantId }] = await select(
      `SELECT id FROM "Tenants" WHERE "countryCode"='FR' AND "partyId"='ZET' LIMIT 1`,
    );
    const mckProfile = {
      credentials: { token: 'mck-token' },
      roles: [{ role: 'CPO', country_code: 'FR', party_id: 'MCK' }],
      endpoints: [
        {
          identifier: 'tokens_RECEIVER',
          role: 'RECEIVER',
          url: `${MOCK}/partner/mck/ocpi/cpo/2.2.1/tokens`,
        },
      ],
    };
    await db.query(
      `INSERT INTO "TenantPartners" ("tenantId","countryCode","partyId","partnerProfileOCPI","createdAt","updatedAt")
       VALUES (${tenantId},'FR','MCK','${JSON.stringify(mckProfile)}'::jsonb, now(), now())`,
    );
    const [loc] = await select(
      `INSERT INTO "Locations" ("tenantId", name, address, city, "postalCode", country, "timeZone", coordinates, "createdAt","updatedAt")
       VALUES (${tenantId}, 'HA test site', '1 rue de la Paix', 'Paris', '75002', 'FRA', 'Europe/Paris',
               ST_SetSRID(ST_MakePoint(2.3315, 48.8691), 4326), now(), now()) RETURNING id`,
    );
    const stationId = 'HA-CS-1';
    await db.query(
      `INSERT INTO "ChargingStations" (id,"locationId","tenantId","isOnline",protocol,"createdAt","updatedAt")
       VALUES ('${stationId}', ${loc.id}, ${tenantId}, true, 'ocpp2.0.1', now(), now())`,
    );
    await db.query(
      `INSERT INTO "Evses" ("tenantId","stationId","evseTypeId","createdAt","updatedAt")
       VALUES (${tenantId}, '${stationId}', 1, now(), now())`,
    );
    const [conn] = await select(
      `INSERT INTO "Connectors" ("stationId","connectorId",status,"tenantId","createdAt","updatedAt")
       VALUES ('${stationId}', 1, 'Available', ${tenantId}, now(), now()) RETURNING id`,
    );

    /* --- instances --- */
    const pg = new URL(stack.pgConnectionString);
    for (const name of ['A', 'B'] as const) {
      const port = await freePort();
      insts.push({ name, port, base: `http://127.0.0.1:${port}/ocpi` });
    }
    const [A, B] = insts;
    const other = (inst: Instance) => (inst === A ? B : A);

    const start = (inst: Instance) => {
      const log = createWriteStream(
        `${REPO_ROOT}e2e-ha-${LABEL}-${inst.name}.log`,
        {
          flags: 'a',
        },
      );
      inst.proc = spawn(process.execPath, ['dist/index.js'], {
        cwd: `${DIST_ROOT}Server`,
        env: {
          ...process.env,
          APP_NAME: 'all',
          APP_ENV: 'docker',
          DB_HOST: pg.hostname,
          DB_PORT: pg.port,
          DB_NAME: pg.pathname.slice(1),
          DB_USER: pg.username,
          DB_PASS: pg.password,
          GRAPHQL_ENDPOINT: stack!.graphqlEndpoint,
          AMQP_URL: `amqp://e2e:e2e@${rabbit!.getHost()}:${rabbit!.getMappedPort(5672)}`,
          AMQP_EXCHANGE: 'ocpi',
          ...(redis
            ? {
                REDIS_HOST: redis.getHost(),
                REDIS_PORT: String(redis.getMappedPort(6379)),
              }
            : {}),
          CITRINEOS_OCPI_GRAPHQL_HEADERS: JSON.stringify(stack!.graphqlHeaders),
          CITRINEOS_OCPI_OCPISERVER_PORT: String(inst.port),
          CITRINEOS_OCPI_GIREVE_COUNTRYCODE: 'FR',
          CITRINEOS_OCPI_GIREVE_PARTYID: '107',
          CITRINEOS_OCPI_OIDC_JWKSURI: `${MOCK}/jwks`,
          CITRINEOS_OCPI_OIDC_ISSUER: ISSUER,
          COMMANDS_TIMEOUT: String(COMMAND_TIMEOUT),
          COMMANDS_OCPI_BASE_URL: other(inst).base,
          COMMANDS_OCPP2_0_1_UNLOCK_CONNECTOR_REQUEST_URL: `${MOCK}/core/unlock`,
          LOG_LEVEL: '3',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      inst.proc.stdout!.pipe(log);
      inst.proc.stderr!.pipe(log);
    };
    const stop = (inst: Instance, signal: NodeJS.Signals) => {
      const p = inst.proc!;
      const exited = new Promise<number | null>((r) =>
        p.once('exit', (code) => r(code)),
      );
      p.kill(signal);
      return Promise.race([exited, sleep(40_000).then(() => -1)]);
    };

    // A first, so it is the leader before B starts.
    start(A);
    await waitListening(A);
    await sleep(2000);
    start(B);
    await waitListening(B);
    await sleep(4000);

    /* --- 1. health --- */
    const hA = await call('GET', `${A.base}/health`);
    const hB = await call('GET', `${B.base}/health`);
    record({
      section: 'Health',
      check: 'GET /ocpi/health',
      expected: '200',
      A: fmt(hA),
      B: fmt(hB),
      result: '',
      ok: hA.status === 200 && hB.status === 200,
    });
    const rA = await ready(A);
    const rB = await ready(B);
    record({
      section: 'Health',
      check: 'GET /ocpi/health/ready',
      expected: '200, exactly one event leader',
      A: `${rA.status} leader=${rA.data?.eventLeader}`,
      B: `${rB.status} leader=${rB.data?.eventLeader}`,
      result: '',
      ok:
        rA.status === 200 &&
        rB.status === 200 &&
        Number(rA.data?.eventLeader) + Number(rB.data?.eventLeader) === 1,
    });

    /* --- 2. main routes on both instances --- */
    const q = '?date_from=2020-01-01T00:00:00Z&limit=10';
    const routes: [string, string][] = [
      ['GET /versions/1', `/versions/1`],
      ['GET /versions/1/2.2.1', `/versions/1/2.2.1`],
      ['GET /2.2.1/credentials', `/2.2.1/credentials`],
      ['GET /cpo/2.2.1/locations', `/cpo/2.2.1/locations${q}`],
      ['GET /cpo/2.2.1/tariffs', `/cpo/2.2.1/tariffs${q}`],
      ['GET /cpo/2.2.1/sessions', `/cpo/2.2.1/sessions${q}`],
      ['GET /cpo/2.2.1/cdrs', `/cpo/2.2.1/cdrs${q}`],
      ['GET /emsp/2.2.1/tokens', `/emsp/2.2.1/tokens${q}`],
    ];
    for (const [label, path] of routes) {
      const a = await call('GET', `${A.base}${path}`);
      const b = await call('GET', `${B.base}${path}`);
      record({
        section: 'Routes',
        check: label,
        expected: 'same answer on A and B',
        A: fmt(a),
        B: fmt(b),
        result:
          a.status === b.status
            ? `items A=${count(a.data)} B=${count(b.data)}`
            : 'differs',
        ok:
          a.status === b.status &&
          a.status >= 200 &&
          a.status < 300 &&
          count(a.data) === count(b.data),
      });
    }

    const tariffId = `ha-${randomUUID().slice(0, 8)}`;
    const put = await call(
      'PUT',
      `${A.base}/emsp/2.2.1/tariffs/FR/CPO/${tariffId}`,
      {
        id: tariffId,
        country_code: 'FR',
        party_id: 'CPO',
        currency: 'EUR',
        type: 'REGULAR',
        elements: [
          {
            price_components: [
              { type: 'ENERGY', price: 0.25, vat: 0.2, step_size: 1 },
            ],
          },
        ],
        last_updated: new Date().toISOString(),
      },
    );
    const get = await call(
      'GET',
      `${B.base}/emsp/2.2.1/tariffs/FR/CPO/${tariffId}`,
    );
    record({
      section: 'Routes',
      check: 'PUT tariff on A, GET it on B',
      expected: 'B sees what A wrote',
      A: `PUT ${fmt(put)}`,
      B: `GET ${fmt(get)}`,
      result: get.data?.data?.id === tariffId ? 'same tariff' : 'not found',
      ok: put.status === 200 && get.data?.data?.id === tariffId,
    });

    /* --- 3. broadcasts: one DB change -> how many partner pushes? --- */
    const pushes = (uid: string) =>
      hits.filter(
        (h) =>
          h.method === 'PUT' &&
          h.path.includes('/partner/mck/') &&
          h.path.endsWith(`/${uid}`),
      ).length;
    const pushToken = async () => {
      const uid = `HA${randomUUID().slice(0, 8)}`.toUpperCase();
      const [auth] = await select(
        `INSERT INTO "Authorizations" ("idToken","idTokenType","additionalInfo","createdAt","updatedAt")
         VALUES ('${uid}','ISO14443',
                 '[{"type":"eMAID","additionalIdToken":"FRZETC${uid.slice(-8)}"},{"type":"visual_number","additionalIdToken":"${uid}"},{"type":"issuer","additionalIdToken":"Enexflow"}]'::jsonb,
                 now(), now()) RETURNING id`,
      );
      await db.query(
        `INSERT INTO "AuthorizationTenants" ("authorizationId","tenantId","createdAt","updatedAt")
         VALUES (${auth.id}, ${tenantId}, now(), now())`,
      );
      // Wait for the first push, then leave time for duplicates to show up.
      await waitUntil(
        () => pushes(uid),
        (n) => n > 0,
        20_000,
      );
      await sleep(3000);
      return pushes(uid);
    };
    const counts = [await pushToken(), await pushToken(), await pushToken()];
    record({
      section: 'Broadcasts',
      check: 'New token -> PUT to partner (x3)',
      expected: '1 push per change',
      result: `pushes per change: ${counts.join(', ')}`,
      ok: counts.every((c) => c === 1),
    });

    /* --- 4. commands across instances --- */
    const unlock = async (via: Instance, mode: 'callback' | 'silent') => {
      coreMode = mode;
      const rid = randomUUID();
      const r = await call(
        'POST',
        `${via.base}/cpo/2.2.1/commands/UNLOCK_CONNECTOR`,
        {
          response_url: `${MOCK}/partner/emsp/commands/UNLOCK_CONNECTOR/${rid}`,
          location_id: String(loc.id),
          evse_uid: `${stationId}::1`,
          connector_id: String(conn.id),
        },
      );
      // Past the command timeout: a wrong TIMEOUT would show up here.
      await sleep((COMMAND_TIMEOUT + 4) * 1000);
      const results = hits
        .filter((h) => h.method === 'POST' && h.path.endsWith(rid))
        .map((h) => h.body?.result);
      return { r, results };
    };
    const c1 = await unlock(A, 'callback');
    const cb = callbacks.at(-1);
    record({
      section: 'Commands',
      check: 'UNLOCK via A, core callback lands on B',
      expected: 'callback 2xx, ACCEPTED once, no TIMEOUT',
      A: `POST ${fmt(c1.r)} ${c1.r.data?.data?.result ?? ''}`,
      B: `callback ${cb?.status ?? '-'}`,
      result: `results sent to eMSP: [${c1.results.join(', ')}]`,
      ok:
        c1.r.data?.data?.result === 'ACCEPTED' &&
        cb !== undefined &&
        cb.status >= 200 &&
        cb.status < 300 &&
        c1.results.length === 1 &&
        c1.results[0] === 'ACCEPTED',
    });
    const c2 = await unlock(B, 'silent');
    record({
      section: 'Commands',
      check: 'UNLOCK via B, charger never answers',
      expected: 'TIMEOUT once',
      B: `POST ${fmt(c2.r)} ${c2.r.data?.data?.result ?? ''}`,
      result: `results sent to eMSP: [${c2.results.join(', ')}]`,
      ok: c2.results.length === 1 && c2.results[0] === 'TIMEOUT',
    });

    /* --- 5. failover --- */
    const leaderFlags = async () => {
      const out: Partial<Record<Name, boolean>> = {};
      for (const i of insts) {
        const r = await ready(i);
        out[i.name] = r.status === 200 ? r.data?.eventLeader : undefined;
      }
      return out;
    };
    const timeToLead = async (inst: Instance, timeoutMs: number) => {
      const t0 = Date.now();
      const r = await waitUntil(
        () => ready(inst),
        (x) => x.data?.eventLeader === true,
        timeoutMs,
      );
      return r.data?.eventLeader === true ? Date.now() - t0 : -1;
    };
    const flags = await leaderFlags();
    let leader = flags.B ? B : A;
    let standby = other(leader);

    // 5a. Graceful stop, as in a rolling update.
    const t0 = Date.now();
    const exitCode = await stop(leader, 'SIGTERM');
    const stopMs = Date.now() - t0;
    const takeover1 = await timeToLead(standby, 30_000);
    const during = await call('GET', `${standby.base}/versions/1`);
    const n1 = await pushToken();
    record({
      section: 'Failover',
      check: `SIGTERM leader ${leader.name}`,
      expected: 'exit 0, standby leads within seconds, 1 push',
      ...per(leader.name, `exit=${exitCode} in ${stopMs} ms`),
      ...per(standby.name, `leader after ${takeover1} ms, HTTP ${fmt(during)}`),
      result: `pushes after failover: ${n1}`,
      ok: exitCode === 0 && takeover1 >= 0 && during.status === 200 && n1 === 1,
    });

    // The stopped instance comes back as standby.
    start(leader);
    await waitListening(leader);
    await sleep(5000);
    const back = await leaderFlags();
    const n2 = await pushToken();
    record({
      section: 'Failover',
      check: `Restart ${leader.name}`,
      expected: 'comes back as standby, still 1 push',
      A: `leader=${back.A}`,
      B: `leader=${back.B}`,
      result: `pushes: ${n2}`,
      ok:
        back[leader.name] === false && back[standby.name] === true && n2 === 1,
    });

    // 5b. Hard kill of the current leader, as in a crash.
    [leader, standby] = [standby, leader];
    await stop(leader, 'SIGKILL');
    const takeover2 = await timeToLead(standby, 60_000);
    const n3 = await pushToken();
    record({
      section: 'Failover',
      check: `SIGKILL leader ${leader.name}`,
      expected: 'standby leads, 1 push',
      ...per(leader.name, 'killed'),
      ...per(standby.name, `leader after ${takeover2} ms`),
      result: `pushes after failover: ${n3}`,
      ok: takeover2 >= 0 && n3 === 1,
    });

    expect(
      rows.filter((r) => !r.ok).map((r) => `${r.section}: ${r.check}`),
    ).toEqual([]);
  });
});
