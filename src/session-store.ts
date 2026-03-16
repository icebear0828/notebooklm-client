/**
 * Session persistence — save/load NotebookRpcSession to disk.
 *
 * Stored at ~/.notebooklm/session.json by default.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { request as undiciRequest } from 'undici';
import { CHROME_CIPHERS } from './tls-config.js';
import type { NotebookRpcSession } from './types.js';

const DEFAULT_SESSION_DIR = join(homedir(), '.notebooklm');
const DEFAULT_SESSION_FILE = 'session.json';

interface StoredSession {
  version: 1;
  exportedAt: string;
  session: NotebookRpcSession;
}

function defaultSessionPath(): string {
  return join(DEFAULT_SESSION_DIR, DEFAULT_SESSION_FILE);
}

/**
 * Save a session to disk.
 */
export async function saveSession(
  session: NotebookRpcSession,
  path?: string,
): Promise<string> {
  const filePath = path ?? defaultSessionPath();
  const dir = join(filePath, '..');

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const stored: StoredSession = {
    version: 1,
    exportedAt: new Date().toISOString(),
    session,
  };

  await writeFile(filePath, JSON.stringify(stored, null, 2), 'utf-8');
  return filePath;
}

/**
 * Load a session from disk. Returns null if file doesn't exist.
 */
export async function loadSession(
  path?: string,
): Promise<NotebookRpcSession | null> {
  const filePath = path ?? defaultSessionPath();

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }

  const stored = JSON.parse(raw) as StoredSession;

  if (stored.version !== 1 || !stored.session?.at) {
    return null;
  }

  return stored.session;
}

/**
 * Check if a stored session exists and is reasonably fresh.
 * Google sessions typically last hours, not days.
 */
export async function hasValidSession(
  path?: string,
  maxAgeMs = 2 * 60 * 60 * 1000, // 2 hours default
): Promise<boolean> {
  const filePath = path ?? defaultSessionPath();

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return false;
  }

  try {
    const stored = JSON.parse(raw) as StoredSession;
    if (!stored.exportedAt || !stored.session?.at) return false;

    const age = Date.now() - new Date(stored.exportedAt).getTime();
    return age < maxAgeMs;
  } catch {
    return false;
  }
}

/**
 * Refresh short-lived tokens (at, bl, fsid) using long-lived cookies.
 *
 * Makes a GET request to the NotebookLM dashboard and extracts
 * WIZ_global_data values from the HTML. No browser needed.
 *
 * Cookies (SID, HSID, etc.) last weeks/months. Tokens (SNlM0e) expire in ~1-2h.
 * This function bridges the gap — as long as cookies are valid, we can
 * keep refreshing tokens indefinitely.
 */
export async function refreshTokens(
  session: NotebookRpcSession,
  savePath?: string,
): Promise<NotebookRpcSession> {
  const ua = session.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  const { statusCode, body, headers } = await undiciRequest('https://notebooklm.google.com/', {
    method: 'GET',
    headers: {
      'User-Agent': ua,
      'Cookie': session.cookies,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    dispatcher: new (await import('undici')).Agent({
      connect: {
        ciphers: CHROME_CIPHERS,
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.3',
        ALPNProtocols: ['h2', 'http/1.1'],
      } as Record<string, unknown>,
    }),
  });

  const html = await body.text();

  if (statusCode !== 200) {
    throw new Error(`Token refresh failed: HTTP ${statusCode}`);
  }

  // Extract tokens from WIZ_global_data in the HTML
  const atMatch = /"SNlM0e":"([^"]+)"/.exec(html);
  const blMatch = /"cfb2h":"([^"]+)"/.exec(html);
  const fsidMatch = /"FdrFJe":"([^"]+)"/.exec(html);
  // Extract language from <html lang="en"> or keep existing
  const langMatch = /<html[^>]*\slang="([^"]+)"/.exec(html);

  if (!atMatch?.[1]) {
    throw new Error('Token refresh failed: SNlM0e not found in page (cookies may be expired)');
  }

  // Merge set-cookie headers to keep cookies fresh
  const updatedCookies = mergeCookies(session.cookies, headers['set-cookie']);

  const refreshed: NotebookRpcSession = {
    at: atMatch[1],
    bl: blMatch?.[1] ?? session.bl,
    fsid: fsidMatch?.[1] ?? session.fsid,
    cookies: updatedCookies,
    userAgent: session.userAgent,
    language: langMatch?.[1]?.split('-')[0] ?? session.language,
  };

  // Auto-save refreshed session
  const filePath = savePath ?? defaultSessionPath();
  await saveSession(refreshed, filePath);
  console.error(`NotebookLM: Tokens refreshed and saved to ${filePath}`);

  return refreshed;
}

/**
 * Merge existing cookies with new Set-Cookie headers.
 * New values override old ones by cookie name.
 */
function mergeCookies(existing: string, setCookieHeader: string | string[] | undefined): string {
  // Parse existing cookies into a map
  const cookieMap = new Map<string, string>();
  for (const pair of existing.split('; ')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      cookieMap.set(pair.slice(0, eqIdx), pair.slice(eqIdx + 1));
    }
  }

  // Parse Set-Cookie headers (only name=value, ignore attributes)
  if (setCookieHeader) {
    const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const h of headers) {
      const nameValue = h.split(';')[0];
      if (nameValue) {
        const eqIdx = nameValue.indexOf('=');
        if (eqIdx > 0) {
          cookieMap.set(nameValue.slice(0, eqIdx).trim(), nameValue.slice(eqIdx + 1).trim());
        }
      }
    }
  }

  return [...cookieMap.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

export { defaultSessionPath };
