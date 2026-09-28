#!/usr/bin/env node

/**
 * Install the CLI the way users will, and check that it works.
 *
 * Packs @agentdocstore/core and agentdocstore, installs both tarballs into an
 * empty folder outside the repository, then checks that:
 *   - @agentdocstore/core is the only package installed from the scope (the
 *     server, MCP tools and built-in providers are inside the bundle),
 *   - `agentdocstore --version` prints the package's version,
 *   - `agentdocstore serve` answers /healthz and serves the web UI,
 *   - `agentdocstore mcp` answers over stdio and lists every MCP tool.
 *
 * Needs network access, for the third-party dependencies.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_TOOLS = 16;
const TIMEOUT_MS = 30_000;

const version = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8')).version;
const work = mkdtempSync(join(tmpdir(), 'agentdocstore-smoke-'));
const children = [];

function check(condition, message) {
  if (!condition) throw new Error(`CLI package smoke test failed: ${message}`);
}

/** Resolve with the first match of `pattern` in the child's stdout. */
function waitForOutput(child, pattern, what) {
  return new Promise((resolveMatch, reject) => {
    let seen = '';
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${what}. Output so far:\n${seen}`)),
      TIMEOUT_MS,
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      seen += chunk;
      const match = pattern.exec(seen);
      if (match !== null) {
        clearTimeout(timer);
        resolveMatch(match);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`${what}: the process exited with code ${code}. Output:\n${seen}`));
    });
  });
}

/** A minimal JSON-RPC client over a child's stdin and stdout, one message per line. */
function mcpClient(child) {
  const pending = new Map();
  let buffer = '';
  let nextId = 1;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line === '') continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        // Anything else on stdout would break every MCP client.
        for (const waiter of pending.values())
          waiter.reject(new Error(`stdout carried a non-JSON line: ${line}`));
        pending.clear();
        return;
      }
      const waiter = pending.get(message.id);
      if (waiter !== undefined) {
        pending.delete(message.id);
        waiter.resolve(message);
      }
    }
  });
  return {
    request(method, params) {
      const id = nextId++;
      return new Promise((resolveReply, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timed out waiting for MCP ${method}`)),
          TIMEOUT_MS,
        );
        pending.set(id, {
          resolve: (message) => {
            clearTimeout(timer);
            resolveReply(message);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    notify(method) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
    },
  };
}

try {
  // Each package's prepack script rebuilds what its tarball ships.
  execFileSync(
    'npm',
    [
      'pack',
      '--workspace',
      '@agentdocstore/core',
      '--workspace',
      'agentdocstore',
      '--pack-destination',
      work,
    ],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const tarballs = readdirSync(work)
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => join(work, name));
  check(tarballs.length === 2, `expected 2 tarballs, got ${tarballs.length}`);

  const app = join(work, 'app');
  mkdirSync(app);
  writeFileSync(
    join(app, 'package.json'),
    `${JSON.stringify({ name: 'agentdocstore-smoke', private: true })}\n`,
  );
  execFileSync('npm', ['install', '--no-audit', '--no-fund', ...tarballs], {
    cwd: app,
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const scoped = readdirSync(join(app, 'node_modules', '@agentdocstore'));
  check(
    scoped.join(',') === 'core',
    `only @agentdocstore/core should be installed, found: ${scoped.join(', ')}`,
  );

  const bin = join(app, 'node_modules', '.bin', 'agentdocstore');
  const printed = execFileSync(bin, ['--version'], { cwd: app, encoding: 'utf8' }).trim();
  check(printed === version, `--version printed "${printed}", expected "${version}"`);

  const server = spawn(bin, ['serve', '--ephemeral', '--port', '0'], {
    cwd: app,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  children.push(server);
  const [, url] = await waitForOutput(server, /ready at (http:\/\/\S+)/, 'the server to start');
  const health = await fetch(`${url}/healthz`);
  check(health.ok, `/healthz answered ${health.status}`);
  const page = await fetch(`${url}/`);
  const html = await page.text();
  check(page.ok && html.includes('app.js'), `/ answered ${page.status} without the web UI`);
  const script = await fetch(`${url}/app.js`);
  check(script.ok, `/app.js answered ${script.status}`);
  server.kill('SIGTERM');

  const mcp = spawn(bin, ['mcp', '--ephemeral'], { cwd: app, stdio: ['pipe', 'pipe', 'inherit'] });
  children.push(mcp);
  const client = mcpClient(mcp);
  const init = await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'agentdocstore-smoke', version },
  });
  check(init.result !== undefined, `initialize failed: ${JSON.stringify(init.error)}`);
  client.notify('notifications/initialized');
  const list = await client.request('tools/list', {});
  const tools = list.result?.tools ?? [];
  check(
    tools.length === EXPECTED_TOOLS,
    `mcp listed ${tools.length} tools, expected ${EXPECTED_TOOLS}`,
  );
  mcp.stdin.end();

  console.log(
    `CLI package smoke test passed: agentdocstore ${version} installed outside the repository; ` +
      `serve answered /healthz and served the web UI; mcp listed ${tools.length} tools.`,
  );
} finally {
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  rmSync(work, { recursive: true, force: true });
}
