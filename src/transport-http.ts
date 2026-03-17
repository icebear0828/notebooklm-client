/**
 * HttpTransport — executes requests directly from Node.js using undici
 * with Chrome-like TLS fingerprint. No browser needed.
 *
 * Requires a pre-exported session (cookies + tokens) from BrowserTransport.
 */

import { Agent, ProxyAgent, request as undiciRequest } from 'undici';
import { SessionError } from './errors.js';
import { CHROME_CIPHERS } from './tls-config.js';
import type { Transport, TransportRequest } from './transport.js';
import type { NotebookRpcSession } from './types.js';

/**
 * Default Chrome user-agent string.
 * Used as fallback if session doesn't include one.
 */
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface HttpTransportOptions {
  /** Pre-exported session from BrowserTransport or loaded from disk. */
  session: NotebookRpcSession;

  /** Proxy URL (http/https). SOCKS proxies require curl-impersonate transport. */
  proxy?: string;

  /**
   * Called when the session needs refreshing (e.g. 401 from server).
   * Should return a fresh session. If not provided, throws on auth failure.
   */
  onSessionExpired?: () => Promise<NotebookRpcSession>;
}

export class HttpTransport implements Transport {
  private session: NotebookRpcSession;
  private agent: Agent | ProxyAgent;
  private proxy?: string;
  private onSessionExpired?: () => Promise<NotebookRpcSession>;

  constructor(opts: HttpTransportOptions) {
    this.session = opts.session;
    this.proxy = opts.proxy;
    this.onSessionExpired = opts.onSessionExpired;
    this.agent = this.createAgent();
  }

  async execute(req: TransportRequest): Promise<string> {
    const doCall = async (): Promise<string> => {
      const qp = new URLSearchParams(req.queryParams).toString();
      const body = new URLSearchParams(req.body).toString();
      const url = `${req.url}?${qp}`;

      const { statusCode, body: resBody } = await undiciRequest(url, {
        method: 'POST',
        headers: this.buildHeaders(body.length),
        body,
        dispatcher: this.agent,
      });

      const text = await resBody.text();

      if (statusCode === 401 || statusCode === 400) {
        throw new SessionError(`HTTP ${statusCode}`);
      }
      if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`HTTP ${statusCode}: ${text.slice(0, 200)}`);
      }

      return text;
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
      throw new SessionError(
        'HTTP transport session expired and no refresh callback provided. ' +
        'Re-export session from browser or provide onSessionExpired callback.',
      );
    }
    console.error('NotebookLM: Refreshing session (HTTP transport)...');
    this.session = await this.onSessionExpired();
    console.error('NotebookLM: Session refreshed');
  }

  async dispose(): Promise<void> {
    await this.agent.close();
  }

  /** Update session data (e.g. after external refresh). */
  updateSession(session: NotebookRpcSession): void {
    this.session = session;
  }

  private buildHeaders(contentLength: number): Record<string, string> {
    const ua = this.session.userAgent || DEFAULT_USER_AGENT;

    return {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Content-Length': String(contentLength),
      'User-Agent': ua,
      'Cookie': this.session.cookies,
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

  private createAgent(): Agent | ProxyAgent {
    if (this.proxy) {
      return new ProxyAgent({
        uri: this.proxy,
        requestTls: {
          ciphers: CHROME_CIPHERS,
          minVersion: 'TLSv1.2',
          maxVersion: 'TLSv1.3',
        },
      });
    }
    return new Agent({
      connect: {
        // Chrome-like TLS settings
        ciphers: CHROME_CIPHERS,
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.3',
        // undici connect options use ALPNProtocols
        ALPNProtocols: ['h2', 'http/1.1'],
      } as Record<string, unknown>,
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
    });
  }
}
