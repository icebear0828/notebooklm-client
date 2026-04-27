#!/usr/bin/env node
/**
 * One-off: attach puppeteer to a running Chrome via CDP (default
 * http://localhost:9222), find a notebooklm.google.com tab, extract
 * the auth session and write it to ~/.notebooklm/session.json so that
 * `npx notebooklm --transport auto` can take over from there.
 *
 * Usage:
 *   node vendor/notebooklm/scripts/extract-session-cdp.mjs [--browser-url <url>]
 */

import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
let browserURL = 'http://localhost:9222';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--browser-url' && args[i + 1]) {
    browserURL = args[i + 1];
    i++;
  }
}

const sessionPath = join(homedir(), '.notebooklm', 'session.json');

async function main() {
  console.error(`Connecting to ${browserURL}...`);
  const browser = await puppeteer.connect({ browserURL, defaultViewport: null });
  try {
    const targets = browser.targets();
    const target = targets.find(
      (t) => t.type() === 'page' && t.url().includes('notebooklm.google.com'),
    );
    if (!target) {
      throw new Error(
        'No notebooklm.google.com tab found. Open https://notebooklm.google.com first.',
      );
    }
    const page = await target.page();
    if (!page) throw new Error('Could not attach to NotebookLM tab');

    console.error(`Found NotebookLM tab: ${page.url()}`);

    // Wait for WIZ_global_data — page may have just loaded
    await page.waitForFunction(
      () => {
        const bl = window.WIZ_global_data?.cfb2h ?? '';
        return !!window.WIZ_global_data?.SNlM0e && bl.includes('labs-tailwind');
      },
      { timeout: 30000, polling: 1000 },
    );

    const data = await page.evaluate(() => ({
      at: window.WIZ_global_data?.SNlM0e ?? '',
      bl: window.WIZ_global_data?.cfb2h ?? '',
      fsid: window.WIZ_global_data?.FdrFJe ?? '',
      userAgent: navigator.userAgent,
      language: navigator.language?.split('-')[0] ?? 'en',
    }));

    const cdp = await page.createCDPSession();
    let cookies;
    try {
      const result = await cdp.send('Network.getAllCookies');
      cookies = result.cookies;
    } finally {
      try {
        await cdp.detach();
      } catch {
        /* ignore */
      }
    }

    const googleCookies = cookies.filter(
      (c) =>
        c.domain.endsWith('google.com') ||
        c.domain.endsWith('googleapis.com') ||
        c.domain.endsWith('googleusercontent.com'),
    );

    const cookieJar = googleCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
    }));

    const seen = new Set();
    const cookieStr = googleCookies
      .filter((c) => {
        const key = `${c.name}=${c.value}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    const session = {
      at: data.at,
      bl: data.bl,
      fsid: data.fsid,
      cookies: cookieStr,
      cookieJar,
      userAgent: data.userAgent,
      language: data.language,
    };

    const stored = {
      version: 1,
      session,
      savedAt: new Date().toISOString(),
    };

    await mkdir(dirname(sessionPath), { recursive: true });
    await writeFile(sessionPath, JSON.stringify(stored, null, 2), 'utf-8');

    console.error(
      `Session saved to ${sessionPath} (at=${session.at.slice(0, 30)}..., ${cookieJar.length} cookies)`,
    );
    console.log(sessionPath);
  } finally {
    // disconnect, do NOT close the user's Chrome
    browser.disconnect();
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
