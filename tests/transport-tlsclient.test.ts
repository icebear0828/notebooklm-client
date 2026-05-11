import { describe, it, expect } from 'vitest';
import { TlsClientTransport } from '../src/transport-tlsclient.js';
import type { TransportRequest } from '../src/transport.js';
import type { NotebookRpcSession } from '../src/types.js';

interface CapturedPost {
  url: string;
  body: string;
  opts?: Record<string, unknown>;
}

class MockTlsSessionClient {
  posts: CapturedPost[] = [];

  async post(url: string, body: string, opts?: Record<string, unknown>): Promise<{ status: number; body: string; headers: Record<string, string[]> }> {
    this.posts.push({ url, body, opts });
    return { status: 200, body: 'ok', headers: {} };
  }

  async get(): Promise<{ status: number; body: string; headers: Record<string, string[]> }> {
    return { status: 200, body: 'ok', headers: {} };
  }

  async destroySession(): Promise<void> {}
}

function makeSession(overrides: Partial<NotebookRpcSession> = {}): NotebookRpcSession {
  return {
    at: 'csrf-token-abc',
    bl: 'boq_labs-tailwind-ui_20250101.00_p0',
    fsid: '123456789',
    cookies: 'SID=abc; HSID=def; SSID=ghi',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<TransportRequest> = {}): TransportRequest {
  return {
    url: 'https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute',
    queryParams: {
      rpcids: 'CCqFvf',
      'source-path': '/',
      bl: 'boq_labs-tailwind-ui_20250101.00_p0',
      hl: 'en',
      _reqid: '200000',
      rt: 'c',
    },
    body: {
      'f.req': '[[["CCqFvf","[\\"\\"]",null,"generic"]]]',
      at: 'csrf-token-abc',
    },
    ...overrides,
  };
}

function makeTransport(mock: MockTlsSessionClient): TlsClientTransport {
  const transport = new TlsClientTransport({ session: makeSession() });
  (transport as unknown as { sessionClient: MockTlsSessionClient }).sessionClient = mock;
  return transport;
}

describe('TlsClientTransport', () => {
  it('does not set per-request timeoutSeconds when req.timeoutMs is unset', async () => {
    const mock = new MockTlsSessionClient();
    const transport = makeTransport(mock);

    await transport.execute(makeRequest());

    expect(mock.posts).toHaveLength(1);
    expect(mock.posts[0]?.opts?.timeoutSeconds).toBeUndefined();
  });

  it('passes req.timeoutMs as rounded-up timeoutSeconds', async () => {
    const mock = new MockTlsSessionClient();
    const transport = makeTransport(mock);

    await transport.execute(makeRequest({ timeoutMs: 300_001 }));

    expect(mock.posts).toHaveLength(1);
    expect(mock.posts[0]?.opts?.timeoutSeconds).toBe(301);
  });
});
