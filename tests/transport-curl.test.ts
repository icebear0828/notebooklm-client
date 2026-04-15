import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NotebookRpcSession } from '../src/types.js';
import type { TransportRequest } from '../src/transport.js';

// Mock child_process and fs before importing CurlTransport
const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

let lastWrittenCookieFile = '';
let lastWrittenCookieContent = '';
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    writeFileSync: (path: string, content: string) => {
      lastWrittenCookieFile = path;
      lastWrittenCookieContent = content;
    },
    unlinkSync: () => {},
  };
});

const { CurlTransport } = await import('../src/transport-curl.js');

function makeSession(overrides: Partial<NotebookRpcSession> = {}): NotebookRpcSession {
  return {
    at: 'csrf-token',
    bl: 'boq_labs-tailwind-frontend_20260312',
    fsid: '12345',
    cookies: 'SID=abc; HSID=def',
    userAgent: 'Mozilla/5.0 Test',
    ...overrides,
  };
}

function makeRequest(): TransportRequest {
  return {
    url: 'https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute',
    queryParams: { rpcids: 'CCqFvf', bl: 'test' },
    body: { 'f.req': '[[]]', at: 'csrf-token' },
  };
}

type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void;

function setupMock(handler: (cmd: string, args: string[], opts: unknown, cb: ExecFileCallback) => void) {
  mockExecFile.mockImplementation(handler);
}

describe('CurlTransport', () => {
  let transport: CurlTransport;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (transport) await transport.dispose();
  });

  it('should execute request and parse response body', async () => {
    setupMock((_cmd, args, _opts, cb) => {
      if (args[0] === '--version') {
        cb(null, 'curl 8.1.0 (BoringSSL)', '');
      } else {
        cb(null, ')]}\'\\n[["wrb.fr","CCqFvf"]]\n200', '');
      }
    });

    transport = new CurlTransport({ session: makeSession(), binaryPath: 'curl_chrome131' });
    const result = await transport.execute(makeRequest());
    expect(result).toContain('wrb.fr');
  });

  it('should include required headers in curl args', async () => {
    let capturedArgs: string[] = [];
    setupMock((_cmd, args, _opts, cb) => {
      if (args[0] === '--version') {
        cb(null, 'curl 8.1.0', '');
      } else {
        capturedArgs = args;
        cb(null, 'body\n200', '');
      }
    });

    transport = new CurlTransport({ session: makeSession(), binaryPath: 'curl_chrome131' });
    await transport.execute(makeRequest());

    expect(capturedArgs).toContain('-X');
    expect(capturedArgs).toContain('POST');
    expect(capturedArgs).toContain('--compressed');

    const headerValues = capturedArgs.filter((_: string, i: number) => capturedArgs[i - 1] === '-H');
    // Cookie should NOT be in -H args (passed via -b cookie file instead)
    expect(headerValues.some((h: string) => h.includes('Cookie:'))).toBe(false);
    // Cookie should be in -b file arg
    expect(capturedArgs).toContain('-b');
    const bIdx = capturedArgs.indexOf('-b');
    expect(capturedArgs[bIdx + 1]).toContain('nblm-curl-cookies');
    // Cookie content should be written to file in Netscape format
    expect(lastWrittenCookieContent).toContain('# Netscape HTTP Cookie File');
    expect(lastWrittenCookieContent).toContain('SID');
    expect(lastWrittenCookieContent).toContain('abc');

    expect(headerValues.some((h: string) => h.includes('X-Same-Domain: 1'))).toBe(true);
    expect(headerValues.some((h: string) => h.includes('Sec-Fetch-Mode: cors'))).toBe(true);
    expect(headerValues.some((h: string) => h.includes('Origin: https://notebooklm.google.com'))).toBe(true);
  });

  it('should throw on non-2xx status', async () => {
    setupMock((_cmd, args, _opts, cb) => {
      if (args[0] === '--version') cb(null, 'curl 8.1.0', '');
      else cb(null, 'Forbidden\n403', '');
    });

    transport = new CurlTransport({ session: makeSession(), binaryPath: 'curl_chrome131' });
    await expect(transport.execute(makeRequest())).rejects.toThrow('HTTP 403');
  });

  it('should retry with refreshed session on 401', async () => {
    let callCount = 0;
    setupMock((_cmd, args, _opts, cb) => {
      if (args[0] === '--version') {
        cb(null, 'curl 8.1.0', '');
        return;
      }
      callCount++;
      if (callCount === 1) cb(null, 'Unauthorized\n401', '');
      else cb(null, 'success\n200', '');
    });

    const onSessionExpired = vi.fn().mockResolvedValue(makeSession({ at: 'new-token' }));
    transport = new CurlTransport({
      session: makeSession(),
      binaryPath: 'curl_chrome131',
      onSessionExpired,
    });

    const result = await transport.execute(makeRequest());
    expect(result).toBe('success');
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });

  it('should add -x proxy flag when proxy is set', async () => {
    let capturedArgs: string[] = [];
    setupMock((_cmd, args, _opts, cb) => {
      if (args[0] === '--version') {
        cb(null, 'curl 8.1.0', '');
      } else {
        capturedArgs = args;
        cb(null, 'body\n200', '');
      }
    });

    transport = new CurlTransport({
      session: makeSession(),
      binaryPath: 'curl_chrome131',
      proxy: 'socks5://127.0.0.1:7890',
    });
    await transport.execute(makeRequest());

    const proxyIdx = capturedArgs.indexOf('-x');
    expect(proxyIdx).toBeGreaterThan(-1);
    expect(capturedArgs[proxyIdx + 1]).toBe('socks5://127.0.0.1:7890');
  });

  it('should not add -x flag when no proxy', async () => {
    let capturedArgs: string[] = [];
    setupMock((_cmd, args, _opts, cb) => {
      if (args[0] === '--version') {
        cb(null, 'curl 8.1.0', '');
      } else {
        capturedArgs = args;
        cb(null, 'body\n200', '');
      }
    });

    transport = new CurlTransport({ session: makeSession(), binaryPath: 'curl_chrome131' });
    await transport.execute(makeRequest());

    expect(capturedArgs).not.toContain('-x');
  });

  it('should return session data', () => {
    transport = new CurlTransport({ session: makeSession({ at: 'my-token' }), binaryPath: 'test' });
    expect(transport.getSession().at).toBe('my-token');
  });

  it('should update session', () => {
    transport = new CurlTransport({ session: makeSession(), binaryPath: 'test' });
    transport.updateSession(makeSession({ at: 'updated' }));
    expect(transport.getSession().at).toBe('updated');
  });
});
