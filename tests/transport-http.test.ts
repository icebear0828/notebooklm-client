import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpTransport } from '../src/transport-http.js';
import type { NotebookRpcSession } from '../src/types.js';
import type { TransportRequest } from '../src/transport.js';

// Mock undici
vi.mock('undici', () => {
  const mockRequest = vi.fn();
  return {
    request: mockRequest,
    Agent: vi.fn().mockImplementation(() => ({
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

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

function makeRequest(): TransportRequest {
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
  };
}

describe('HttpTransport', () => {
  let transport: HttpTransport;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (transport) await transport.dispose();
  });

  it('should construct with a session', () => {
    transport = new HttpTransport({ session: makeSession() });
    expect(transport.getSession().at).toBe('csrf-token-abc');
  });

  it('should return session data via getSession()', () => {
    const session = makeSession({ at: 'my-token', bl: 'my-bl' });
    transport = new HttpTransport({ session });

    const result = transport.getSession();
    expect(result.at).toBe('my-token');
    expect(result.bl).toBe('my-bl');
    expect(result.cookies).toBe('SID=abc; HSID=def; SSID=ghi');
  });

  it('should execute a request via undici', async () => {
    const { request: mockRequest } = await import('undici');
    const mockedRequest = vi.mocked(mockRequest);

    mockedRequest.mockResolvedValueOnce({
      statusCode: 200,
      body: { text: vi.fn().mockResolvedValue(')]}\'\n[[["wrb.fr","CCqFvf","[\\"nb-id\\"]"]]]') },
    } as never);

    transport = new HttpTransport({ session: makeSession() });
    const result = await transport.execute(makeRequest());

    expect(result).toContain('wrb.fr');
    expect(mockedRequest).toHaveBeenCalledOnce();

    // Verify the URL contains the expected query params
    const callArgs = mockedRequest.mock.calls[0];
    expect(callArgs[0]).toContain('rpcids=CCqFvf');
  });

  it('should include Chrome-like headers', async () => {
    const { request: mockRequest } = await import('undici');
    const mockedRequest = vi.mocked(mockRequest);

    mockedRequest.mockResolvedValueOnce({
      statusCode: 200,
      body: { text: vi.fn().mockResolvedValue('ok') },
    } as never);

    transport = new HttpTransport({ session: makeSession() });
    await transport.execute(makeRequest());

    const callOpts = mockedRequest.mock.calls[0][1] as Record<string, unknown>;
    const headers = callOpts.headers as Record<string, string>;

    expect(headers['Cookie']).toBe('SID=abc; HSID=def; SSID=ghi');
    expect(headers['Origin']).toBe('https://notebooklm.google.com');
    expect(headers['Sec-Ch-Ua']).toContain('Chromium');
    expect(headers['Sec-Fetch-Mode']).toBe('cors');
    expect(headers['X-Same-Domain']).toBe('1');
  });

  it('should throw SessionError on 401 and call onSessionExpired', async () => {
    const { request: mockRequest } = await import('undici');
    const mockedRequest = vi.mocked(mockRequest);

    const refreshedSession = makeSession({ at: 'refreshed-token' });
    const onSessionExpired = vi.fn().mockResolvedValue(refreshedSession);

    // First call returns 401, second returns 200
    mockedRequest
      .mockResolvedValueOnce({
        statusCode: 401,
        body: { text: vi.fn().mockResolvedValue('Unauthorized') },
      } as never)
      .mockResolvedValueOnce({
        statusCode: 200,
        body: { text: vi.fn().mockResolvedValue('success') },
      } as never);

    transport = new HttpTransport({ session: makeSession(), onSessionExpired });
    const result = await transport.execute(makeRequest());

    expect(result).toBe('success');
    expect(onSessionExpired).toHaveBeenCalledOnce();
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  it('should throw when 401 and no onSessionExpired', async () => {
    const { request: mockRequest } = await import('undici');
    const mockedRequest = vi.mocked(mockRequest);

    mockedRequest.mockResolvedValueOnce({
      statusCode: 401,
      body: { text: vi.fn().mockResolvedValue('Unauthorized') },
    } as never);

    transport = new HttpTransport({ session: makeSession() });
    await expect(transport.execute(makeRequest())).rejects.toThrow('HTTP 401');
  });

  it('should throw on non-2xx non-auth errors', async () => {
    const { request: mockRequest } = await import('undici');
    const mockedRequest = vi.mocked(mockRequest);

    mockedRequest.mockResolvedValueOnce({
      statusCode: 500,
      body: { text: vi.fn().mockResolvedValue('Internal Server Error') },
    } as never);

    transport = new HttpTransport({ session: makeSession() });
    await expect(transport.execute(makeRequest())).rejects.toThrow('HTTP 500');
  });

  it('should update session via updateSession()', () => {
    transport = new HttpTransport({ session: makeSession() });

    const newSession = makeSession({ at: 'updated-token' });
    transport.updateSession(newSession);

    expect(transport.getSession().at).toBe('updated-token');
  });
});
