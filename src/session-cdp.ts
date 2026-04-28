/**
 * CDP-based session extraction — connects to a running Chrome instance
 * (e.g. on port 9222) and extracts fresh NotebookLM session data.
 *
 * This is the "zero-touch" alternative to export-session: as long as a
 * Chrome instance with remote debugging is running and logged into Google,
 * we can always extract fresh tokens + cookies without user interaction.
 *
 * Typical setup: Chrome launched with --remote-debugging-port=9222
 */

import puppeteer from 'puppeteer-core';
import { NB_URLS } from './rpc-ids.js';
import { saveSession } from './session-store.js';
import type { NotebookRpcSession, SessionCookie } from './types.js';

export interface CDPRefreshOptions {
  /** CDP endpoint URL. Default: http://localhost:9222 */
  cdpUrl?: string;
  /** Path to save the refreshed session. Uses default if omitted. */
  savePath?: string;
  /** Timeout for page navigation/token extraction (ms). Default: 30000 */
  timeoutMs?: number;
}

/**
 * Connect to a running Chrome via CDP, navigate to NotebookLM,
 * and extract a fresh session (tokens + all Google cookies).
 *
 * This works because the Chrome instance maintains Google's SSO login state.
 * Even when our saved session.json cookies have expired, the live Chrome's
 * cookies are continuously refreshed by Google's own auth machinery.
 */
export async function refreshViaCDP(
  opts: CDPRefreshOptions = {},
): Promise<NotebookRpcSession> {
  const cdpUrl = opts.cdpUrl ?? 'http://localhost:9222';
  const timeoutMs = opts.timeoutMs ?? 30_000;

  // Connect to the running Chrome instance
  const browser = await puppeteer.connect({
    browserURL: cdpUrl,
    defaultViewport: null,
  });

  let page: import('puppeteer-core').Page | null = null;
  let createdNewPage = false;

  try {
    // Look for an existing NotebookLM tab first
    const pages = await browser.pages();
    for (const p of pages) {
      const url = p.url();
      if (url.includes('notebooklm.google.com')) {
        page = p;
        break;
      }
    }

    // If no existing tab, open one in the background
    if (!page) {
      page = await browser.newPage();
      createdNewPage = true;
      await page.goto(NB_URLS.DASHBOARD, {
        waitUntil: 'networkidle2',
        timeout: timeoutMs,
      });
    } else {
      // Reload to get fresh WIZ_global_data
      await page.reload({ waitUntil: 'networkidle2', timeout: timeoutMs });
    }

    // Wait for WIZ_global_data tokens
    await page.waitForFunction(
      () => {
        const w = window as unknown as { WIZ_global_data?: { cfb2h?: string; SNlM0e?: string } };
        const bl = w.WIZ_global_data?.cfb2h ?? '';
        return !!w.WIZ_global_data?.SNlM0e && bl.includes('labs-tailwind');
      },
      { timeout: timeoutMs, polling: 2000 },
    );

    // Extract tokens from page
    const data = await page.evaluate(() => {
      const w = window as unknown as { WIZ_global_data?: { SNlM0e?: string; cfb2h?: string; FdrFJe?: string } };
      return {
        at: w.WIZ_global_data?.SNlM0e ?? '',
        bl: w.WIZ_global_data?.cfb2h ?? '',
        fsid: w.WIZ_global_data?.FdrFJe ?? '',
        userAgent: navigator.userAgent,
        language: navigator.language?.split('-')[0] ?? 'en',
      };
    });

    if (!data.at) {
      throw new Error('CDP refresh failed: SNlM0e token not found in page');
    }

    // Extract ALL cookies via CDP (including HttpOnly)
    const cdpSession = await page.createCDPSession();
    let session: NotebookRpcSession;
    try {
      const { cookies: cdpCookies } = await cdpSession.send('Network.getAllCookies') as {
        cookies: Array<{ name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean }>;
      };

      // Filter to Google-related cookies only
      const googleCookies = cdpCookies.filter(c =>
        c.domain.endsWith('google.com') ||
        c.domain.endsWith('googleapis.com') ||
        c.domain.endsWith('googleusercontent.com'),
      );

      const cookieJar: SessionCookie[] = googleCookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
      }));

      // Flat cookie string (deduplicated)
      const seen = new Set<string>();
      const cookieStr = googleCookies
        .filter(c => {
          const key = `${c.name}=${c.value}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map(c => `${c.name}=${c.value}`)
        .join('; ');

      session = {
        at: data.at,
        bl: data.bl,
        fsid: data.fsid,
        cookies: cookieStr,
        cookieJar,
        userAgent: data.userAgent,
        language: data.language,
      };
    } finally {
      try { await cdpSession.detach(); } catch { /* ignore */ }
    }

    // Save to disk
    const path = await saveSession(session, opts.savePath);
    console.error(`NotebookLM: Session refreshed via CDP and saved to ${path}`);

    return session;
  } finally {
    // Close the tab we created (don't close existing tabs or the browser)
    if (createdNewPage && page) {
      try { await page.close(); } catch { /* ignore */ }
    }
    // Disconnect (does NOT close the browser — it's the user's Chrome)
    browser.disconnect();
  }
}

/**
 * Check if a CDP endpoint is available at the given URL.
 */
export async function isCDPAvailable(cdpUrl = 'http://localhost:9222'): Promise<boolean> {
  try {
    const res = await fetch(`${cdpUrl}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
