/**
 * BrowserTransport — executes HTTP requests inside a real Chrome via page.evaluate(fetch(...)).
 *
 * This is the original transport mechanism. TLS fingerprint is authentic Chrome.
 */

import { type Browser, type Page } from 'puppeteer-core';
import { launchBrowser, DEFAULT_PROFILE_DIR } from './browser.js';
import { SessionError } from './errors.js';
import { withRefreshGuard } from './utils/refresh-guard.js';
import { NB_URLS } from './rpc-ids.js';
import type { Transport, TransportRequest } from './transport.js';
import type { NotebookRpcSession, BrowserLaunchOptions } from './types.js';

export class BrowserTransport implements Transport {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private session: NotebookRpcSession | null = null;

  constructor(private opts: BrowserLaunchOptions = {}) {}

  async init(): Promise<void> {
    const profileDir = this.opts.profileDir ?? DEFAULT_PROFILE_DIR;
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const isFirstRun = !existsSync(join(profileDir, 'Default'));

    const launched = await launchBrowser({ ...this.opts, profileDir });
    this.browser = launched.browser;
    this.page = launched.page;

    await this.page.goto(NB_URLS.DASHBOARD, { waitUntil: 'networkidle2', timeout: 60000 });

    if (isFirstRun) {
      console.error('NotebookLM: First run — please log in to your Google account.');
    }

    // Wait for user to land on notebooklm.google.com (may go through Google login first).
    // After login redirect, WIZ_global_data may not be populated until a clean page load.
    const gotTokens = await this.page.waitForFunction(
      () => {
        if (!location.hostname.includes('notebooklm.google.com')) return false;
        const bl = window.WIZ_global_data?.cfb2h ?? '';
        return !!window.WIZ_global_data?.SNlM0e && bl.includes('labs-tailwind');
      },
      { timeout: 180000, polling: 2000 },
    ).then(() => true).catch(() => false);

    if (!gotTokens) {
      // Tokens not found — likely the page came from a login redirect
      // and WIZ_global_data wasn't injected. Reload to get a clean page load.
      const currentUrl = this.page.url();
      console.error(`NotebookLM: Tokens not found at ${currentUrl}, reloading...`);

      if (!currentUrl.includes('notebooklm.google.com')) {
        await this.page.goto(NB_URLS.DASHBOARD, { waitUntil: 'networkidle2', timeout: 60000 });
      } else {
        await this.page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
      }

      await this.page.waitForFunction(
        () => {
          const bl = window.WIZ_global_data?.cfb2h ?? '';
          return !!window.WIZ_global_data?.SNlM0e && bl.includes('labs-tailwind');
        },
        { timeout: 60000, polling: 2000 },
      );
    }

    this.session = await this.extractSessionData();
    console.error(`NotebookLM: Connected via browser (bl=${this.session.bl.slice(0, 40)}...)`);
  }

  async execute(req: TransportRequest): Promise<string> {
    if (!this.page || !this.session) throw new SessionError('Browser transport not initialized');

    return this.page.evaluate(
      async (params: { url: string; qp: string; body: string }) => {
        const res = await fetch(`${params.url}?${params.qp}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: params.body,
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      },
      {
        url: req.url,
        qp: new URLSearchParams(req.queryParams).toString(),
        body: new URLSearchParams(req.body).toString(),
      },
    );
  }

  getSession(): NotebookRpcSession {
    if (!this.session) throw new SessionError('Browser transport not initialized');
    return this.session;
  }

  async refreshSession(): Promise<void> {
    await withRefreshGuard(this, async () => {
      if (!this.page) throw new SessionError('Browser transport not initialized');
      console.error('NotebookLM: Refreshing session tokens (browser)...');

      await this.page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
      await this.page.waitForFunction(
        () => {
          const bl = window.WIZ_global_data?.cfb2h ?? '';
          return !!window.WIZ_global_data?.SNlM0e && bl.includes('labs-tailwind');
        },
        { timeout: 30000 },
      );

      this.session = await this.extractSessionData();
      console.error('NotebookLM: Session tokens refreshed');
    });
  }

  async dispose(): Promise<void> {
    if (this.browser) {
      try { await this.browser.close(); } catch { /* ignore */ }
      this.browser = null;
      this.page = null;
      this.session = null;
    }
  }

  /** Expose the page for operations that need direct browser access (e.g. download). */
  getPage(): Page | null {
    return this.page;
  }

  /** Export session for later use by HttpTransport. */
  async exportSession(): Promise<NotebookRpcSession> {
    return this.extractSessionData();
  }

  private async extractSessionData(): Promise<NotebookRpcSession> {
    if (!this.page) throw new SessionError('Not connected');

    const data = await this.page.evaluate(() => ({
      at: window.WIZ_global_data?.SNlM0e ?? '',
      bl: window.WIZ_global_data?.cfb2h ?? '',
      fsid: window.WIZ_global_data?.FdrFJe ?? '',
      userAgent: navigator.userAgent,
    }));

    // Use CDP to get ALL cookies including HttpOnly ones (SID, HSID, SSID, etc.)
    // document.cookie cannot access HttpOnly cookies which are required for auth.
    const cdp = await this.page.createCDPSession();
    try {
      const { cookies: cdpCookies } = await cdp.send('Network.getCookies', {
        urls: ['https://notebooklm.google.com', 'https://.google.com'],
      }) as { cookies: Array<{ name: string; value: string }> };

      const cookieStr = cdpCookies
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');

      return { at: data.at, bl: data.bl, fsid: data.fsid, cookies: cookieStr, userAgent: data.userAgent };
    } finally {
      try { await cdp.detach(); } catch { /* ignore */ }
    }
  }
}
