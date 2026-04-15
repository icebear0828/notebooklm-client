/**
 * CurlTransport — Tier 1: curl-impersonate (macOS/Linux only, 100% Chrome fingerprint).
 *
 * Spawns curl_chrome116/curl_chrome131 as a child process with BoringSSL,
 * producing an identical TLS ClientHello + HTTP/2 fingerprint to real Chrome.
 */

import { execFile as execFileCb } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionError } from './errors.js';
import type { Transport, TransportRequest } from './transport.js';
import type { NotebookRpcSession } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function execFileAsync(
  cmd: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCb(cmd, args, opts, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout: stdout as string, stderr: stderr as string });
    });
  });
}

/** Binary names to search, in preference order. */
const CURL_BINARIES = ['curl-impersonate', 'curl_chrome131', 'curl_chrome116'] as const;

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface CurlTransportOptions {
  session: NotebookRpcSession;
  /** Path to curl-impersonate binary. Auto-detected if omitted. */
  binaryPath?: string;
  /** Proxy URL (http, socks5, socks5h). Passed as curl -x flag. */
  proxy?: string;
  onSessionExpired?: () => Promise<NotebookRpcSession>;
}

export class CurlTransport implements Transport {
  private session: NotebookRpcSession;
  private binaryPath: string;
  private proxy?: string;
  private onSessionExpired?: () => Promise<NotebookRpcSession>;

  constructor(opts: CurlTransportOptions) {
    this.session = opts.session;
    this.binaryPath = opts.binaryPath ?? '';
    this.proxy = opts.proxy;
    this.onSessionExpired = opts.onSessionExpired;
  }

  async init(): Promise<void> {
    if (!this.binaryPath) {
      const found = await CurlTransport.findBinary();
      if (!found) throw new Error('curl-impersonate binary not found');
      this.binaryPath = found;
    }
  }

  async execute(req: TransportRequest): Promise<string> {
    const doCall = async (): Promise<string> => {
      const qp = new URLSearchParams(req.queryParams).toString();
      const url = `${req.url}?${qp}`;
      const body = new URLSearchParams(req.body).toString();
      const headers = this.buildHeaders();

      // Write cookies to a temp file to avoid exceeding OS argument length limits.
      // Google sessions carry many large cookies that easily blow past ARG_MAX
      // when passed via -H "Cookie: ...".
      const cookieFilePath = join(tmpdir(), `.nblm-curl-cookies-${process.pid}-${Date.now()}`);
      const cookieFileContent = this.buildCookieFile();
      writeFileSync(cookieFilePath, cookieFileContent, 'utf-8');

      const args: string[] = [
        '--impersonate', 'chrome136',
        url,
        '-s', '-S',           // silent + show errors
        '--compressed',        // handle gzip/br
        '-X', 'POST',
        '--data', body,
        '-w', '\n%{http_code}', // append status code
        '-b', cookieFilePath,  // read cookies from file
      ];

      if (this.proxy) {
        args.push('-x', this.proxy);
      }

      for (const [key, value] of Object.entries(headers)) {
        args.push('-H', `${key}: ${value}`);
      }

      try {
        const { stdout, stderr } = await execFileAsync(this.binaryPath, args, {
          timeout: 60_000,
          maxBuffer: 10 * 1024 * 1024,
        });

        if (stderr && stderr.includes('curl:')) {
          throw new Error(`curl-impersonate error: ${stderr.trim()}`);
        }

        // Response format: <body>\n<status_code>
        const lastNewline = stdout.lastIndexOf('\n');
        const responseBody = lastNewline > 0 ? stdout.slice(0, lastNewline) : stdout;
        const statusCode = lastNewline > 0 ? parseInt(stdout.slice(lastNewline + 1).trim(), 10) : 200;

        if (statusCode === 401 || statusCode === 400) {
          throw new SessionError(`HTTP ${statusCode}`);
        }
        if (statusCode < 200 || statusCode >= 300) {
          throw new Error(`HTTP ${statusCode}: ${responseBody.slice(0, 200)}`);
        }

        return responseBody;
      } finally {
        try { unlinkSync(cookieFilePath); } catch { /* ignore cleanup errors */ }
      }
    };

    try {
      return await doCall();
    } catch (err) {
      if (err instanceof SessionError && this.onSessionExpired) {
        await this.refreshSession();
        return doCall();
      }
      throw err;
    }
  }

  getSession(): NotebookRpcSession {
    return this.session;
  }

  async refreshSession(): Promise<void> {
    if (!this.onSessionExpired) {
      throw new SessionError('Session expired and no refresh callback provided.');
    }
    console.error('NotebookLM: Refreshing session (curl-impersonate)...');
    this.session = await this.onSessionExpired();
    console.error('NotebookLM: Session refreshed');
  }

  async dispose(): Promise<void> {
    // No persistent resources to clean up
  }

  updateSession(session: NotebookRpcSession): void {
    this.session = session;
  }

  private buildHeaders(): Record<string, string> {
    const ua = this.session.userAgent || DEFAULT_USER_AGENT;
    // Cookie is passed via -b <file> to avoid exceeding OS argument length limits
    return {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': ua,
      'Origin': 'https://notebooklm.google.com',
      'Referer': 'https://notebooklm.google.com/',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'X-Same-Domain': '1',
    };
  }

  /** Build a Netscape-format cookie file from session cookies. */
  private buildCookieFile(): string {
    const lines = ['# Netscape HTTP Cookie File'];
    const session = this.session;

    if (session.cookieJar && session.cookieJar.length > 0) {
      for (const c of session.cookieJar) {
        const isDotDomain = c.domain.startsWith('.');
        const domainFlag = isDotDomain ? 'TRUE' : 'FALSE';
        const secure = c.secure ? 'TRUE' : 'FALSE';
        const path = c.path ?? '/';
        lines.push(`${c.domain}\t${domainFlag}\t${path}\t${secure}\t0\t${c.name}\t${c.value}`);
      }
    } else {
      // Fallback: parse flat cookie string → scope to .google.com
      for (const pair of session.cookies.split(';')) {
        const eq = pair.indexOf('=');
        if (eq > 0) {
          const name = pair.slice(0, eq).trim();
          const value = pair.slice(eq + 1).trim();
          const secure = name.startsWith('__Secure') || name.startsWith('__Host') ? 'TRUE' : 'FALSE';
          lines.push(`.google.com\tTRUE\t/\t${secure}\t0\t${name}\t${value}`);
        }
      }
    }

    return lines.join('\n');
  }

  // ── Static Detection ──

  /** Check if curl-impersonate is available on this system. */
  static async isAvailable(binaryPath?: string): Promise<boolean> {
    if (binaryPath) {
      return CurlTransport.testBinary(binaryPath);
    }
    const found = await CurlTransport.findBinary();
    return found !== null;
  }

  /** Find the best available curl-impersonate binary. */
  static async findBinary(): Promise<string | null> {
    // Not available on Windows natively
    if (platform() === 'win32') return null;

    // Check bin/ directory first (installed by postinstall script)
    const vendorDir = join(__dirname, '..', 'bin');
    for (const name of CURL_BINARIES) {
      const vendorPath = join(vendorDir, name);
      if (await CurlTransport.testBinary(vendorPath)) return vendorPath;
    }

    // Fallback: check PATH
    for (const name of CURL_BINARIES) {
      if (await CurlTransport.testBinary(name)) return name;
    }
    return null;
  }

  private static async testBinary(path: string): Promise<boolean> {
    try {
      await execFileAsync(path, ['--version'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
