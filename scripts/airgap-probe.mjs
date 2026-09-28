/**
 * Air-gap probe — runs INSIDE a container started with `--network none`.
 *
 * Two claims are tested, and the whole point of this file is that they are
 * tested SEPARATELY, because each one can pass for the wrong reason:
 *
 *   1. "AgentDocStore works with networking fully disabled." Easy to believe and
 *      easy to get wrong — a dependency resolving a hostname at startup, an
 *      asset fetched from a CDN, or a provider opening a socket would all break
 *      it. So the REST surface, the web UI and the stdio MCP server are each
 *      exercised end to end on a host with no interface but `lo`.
 *
 *   2. "The network fuse refuses outbound egress." In an air-gapped container
 *      EVERY outbound attempt fails, so a test that merely asserts "the request
 *      failed" proves nothing at all about the fuse. The probe therefore
 *      discriminates on WHICH error arrives: with the fuse armed the failure
 *      must be `OfflineViolationError` (refused before any socket), and after
 *      `release()` the same attempt must fail with a NETWORK error instead
 *      (DNS/unreachable). That pair is the evidence: the first shows the fuse
 *      intercepting, the second shows the air gap is genuinely there.
 *
 * Exit code 0 = every check passed. Output is one line per check.
 */

import net from 'node:net';
import http from 'node:http';
import os from 'node:os';
import dns from 'node:dns/promises';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP_ROOT = process.env.AIRGAP_APP_ROOT ?? '/app';
const CLI = `${APP_ROOT}/packages/cli/dist/index.js`;
const FUSE_MODULE = `file://${APP_ROOT}/packages/cli/dist/fuse.js`;
const PORT = Number(process.env.AIRGAP_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;

/** A public name/address that must be unreachable in here. */
const PUBLIC_HOST = 'registry.npmjs.org';
const PUBLIC_IP = '93.184.216.34';

let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
  return ok;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True when the error is the app's own refusal rather than a transport error. */
function isFuseRefusal(err) {
  return (
    err !== null &&
    typeof err === 'object' &&
    (err.code === 'OFFLINE_VIOLATION' || err.name === 'OfflineViolationError')
  );
}

/** True when the error came from the network stack (no route, no DNS, refused). */
function isTransportError(err) {
  const code = err?.code ?? err?.cause?.code ?? '';
  return [
    'ENOTFOUND',
    'EAI_AGAIN',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'ERR_SOCKET_CONNECTION_TIMEOUT',
  ].includes(code);
}

function describeError(err) {
  const code = err?.code ?? err?.cause?.code ?? '';
  return `${err?.name ?? 'Error'}${code ? `(${code})` : ''}: ${String(err?.message ?? err).slice(0, 90)}`;
}

// ---------------------------------------------------------------------------
// A. The air gap is real
// ---------------------------------------------------------------------------

async function checkAirGap() {
  console.log('\n--- A. environment: is the network actually disabled? ---');

  const routable = Object.entries(os.networkInterfaces()).flatMap(([name, addrs]) =>
    (addrs ?? []).filter((a) => !a.internal).map((a) => `${name}=${a.address}`),
  );
  check(
    'no non-loopback network interface exists',
    routable.length === 0,
    routable.length === 0 ? 'only loopback present' : `found ${routable.join(', ')}`,
  );

  let dnsFailed = false;
  let dnsDetail;
  try {
    const res = await dns.lookup(PUBLIC_HOST);
    dnsDetail = `resolved to ${res.address}`;
  } catch (err) {
    dnsFailed = true;
    dnsDetail = describeError(err);
  }
  check(`DNS cannot resolve ${PUBLIC_HOST}`, dnsFailed, dnsDetail);
}

// ---------------------------------------------------------------------------
// B. The application works with no network
// ---------------------------------------------------------------------------

async function startServer(dataDir) {
  const child = spawn(process.execPath, [CLI, 'serve', '--data', dataDir, '--port', String(PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d.toString()));
  child.stderr.on('data', (d) => (log += d.toString()));

  for (let i = 0; i < 60; i += 1) {
    await sleep(250);
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return { child, log: () => log };
    } catch {
      // Not up yet.
    }
    if (child.exitCode !== null) break;
  }
  throw new Error(`server did not become ready. Output:\n${log}`);
}

async function checkApplication(server) {
  console.log('\n--- B. application: full surface with no network ---');

  const health = await (await fetch(`${BASE}/healthz`)).json();
  check(
    'server reports offline mode on /healthz',
    health.mode === 'offline',
    `mode=${health.mode}`,
  );
  check(
    'provider declares it needs no network',
    health.provider?.requiresNetwork === false,
    `provider=${health.provider?.name}, requiresNetwork=${health.provider?.requiresNetwork}`,
  );

  const home = await fetch(`${BASE}/`);
  const html = await home.text();
  check(
    'web UI is served from bundled assets',
    home.ok && html.includes('AgentDocStore'),
    `status=${home.status}, ${html.length} bytes`,
  );
  check(
    'no external asset reference in the served page',
    !/(src|href)\s*=\s*["']https?:\/\//i.test(html),
    'no absolute http(s) src/href',
  );

  // Create.
  const created = await (
    await fetch(`${BASE}/api/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Air-gap doc',
        content: 'first version, offline',
        language: 'plaintext',
      }),
    })
  ).json();
  const id = created.id;
  check('POST /api/documents creates a doc', typeof id === 'string' && id.length > 0, `id=${id}`);
  if (typeof id !== 'string') return;

  // Read + raw.
  const read = await (await fetch(`${BASE}/api/documents/${id}`)).json();
  check(
    'GET /api/documents/:id round-trips the content',
    read.content === 'first version, offline',
  );
  const raw = await fetch(`${BASE}/raw/${id}`);
  check('GET /raw/:id returns the text', (await raw.text()) === 'first version, offline');

  // Update -> versions -> diff.
  await fetch(`${BASE}/api/documents/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'second version, still offline' }),
  });
  const versions = await (await fetch(`${BASE}/api/documents/${id}/versions`)).json();
  check(
    'an update appends a version',
    versions.versions?.length === 2,
    `versions=${versions.versions?.length}`,
  );

  const diff = await (await fetch(`${BASE}/api/documents/${id}/diff?from=1&to=2`)).json();
  check(
    'diff between versions is produced locally',
    typeof diff.diff === 'string' && diff.diff.includes('second version'),
    `${diff.diff?.length ?? 0} bytes`,
  );

  // Search (local MiniSearch index, not a service call).
  const search = await (await fetch(`${BASE}/api/documents?query=offline`)).json();
  const hit = (search.items ?? []).some((b) => b.id === id);
  check('local full-text search finds the doc', hit, `${(search.items ?? []).length} hit(s)`);

  // Comments.
  const comment = await (
    await fetch(`${BASE}/api/documents/${id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'offline comment' }),
    })
  ).json();
  const comments = await (await fetch(`${BASE}/api/documents/${id}/comments`)).json();
  check(
    'comments persist locally',
    comments.comments?.some((c) => c.id === comment.id && c.body === 'offline comment') === true,
    `${comments.comments?.length ?? 0} comment(s)`,
  );

  // Credential scanner — the 409 detect-then-policy flow. The fake key is
  // split so no literal credential sits in the source.
  const scanRes = await fetch(`${BASE}/api/documents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'secret',
      content: 'AWS_SECRET_ACCESS_KEY = ' + 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      language: 'plaintext',
    }),
  });
  const scanBody = scanRes.status === 409 ? await scanRes.json() : {};
  check(
    'credential scan returns 409 with redact/skip options',
    scanRes.status === 409 && Array.isArray(scanBody.detected) && scanBody.detected.length > 0,
    `status=${scanRes.status}, detected=${JSON.stringify(scanBody.detected ?? null)}`,
  );

  // Delete.
  await fetch(`${BASE}/api/documents/${id}`, { method: 'DELETE' });
  const gone = await fetch(`${BASE}/api/documents/${id}`);
  check('delete removes the doc', gone.status === 404, `status=${gone.status}`);

  void server;
}

// ---------------------------------------------------------------------------
// C. The fuse, distinguished from the air gap
// ---------------------------------------------------------------------------

async function checkFuse() {
  console.log('\n--- C. fuse: refusal must be the fuse, not the missing NIC ---');

  const { installNetworkFuse } = await import(FUSE_MODULE);
  const fuse = installNetworkFuse();

  // C1 — fetch to a public host must be REFUSED BY THE FUSE, not by DNS.
  let fetchErr;
  try {
    await fetch(`https://${PUBLIC_HOST}/`);
    fetchErr = null;
  } catch (err) {
    fetchErr = err;
  }
  check(
    'fuse refuses fetch() to a public host before any socket',
    fetchErr !== null && isFuseRefusal(fetchErr),
    fetchErr === null ? 'the fetch SUCCEEDED' : describeError(fetchErr),
  );

  // C2 — a raw socket to a public IP must throw synchronously.
  let connectErr;
  try {
    const sock = net.connect({ host: PUBLIC_IP, port: 443 });
    sock.destroy();
    connectErr = null;
  } catch (err) {
    connectErr = err;
  }
  check(
    'fuse refuses a raw socket to a public address',
    connectErr !== null && isFuseRefusal(connectErr),
    connectErr === null ? 'the connect was ALLOWED' : describeError(connectErr),
  );

  // C2b — the library path: http.get goes Agent -> net.createConnection ->
  // Socket.prototype.connect, never touching the patched fetch. This is the
  // route a telemetry call or a database driver would take.
  let httpErr;
  try {
    const req = http.get(`http://${PUBLIC_HOST}/`);
    req.on('error', () => undefined);
    req.destroy();
    httpErr = null;
  } catch (err) {
    httpErr = err;
  }
  check(
    'fuse refuses http.get(), which never touches the patched fetch',
    httpErr !== null && isFuseRefusal(httpErr),
    httpErr === null ? 'the request was ALLOWED' : describeError(httpErr),
  );

  // C3 — loopback must still work, or the fuse would break the program it guards.
  let loopbackOk = false;
  let loopbackDetail;
  try {
    const res = await fetch(`${BASE}/healthz`);
    loopbackOk = res.ok;
    loopbackDetail = `status=${res.status}`;
  } catch (err) {
    loopbackDetail = describeError(err);
  }
  check('fuse still permits loopback traffic', loopbackOk, loopbackDetail);

  check(
    'fuse recorded the refused destinations',
    fuse.violations.length >= 3,
    `violations=[${fuse.violations.join(', ')}]`,
  );

  // C4 — release, then retry. The failure mode must CHANGE: a transport error
  // now, not a refusal. Same call, different error = the fuse was the reason
  // before, and the air gap is the reason now.
  fuse.release();
  let afterErr;
  try {
    await fetch(`https://${PUBLIC_HOST}/`);
    afterErr = null;
  } catch (err) {
    afterErr = err;
  }
  check(
    'with the fuse released the SAME call fails as a transport error',
    afterErr !== null && !isFuseRefusal(afterErr) && isTransportError(afterErr),
    afterErr === null
      ? 'the fetch SUCCEEDED — this container is NOT air-gapped'
      : describeError(afterErr),
  );
}

// ---------------------------------------------------------------------------
// D. stdio MCP with no server and no network
// ---------------------------------------------------------------------------

async function checkMcpStdio(dataDir) {
  console.log('\n--- D. stdio MCP: full tool access with nothing listening ---');

  const requests = [
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"airgap","version":"1.0"}}}',
    '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_document","arguments":{"title":"MCP air-gap","content":"made with no network","language":"plaintext"}}}',
  ];

  const out = await new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, 'mcp', '--data', dataDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.stdin.write(`${requests.join('\n')}\n`);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 20_000);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve({ stdout, stderr });
    });
    // The server stays open on stdio; close stdin after the batch so it exits.
    setTimeout(() => child.stdin.end(), 6000);
  });

  const lines = out.stdout
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((v) => v !== null);

  const init = lines.find((m) => m.id === 1);
  check(
    'MCP initialize handshake completes',
    init?.result?.protocolVersion !== undefined,
    out.stderr.slice(0, 120),
  );

  const tools = lines.find((m) => m.id === 2);
  const toolCount = tools?.result?.tools?.length;
  check('tools/list exposes all 16 tools', toolCount === 16, `tools=${toolCount}`);

  const create = lines.find((m) => m.id === 3);
  const createdOk = create?.result !== undefined && create?.result?.isError !== true;
  check(
    'create_document succeeds over stdio with no server',
    createdOk,
    JSON.stringify(create?.result ?? create?.error ?? {}).slice(0, 120),
  );
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(`AgentDocStore air-gap probe — node ${process.version}, app root ${APP_ROOT}`);

  await checkAirGap();

  const dataDir = mkdtempSync(join(tmpdir(), 'airgap-'));
  const mcpDataDir = mkdtempSync(join(tmpdir(), 'airgap-mcp-'));

  let server;
  try {
    server = await startServer(dataDir);
  } catch (err) {
    check('server starts in the air-gapped container', false, describeError(err));
    console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  check('server starts in the air-gapped container', true, `listening on ${BASE}`);

  try {
    await checkApplication(server);
    await checkFuse();
    await checkMcpStdio(mcpDataDir);
  } finally {
    server.child.kill('SIGTERM');
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.log(`[FAIL] probe crashed — ${describeError(err)}`);
  console.log(err?.stack ?? '');
  process.exit(1);
});
