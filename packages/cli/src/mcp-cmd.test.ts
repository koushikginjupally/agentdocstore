/**
 * `agentdocstore mcp` over stdio. An MCP client shuts a stdio server down by
 * closing the server's stdin (then signalling only if it does not exit), so
 * that is when the data-dir lock must be released — or the next start on the
 * same data dir fails with "already locked". Requests that arrived before the
 * close must still finish.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveConfig } from './config.js';
import { runMcp } from './mcp-cmd.js';

const dirs: string[] = [];
const signalListeners = {
  SIGINT: process.listeners('SIGINT'),
  SIGTERM: process.listeners('SIGTERM'),
};

afterEach(() => {
  // runMcp installs process signal handlers; drop them so they cannot keep
  // the test worker alive or react to the runner's own signals.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    for (const listener of process.listeners(signal)) {
      if (!signalListeners[signal].includes(listener)) process.off(signal, listener);
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentdocstore-mcp-'));
  dirs.push(dir);
  return dir;
}

const message = (m: Record<string, unknown>): string =>
  JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n';

const INITIALIZE =
  message({
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    },
  }) + message({ method: 'notifications/initialized' });

function start(dataDir: string) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let exit!: (code: number) => void;
  const exited = new Promise<number>((resolve) => (exit = resolve));
  const lines: string[] = [];
  let buffered = '';
  stdout.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
    let end: number;
    while ((end = buffered.indexOf('\n')) >= 0) {
      lines.push(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
    }
  });
  /** The server's reply to request `id`, once it has been written. */
  const reply = async (id: number): Promise<Record<string, unknown>> => {
    for (let waited = 0; waited < 2000; waited += 10) {
      for (const line of lines) {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed['id'] === id) return parsed;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`no reply to request ${id}`);
  };
  const config = resolveConfig({ dataDir, user: 'bob' }, {}, dataDir);
  const running = runMcp(config, { stdin, stdout, exit });
  return { stdin, exited, running, reply };
}

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} did not happen within ${ms} ms`)), ms),
    ),
  ]);
}

describe('agentdocstore mcp (stdio)', () => {
  it('exits and releases the data-dir lock when the client closes stdin', async () => {
    const dataDir = tempDataDir();
    const lock = join(dataDir, '.agentdocstore.lock');

    const first = start(dataDir);
    await first.running;
    first.stdin.write(INITIALIZE);
    await first.reply(1);
    expect(existsSync(lock)).toBe(true);

    first.stdin.end();
    await expect(within(first.exited, 2000, 'Exit after stdin closed')).resolves.toBe(0);
    expect(existsSync(lock)).toBe(false);

    // So a restart on the same data dir works.
    const second = start(dataDir);
    await second.running;
    second.stdin.write(INITIALIZE);
    expect(await second.reply(1)).toMatchObject({ result: { serverInfo: expect.anything() } });
    second.stdin.end();
    await within(second.exited, 2000, 'Second exit');
  });

  it('finishes a write sent just before stdin closes', async () => {
    const dataDir = tempDataDir();

    const writer = start(dataDir);
    await writer.running;
    writer.stdin.end(
      INITIALIZE +
        message({
          id: 2,
          method: 'tools/call',
          params: {
            name: 'create_document',
            arguments: { title: 'Last words', content: 'x'.repeat(200_000) },
          },
        }),
    );
    await within(writer.exited, 4000, 'Exit after the write');
    expect(existsSync(join(dataDir, '.agentdocstore.lock'))).toBe(false);

    const reader = start(dataDir);
    await reader.running;
    reader.stdin.write(
      INITIALIZE +
        message({ id: 2, method: 'tools/call', params: { name: 'list_documents', arguments: {} } }),
    );
    const listed = (await reader.reply(2)) as { result: { content: Array<{ text: string }> } };
    const items = (
      JSON.parse(listed.result.content[0]!.text) as { items: Array<{ title: string }> }
    ).items;
    expect(items.map((d) => d.title)).toEqual(['Last words']);
    reader.stdin.end();
    await within(reader.exited, 2000, 'Reader exit');
  });
});
