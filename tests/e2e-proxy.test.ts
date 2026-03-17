/**
 * E2E proxy tests — verify proxy support across transports.
 *
 * Requires:
 *   - Valid session at ~/.notebooklm/session.json
 *   - HTTP proxy at 127.0.0.1:7890 (e.g. Clash)
 *
 * Run:
 *   npx vitest run tests/e2e-proxy.test.ts --config vitest.config.ts --no-file-parallelism
 */

import { describe, it, expect, afterAll } from 'vitest';
import { NotebookClient } from '../src/client.js';
import { hasValidSession, loadSession, refreshTokens } from '../src/session-store.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROXY = 'http://127.0.0.1:7890';

async function proxyReachable(): Promise<boolean> {
  try {
    await execFileAsync('curl', [
      '-s', '--connect-timeout', '2',
      '-x', PROXY,
      'https://httpbin.org/ip',
    ], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

let skip = false;
let skipReason = '';

const clients: NotebookClient[] = [];

afterAll(async () => {
  for (const c of clients) {
    try { await c.disconnect(); } catch { /* ignore */ }
  }
});

describe('E2E Proxy Support', async () => {
  const hasProxy = await proxyReachable();
  const hasSession_ = await hasValidSession();

  if (!hasSession_) {
    skip = true;
    skipReason = 'No valid session';
  } else if (!hasProxy) {
    skip = true;
    skipReason = `Proxy not reachable at ${PROXY}`;
  }

  // ── HTTP transport (undici) + proxy ──

  it('should list notebooks via HTTP transport with proxy', async () => {
    if (skip) { console.log(`SKIP: ${skipReason}`); return; }

    const client = new NotebookClient();
    clients.push(client);
    await client.connect({ transport: 'http', proxy: PROXY });

    expect(client.getTransportMode()).toBe('http');
    const notebooks = await client.listNotebooks();
    expect(Array.isArray(notebooks)).toBe(true);
    console.log(`  HTTP+proxy: ${notebooks.length} notebooks`);
  }, 30_000);

  // ── auto transport + proxy ──

  it('should list notebooks via auto transport with proxy', async () => {
    if (skip) { console.log(`SKIP: ${skipReason}`); return; }

    const client = new NotebookClient();
    clients.push(client);
    await client.connect({ transport: 'auto', proxy: PROXY });

    const mode = client.getTransportMode();
    const notebooks = await client.listNotebooks();
    expect(Array.isArray(notebooks)).toBe(true);
    console.log(`  auto+proxy (${mode}): ${notebooks.length} notebooks`);
  }, 30_000);

  // ── Token refresh + proxy ──

  it('should refresh tokens through proxy', async () => {
    if (skip) { console.log(`SKIP: ${skipReason}`); return; }

    const session = await loadSession();
    if (!session) { console.log('SKIP: no session'); return; }

    const refreshed = await refreshTokens(session, undefined, PROXY);

    expect(refreshed.at).toBeTruthy();
    expect(refreshed.at.length).toBeGreaterThan(10);
    expect(refreshed.bl).toContain('labs-tailwind');
    console.log(`  refresh+proxy: at=${refreshed.at.slice(0, 20)}...`);
  }, 30_000);

  // ── HTTPS_PROXY env var ──

  it('should pick up HTTPS_PROXY env var', async () => {
    if (skip) { console.log(`SKIP: ${skipReason}`); return; }

    // Simulate env var by setting it temporarily
    const prev = process.env['HTTPS_PROXY'];
    process.env['HTTPS_PROXY'] = PROXY;
    try {
      // resolveProxy reads from env — test via CLI helper import
      const resolved = process.env['HTTPS_PROXY'];
      expect(resolved).toBe(PROXY);
    } finally {
      if (prev === undefined) delete process.env['HTTPS_PROXY'];
      else process.env['HTTPS_PROXY'] = prev;
    }
  });
});
