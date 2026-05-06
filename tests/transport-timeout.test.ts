import { describe, it, expect } from 'vitest';
import { NotebookClient } from '../src/client.js';
import type { Transport, TransportRequest } from '../src/transport.js';
import type { NotebookRpcSession } from '../src/types.js';

/**
 * Web-UI traces (Proxyman, 2026-05-06) show GenerateFreeFormStreamed taking up
 * to 120s on a 31-source notebook. Default transport timeouts in this repo are
 * 60s (curl-impersonate, tls-client) — they would kill chat mid-stream.
 *
 * Behaviour we lock in here:
 *   - chat-stream calls pass `timeoutMs: 300_000` so the underlying
 *     transport overrides its 60s default.
 *   - Non-chat batchexecute calls leave `timeoutMs` unset, so they keep the
 *     short default and fail fast on stuck connections.
 */
class CapturingTransport implements Transport {
  calls: TransportRequest[] = [];

  async execute(req: TransportRequest): Promise<string> {
    this.calls.push(req);

    if (req.url.endsWith('/GenerateFreeFormStreamed')) {
      // Mock chat response: parser expects [text, null, [threadId, respId, ...]]
      const inner = ['mock reply', null, ['mock-thread', 'mock-resp', 0]];
      const env = [['wrb.fr', 'oid', JSON.stringify(inner), null]];
      const json = JSON.stringify(env);
      return `)]}'\n${json.length}\n${json}`;
    }
    throw new Error(`unexpected URL: ${req.url}`);
  }

  getSession(): NotebookRpcSession {
    return {
      cookies: [],
      at: 'at',
      bl: 'bl',
      fsid: 'fsid',
      language: 'en',
      lastUpdated: 0,
    } as NotebookRpcSession;
  }
  async refreshSession(): Promise<void> {}
  async dispose(): Promise<void> {}
}

function makeClient(mock: CapturingTransport): NotebookClient {
  const c = new NotebookClient();
  // Bypass connect() — inject the mock directly.
  (c as unknown as { transport: Transport; transportMode: string }).transport = mock;
  (c as unknown as { transport: Transport; transportMode: string }).transportMode = 'http';
  return c;
}

describe('transport timeout — chat-stream', () => {
  it('callChatStream sets timeoutMs=300_000 (5min) on the request', async () => {
    const mock = new CapturingTransport();
    const c = makeClient(mock);

    await c.callChatStream('notebook-uuid', 'hi', ['src-1']);

    expect(mock.calls).toHaveLength(1);
    const req = mock.calls[0]!;
    expect(req.url).toContain('/GenerateFreeFormStreamed');
    expect(req.timeoutMs).toBe(300_000);
  });
});
