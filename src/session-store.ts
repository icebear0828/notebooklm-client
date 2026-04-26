/**
 * Session persistence — save/load NotebookRpcSession to disk.
 *
 * Stored at ~/.notebooklm/session.json by default.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CurlTransport } from './transport-curl.js';
import { getSessionPath } from './paths.js';
import type { NotebookRpcSession, SessionCookie } from './types.js';

function execFileAsync(
  cmd: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCb(cmd, args, opts, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout: stdout as string, stderr: stderr as string });
    });
  });
}

/**
 * Infer a domain-scoped cookieJar from a flat cookie string.
 * Google downloads (lh3.googleusercontent.com, contribution.usercontent.google.com)
 * require cookies sent with matching domains. CDP export provides this natively;
 * for imported sessions we infer it from cookie naming conventions.
 */
/**
 * Build a basic cookieJar from flat cookie string for API calls.
 *
 * NOTE: This only sets cookies on .google.com — sufficient for RPC calls
 * (notebooklm.google.com) but NOT for downloads from Google CDN domains
 * (lh3.googleusercontent.com, contribution.usercontent.google.com).
 * Downloads require export-session which captures domain-scoped cookies
 * from Chrome CDP (Network.getAllCookies).
 */
function inferCookieJar(cookies: string): SessionCookie[] {
  if (!cookies) return [];

  const jar: SessionCookie[] = [];

  for (const pair of cookies.split(';')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name || !value) continue;

    const secure = name.startsWith('__Secure') || name.startsWith('__Host');
    jar.push({ name, value, domain: '.google.com', path: '/', secure, httpOnly: true });
  }

  return jar;
}

interface StoredSession {
  version: 1;
  exportedAt: string;
  session: NotebookRpcSession;
}

function defaultSessionPath(): string {
  return getSessionPath();
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

  // Auto-generate cookieJar from flat cookies if missing (import-session compat)
  if (!stored.session.cookieJar?.length && stored.session.cookies) {
    stored.session.cookieJar = inferCookieJar(stored.session.cookies);
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
  proxy?: string,
): Promise<NotebookRpcSession> {
  // Must use curl-impersonate: Google guards this endpoint with cookie-to-TLS
  // fingerprint binding ("CookieMismatch"), which rejects Node/undici even
  // with valid cookies. curl-impersonate reproduces Chrome's TLS + H2 signature.
  const binaryPath = await CurlTransport.findBinary();
  if (!binaryPath) {
    throw new Error('Token refresh failed: curl-impersonate binary not found');
  }

  const ua = session.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  // Write cookies to Netscape-format temp file — covers both cookieJar and flat string.
  const cookieFilePath = join(tmpdir(), `.nblm-refresh-cookies-${process.pid}-${Date.now()}`);
  const cookieLines = ['# Netscape HTTP Cookie File'];
  if (session.cookieJar && session.cookieJar.length > 0) {
    for (const c of session.cookieJar) {
      const domainFlag = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
      const secure = c.secure ? 'TRUE' : 'FALSE';
      cookieLines.push(`${c.domain}\t${domainFlag}\t${c.path ?? '/'}\t${secure}\t0\t${c.name}\t${c.value}`);
    }
  } else {
    for (const pair of session.cookies.split(';')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const secure = name.startsWith('__Secure') || name.startsWith('__Host') ? 'TRUE' : 'FALSE';
      cookieLines.push(`.google.com\tTRUE\t/\t${secure}\t0\t${name}\t${value}`);
    }
  }
  writeFileSync(cookieFilePath, cookieLines.join('\n'), 'utf-8');

  const args: string[] = [
    '--impersonate', 'chrome136',
    'https://notebooklm.google.com/',
    '-s', '-S',
    '--compressed',
    '-D', '-',               // dump response headers to stdout before body
    '-b', cookieFilePath,
    '-H', `User-Agent: ${ua}`,
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '-H', 'Accept-Language: en-US,en;q=0.9',
  ];
  if (proxy) args.push('-x', proxy);

  let stdout: string;
  try {
    const result = await execFileAsync(binaryPath, args, { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
    stdout = result.stdout;
    if (result.stderr && result.stderr.includes('curl:')) {
      throw new Error(`curl-impersonate: ${result.stderr.trim()}`);
    }
  } finally {
    try { unlinkSync(cookieFilePath); } catch { /* ignore */ }
  }

  // Split headers (before first blank line) from body.
  const headerBodySplit = stdout.search(/\r?\n\r?\n/);
  const rawHeaders = headerBodySplit > 0 ? stdout.slice(0, headerBodySplit) : '';
  const html = headerBodySplit > 0 ? stdout.slice(headerBodySplit).replace(/^\r?\n\r?\n/, '') : stdout;

  const statusLine = rawHeaders.split(/\r?\n/)[0] ?? '';
  const statusMatch = /HTTP\/[\d.]+\s+(\d{3})/.exec(statusLine);
  const statusCode = statusMatch ? parseInt(statusMatch[1]!, 10) : 0;
  if (statusCode !== 200) {
    throw new Error(`Token refresh failed: HTTP ${statusCode}`);
  }

  // Collect Set-Cookie headers (case-insensitive, possibly multiple).
  const setCookies: string[] = [];
  for (const line of rawHeaders.split(/\r?\n/)) {
    const m = /^set-cookie:\s*(.*)$/i.exec(line);
    if (m) setCookies.push(m[1]!);
  }

  // Extract tokens from WIZ_global_data in the HTML
  const atMatch = /"SNlM0e":"([^"]+)"/.exec(html);
  const blMatch = /"cfb2h":"([^"]+)"/.exec(html);
  const fsidMatch = /"FdrFJe":"([^"]+)"/.exec(html);
  const langMatch = /<html[^>]*\slang="([^"]+)"/.exec(html);

  if (!atMatch?.[1]) {
    throw new Error('Token refresh failed: SNlM0e not found in page (cookies may be expired)');
  }

  const updatedCookies = mergeCookies(session.cookies, setCookies);

  const refreshed: NotebookRpcSession = {
    at: atMatch[1],
    bl: blMatch?.[1] ?? session.bl,
    fsid: fsidMatch?.[1] ?? session.fsid,
    cookies: updatedCookies,
    cookieJar: inferCookieJar(updatedCookies),
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
