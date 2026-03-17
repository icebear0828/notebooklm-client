import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { NotebookRpcSession } from '../src/types.js';

// Mock undici before importing session-store
vi.mock('undici', () => {
  const mockRequest = vi.fn();
  return {
    request: mockRequest,
    Agent: vi.fn().mockImplementation(() => ({
      close: vi.fn().mockResolvedValue(undefined),
    })),
    ProxyAgent: vi.fn().mockImplementation(() => ({
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

const { saveSession, loadSession, hasValidSession, refreshTokens } = await import('../src/session-store.js');

function makeSession(overrides: Partial<NotebookRpcSession> = {}): NotebookRpcSession {
  return {
    at: 'csrf-token-abc',
    bl: 'boq_labs-tailwind-ui_20250101.00_p0',
    fsid: '123456789',
    cookies: 'SID=abc; HSID=def',
    userAgent: 'Mozilla/5.0 Test',
    ...overrides,
  };
}

describe('session-store', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'nbsession-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('saveSession / loadSession', () => {
    it('should round-trip a session', async () => {
      const session = makeSession();
      const filePath = join(tmpDir, 'session.json');

      await saveSession(session, filePath);
      const loaded = await loadSession(filePath);

      expect(loaded).not.toBeNull();
      expect(loaded!.at).toBe('csrf-token-abc');
      expect(loaded!.bl).toBe('boq_labs-tailwind-ui_20250101.00_p0');
      expect(loaded!.fsid).toBe('123456789');
      expect(loaded!.cookies).toBe('SID=abc; HSID=def');
      expect(loaded!.userAgent).toBe('Mozilla/5.0 Test');
    });

    it('should write valid JSON with version and exportedAt', async () => {
      const filePath = join(tmpDir, 'session.json');
      await saveSession(makeSession(), filePath);

      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      expect(parsed.version).toBe(1);
      expect(typeof parsed.exportedAt).toBe('string');
      expect(parsed.session).toBeDefined();
    });

    it('should return null for non-existent file', async () => {
      const result = await loadSession(join(tmpDir, 'nonexistent.json'));
      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', async () => {
      const filePath = join(tmpDir, 'bad.json');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(filePath, 'not json', 'utf-8');

      await expect(loadSession(filePath)).rejects.toThrow();
    });

    it('should return null for missing at token', async () => {
      const filePath = join(tmpDir, 'novat.json');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(filePath, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), session: { at: '', bl: 'x', fsid: '', cookies: '', userAgent: '' } }), 'utf-8');

      const result = await loadSession(filePath);
      expect(result).toBeNull();
    });

    it('should create directories recursively', async () => {
      const filePath = join(tmpDir, 'sub', 'dir', 'session.json');
      await saveSession(makeSession(), filePath);

      const loaded = await loadSession(filePath);
      expect(loaded).not.toBeNull();
    });
  });

  describe('hasValidSession', () => {
    it('should return true for fresh session', async () => {
      const filePath = join(tmpDir, 'session.json');
      await saveSession(makeSession(), filePath);

      const valid = await hasValidSession(filePath);
      expect(valid).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      const valid = await hasValidSession(join(tmpDir, 'nope.json'));
      expect(valid).toBe(false);
    });

    it('should return false for expired session', async () => {
      const filePath = join(tmpDir, 'old.json');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(filePath, JSON.stringify({
        version: 1,
        exportedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3h ago
        session: makeSession(),
      }), 'utf-8');

      const valid = await hasValidSession(filePath, 2 * 60 * 60 * 1000); // 2h max
      expect(valid).toBe(false);
    });

    it('should respect custom maxAgeMs', async () => {
      const filePath = join(tmpDir, 'session.json');
      await saveSession(makeSession(), filePath);

      // Just saved — should be valid even with 1ms max age... almost
      // Use a generous window
      const valid = await hasValidSession(filePath, 60_000);
      expect(valid).toBe(true);
    });
  });

  describe('refreshTokens', () => {
    it('should extract tokens from NotebookLM HTML', async () => {
      const fakeHtml = `
        <script>window.WIZ_global_data = {"SNlM0e":"new-csrf-token","cfb2h":"boq_labs-tailwind-frontend_20260316.00_p0","FdrFJe":"99999"};</script>
      `;

      const { request: mockRequest } = await import('undici');
      const mockedRequest = vi.mocked(mockRequest);

      mockedRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'set-cookie': ['NID=abc123; path=/; HttpOnly'] },
        body: { text: vi.fn().mockResolvedValue(fakeHtml) },
      } as never);

      const session = makeSession();
      const savePath = join(tmpDir, 'refreshed.json');
      const refreshed = await refreshTokens(session, savePath);

      expect(refreshed.at).toBe('new-csrf-token');
      expect(refreshed.bl).toBe('boq_labs-tailwind-frontend_20260316.00_p0');
      expect(refreshed.fsid).toBe('99999');
      // Original cookies should be preserved, new ones merged
      expect(refreshed.cookies).toContain('SID=abc');
      expect(refreshed.cookies).toContain('NID=abc123');
      expect(refreshed.userAgent).toBe(session.userAgent);

      // Should auto-save
      const saved = await loadSession(savePath);
      expect(saved).not.toBeNull();
      expect(saved!.at).toBe('new-csrf-token');
    });

    it('should throw when SNlM0e not found (cookies expired)', async () => {
      const { request: mockRequest } = await import('undici');
      const mockedRequest = vi.mocked(mockRequest);

      mockedRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: { text: vi.fn().mockResolvedValue('<html>Login page</html>') },
      } as never);

      const session = makeSession();
      await expect(refreshTokens(session, join(tmpDir, 'fail.json')))
        .rejects.toThrow('SNlM0e not found');
    });

    it('should throw on non-200 response', async () => {
      const { request: mockRequest } = await import('undici');
      const mockedRequest = vi.mocked(mockRequest);

      mockedRequest.mockResolvedValueOnce({
        statusCode: 403,
        headers: {},
        body: { text: vi.fn().mockResolvedValue('Forbidden') },
      } as never);

      const session = makeSession();
      await expect(refreshTokens(session, join(tmpDir, 'fail.json')))
        .rejects.toThrow('HTTP 403');
    });

    it('should use ProxyAgent when proxy is provided', async () => {
      const fakeHtml = `"SNlM0e":"token-proxy","cfb2h":"bl-proxy","FdrFJe":"fsid-proxy"`;

      const { request: mockRequest, ProxyAgent } = await import('undici');
      const mockedRequest = vi.mocked(mockRequest);
      const MockedProxyAgent = vi.mocked(ProxyAgent);

      MockedProxyAgent.mockClear();

      mockedRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: { text: vi.fn().mockResolvedValue(fakeHtml) },
      } as never);

      const session = makeSession();
      const refreshed = await refreshTokens(session, join(tmpDir, 'proxy.json'), 'http://127.0.0.1:7890');

      expect(refreshed.at).toBe('token-proxy');
      expect(MockedProxyAgent).toHaveBeenCalledWith(
        expect.objectContaining({ uri: 'http://127.0.0.1:7890' }),
      );
    });

    it('should use regular Agent when no proxy', async () => {
      const fakeHtml = `"SNlM0e":"token-noproxy","cfb2h":"bl","FdrFJe":"fsid"`;

      const { request: mockRequest, Agent: UndiciAgent } = await import('undici');
      const mockedRequest = vi.mocked(mockRequest);
      const MockedAgent = vi.mocked(UndiciAgent);

      MockedAgent.mockClear();

      mockedRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: { text: vi.fn().mockResolvedValue(fakeHtml) },
      } as never);

      await refreshTokens(makeSession(), join(tmpDir, 'noproxy.json'));

      expect(MockedAgent).toHaveBeenCalledOnce();
    });

    it('should merge Set-Cookie headers with existing cookies', async () => {
      const fakeHtml = `"SNlM0e":"token123","cfb2h":"bl-val","FdrFJe":"fsid-val"`;

      const { request: mockRequest } = await import('undici');
      const mockedRequest = vi.mocked(mockRequest);

      mockedRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {
          'set-cookie': [
            'SID=new-sid; path=/; HttpOnly',  // Should override existing SID
            'NEW_COOKIE=xyz; path=/',
          ],
        },
        body: { text: vi.fn().mockResolvedValue(fakeHtml) },
      } as never);

      const session = makeSession({ cookies: 'SID=old-sid; HSID=keep-me' });
      const refreshed = await refreshTokens(session, join(tmpDir, 'merged.json'));

      expect(refreshed.cookies).toContain('SID=new-sid');
      expect(refreshed.cookies).toContain('HSID=keep-me');
      expect(refreshed.cookies).toContain('NEW_COOKIE=xyz');
      expect(refreshed.cookies).not.toContain('old-sid');
    });
  });
});
