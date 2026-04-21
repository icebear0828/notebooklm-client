/**
 * Download & save logic — extracted from NotebookClient.
 *
 * All functions are standalone; they receive dependencies (session, proxy,
 * RPC caller) as parameters so the module has no circular dependency on
 * the client class.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'puppeteer-core';
import { NB_RPC, NB_URLS } from './rpc-ids.js';
import { parseEnvelopes } from './boq-parser.js';
import { humanSleep } from './utils/humanize.js';
import type { NotebookRpcSession } from './types.js';

// ── Types ──

/** Minimal RPC caller — matches NotebookClient.callBatchExecute signature. */
export type RpcCaller = (
  rpcId: string,
  payload: unknown[],
  sourcePath?: string,
) => Promise<string>;

/** Dependencies for HTTP-based file downloads. */
export interface DownloadDeps {
  session: NotebookRpcSession;
  proxy?: string;
}

/** Bound download function (URL → file path). */
export type DownloadFn = (
  downloadUrl: string,
  outputDir: string,
  filename: string,
) => Promise<string>;

// ── Core download functions ──

/**
 * Download a file via curl-impersonate with a Netscape cookie jar.
 * Handles Google's cross-domain cookie requirements and CDN retry logic.
 */
export async function downloadFileHttp(
  deps: DownloadDeps,
  downloadUrl: string,
  outputDir: string,
  filename: string,
): Promise<string> {
  const { session, proxy } = deps;

  mkdirSync(outputDir, { recursive: true });

  const filePath = join(outputDir, filename);

  const { readFile, unlink } = await import('node:fs/promises');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  const { CurlTransport } = await import('./transport-curl.js');
  const curlBin = await CurlTransport.findBinary();
  if (!curlBin) {
    throw new Error('Audio download requires curl-impersonate. Run: npm run setup');
  }

  // Build Netscape cookie jar with proper domain scoping
  const cookieJarPath = join(outputDir, `.cookiejar_${Date.now()}`);
  const lines = ['# Netscape HTTP Cookie File'];

  // Cookies that Google CDN checks for authentication
  const CDN_AUTH_COOKIES = new Set([
    'SID', 'HSID', 'SSID', 'APISID', 'SAPISID',
    '__Secure-1PSID', '__Secure-3PSID',
    '__Secure-1PAPISID', '__Secure-3PAPISID',
    'NID', '__Secure-ENID',
  ]);
  // CDN domain (lh3.googleusercontent.com) needs its own cookie entries
  const CDN_DOMAIN = '.googleusercontent.com';

  if (session.cookieJar && session.cookieJar.length > 0) {
    for (const c of session.cookieJar) {
      const isDotDomain = c.domain.startsWith('.');
      const domain = isDotDomain ? c.domain : c.domain;
      const domainFlag = isDotDomain ? 'TRUE' : 'FALSE';
      const secure = c.secure ? 'TRUE' : 'FALSE';
      const path = c.path ?? '/';
      lines.push(`${domain}\t${domainFlag}\t${path}\t${secure}\t0\t${c.name}\t${c.value}`);
      // Mirror auth cookies to CDN domain
      if (CDN_AUTH_COOKIES.has(c.name)) {
        lines.push(`${CDN_DOMAIN}\tTRUE\t/\t${secure}\t0\t${c.name}\t${c.value}`);
      }
    }
  } else {
    for (const pair of session.cookies.split(';')) {
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        const secure = name.startsWith('__Secure') || name.startsWith('__Host') ? 'TRUE' : 'FALSE';
        lines.push(`.google.com\tTRUE\t/\t${secure}\t0\t${name}\t${value}`);
        if (CDN_AUTH_COOKIES.has(name)) {
          lines.push(`${CDN_DOMAIN}\tTRUE\t/\t${secure}\t0\t${name}\t${value}`);
        }
      }
    }
  }
  writeFileSync(cookieJarPath, lines.join('\n'), 'utf-8');

  const buildCurlArgs = (_bin: string, cookiePath: string): string[] => {
    const args = [
      '-sSL',
      '-o', filePath,
      '-b', cookiePath,
      '-c', cookiePath,
      '-H', `User-Agent: ${session.userAgent}`,
      '-H', 'Referer: https://notebooklm.google.com/',
      '--max-redirs', '20',
    ];
    if (proxy) args.push('-x', proxy);
    args.push(downloadUrl);
    return args;
  };

  const systemCurl = 'curl';
  const candidates: Array<{ bin: string; label: string }> = [
    { bin: curlBin, label: 'curl-impersonate' },
    { bin: systemCurl, label: 'system curl' },
  ];

  // Retry loop: CDN may return 404 briefly after artifact URL appears
  // Empirically CDN propagation takes ~150s; 10 retries gives ~450s window
  const maxRetries = 10;
  let lastError = '';
  outer: for (const { bin, label } of candidates) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await execFileAsync(bin, buildCurlArgs(bin, cookieJarPath), { timeout: 120_000 });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        lastError = `${label}: ${errMsg}`;
        const isTls = /curl: \(35\)|curl: \(56\)|TLS connect error|OPENSSL_internal|SSL connection/i.test(errMsg);
        if (isTls) {
          if (attempt < 3) {
            const tlsDelays = [2000, 5000, 5000] as const;
            const delay = tlsDelays[Math.min(attempt - 1, tlsDelays.length - 1)] as number;
            console.error(`NotebookLM: TLS error with ${label} (attempt ${attempt}/${maxRetries}), retrying in ${delay / 1000}s...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          console.error(`NotebookLM: ${label} failed due to TLS error, trying fallback...`);
          continue outer;
        }
        await unlink(cookieJarPath).catch(() => {});
        throw new Error(`Download failed: ${errMsg}`);
      }

      // Verify we got actual media, not HTML (404 page or login page)
      const content = await readFile(filePath);
      const head = content.slice(0, 200).toString('utf-8');
      if (!head.includes('<!doctype') && !head.includes('<html')) {
        break outer;
      }

    // HTML response — distinguish cookie auth failure from CDN propagation delay
    await unlink(filePath).catch(() => {});
    const headLower = head.toLowerCase();
    const isAuthFailure =
      headLower.includes('accounts.google') ||
      headLower.includes('servicelogin') ||
      headLower.includes('sign in') ||
      headLower.includes('signin') ||
      // 403/401 error pages also indicate auth, not CDN delay
      headLower.includes('<title>error 403') ||
      headLower.includes('<title>error 401');

    if (isAuthFailure) {
      await unlink(cookieJarPath).catch(() => {});
      throw new Error(
        'Audio download failed: CDN rejected cookies (session cookies expired). ' +
        'Re-run: npx notebooklm export-session',
      );
    }

    if (attempt < maxRetries) {
      const delay = attempt * 10_000;
      console.error(`NotebookLM: CDN not ready (attempt ${attempt}/${maxRetries}), retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    } else {
      await unlink(cookieJarPath).catch(() => {});
      throw new Error(
        'Download failed: CDN not ready after all retries — ' +
        'artifact may still be generating. Re-run: npx notebooklm export-session',
      );
    }
  }
} // End of outer loop

if (lastError && !(await readFile(filePath).catch(() => null))) {
  await unlink(cookieJarPath).catch(() => {});
  throw new Error(`Download failed: ${lastError}`);
}

  await unlink(cookieJarPath).catch(() => {});

  console.error(`NotebookLM: Downloaded to ${filePath}`);
  return filePath;
}

/**
 * Download audio via browser CDP (Puppeteer).
 */
export async function downloadAudioBrowser(
  page: Page,
  downloadUrl: string,
  outputDir: string,
): Promise<string> {
  const currentUrl = page.url();
  if (!currentUrl.includes('notebooklm.google.com')) {
    await page.goto(NB_URLS.DASHBOARD, { waitUntil: 'networkidle2', timeout: 30000 });
  }

  mkdirSync(outputDir, { recursive: true });

  const cdp = await page.createCDPSession();
  try {
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allowAndName',
      downloadPath: outputDir,
      eventsEnabled: true,
    });

    await page.evaluate((url: string) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = 'audio.mp4';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, downloadUrl);

    const filePath = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Audio download timed out')), 120000);
      cdp.on('Browser.downloadProgress', (event: { guid: string; state: string }) => {
        if (event.state === 'completed') {
          clearTimeout(timeout);
          resolve(join(outputDir, event.guid));
        } else if (event.state === 'canceled') {
          clearTimeout(timeout);
          reject(new Error('Audio download canceled'));
        }
      });
    });

    console.error(`NotebookLM: Audio downloaded to ${filePath}`);
    return filePath;
  } finally {
    try { await cdp.detach(); } catch { /* ignore */ }
  }
}

// ── Artifact metadata helpers ──

/** Get raw artifact metadata from the GET_INTERACTIVE_HTML RPC. */
export async function getArtifactMetadata(
  callRpc: RpcCaller,
  artifactId: string,
): Promise<unknown[]> {
  const raw = await callRpc(NB_RPC.GET_INTERACTIVE_HTML, [artifactId]);
  const envelopes = parseEnvelopes(raw);
  const first = envelopes[0];
  if (Array.isArray(first) && Array.isArray(first[0])) return first[0] as unknown[];
  if (Array.isArray(first)) return first as unknown[];
  return [];
}

/** Poll artifact metadata until a condition is met. */
export async function pollArtifactMetadata(
  callRpc: RpcCaller,
  artifactId: string,
  isReady: (meta: unknown[]) => boolean,
  maxAttempts = 16,
): Promise<unknown[]> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const meta = await getArtifactMetadata(callRpc, artifactId);
    if (meta.length > 0 && isReady(meta)) return meta;
    await humanSleep(5000 + attempt * 3000);
  }
  return getArtifactMetadata(callRpc, artifactId);
}

// ── Type-specific save functions ──

/** Save quiz/flashcards HTML (getInteractiveHtml returns HTML with data-app-data). */
export async function saveQuizHtml(
  getInteractiveHtml: (artifactId: string) => Promise<string>,
  artifactId: string,
  outputDir: string,
  prefix: string,
): Promise<string> {
  let html = '';
  for (let attempt = 0; attempt < 12; attempt++) {
    html = await getInteractiveHtml(artifactId);
    if (html.length > 0) break;
    await humanSleep(5000 + attempt * 2500);
  }
  mkdirSync(outputDir, { recursive: true });
  const filePath = join(outputDir, `${prefix}_${Date.now()}.html`);
  writeFileSync(filePath, html, 'utf-8');
  return filePath;
}

/** Save report — poll metadata[7][0] for rendered markdown. */
export async function saveReport(
  callRpc: RpcCaller,
  artifactId: string,
  outputDir: string,
): Promise<string> {
  const meta = await pollArtifactMetadata(callRpc, artifactId, (m) => {
    const section = m[7];
    return Array.isArray(section) && typeof section[0] === 'string' && section[0].length > 100;
  }, 30);

  const section = meta[7] as unknown[];
  const markdown = typeof section?.[0] === 'string' ? section[0] : undefined;
  if (!markdown) {
    throw new Error('Report markdown not found in metadata');
  }

  mkdirSync(outputDir, { recursive: true });
  const filePath = join(outputDir, `report_${Date.now()}.md`);
  writeFileSync(filePath, markdown, 'utf-8');
  return filePath;
}

/** Save slides — poll metadata[16] for PPTX/PDF URLs, then download. */
export async function saveSlideDeck(
  callRpc: RpcCaller,
  download: DownloadFn,
  artifactId: string,
  outputDir: string,
): Promise<{ pptxPath: string; pdfPath?: string }> {
  const meta = await pollArtifactMetadata(callRpc, artifactId, (m) => {
    const cfg = m[16];
    return Array.isArray(cfg) && cfg.length >= 4 && typeof cfg[3] === 'string';
  }, 40);

  const cfg = meta[16] as unknown[];
  if (!Array.isArray(cfg) || cfg.length < 4) {
    throw new Error('Slide deck metadata not ready — PDF/PPTX URLs not found');
  }

  const pdfUrl = typeof cfg[3] === 'string' ? cfg[3] : undefined;
  const pptxUrl = typeof cfg[4] === 'string' ? cfg[4] : undefined;

  const url = pptxUrl ?? pdfUrl;
  if (!url) throw new Error('Slide deck: no download URL found in metadata');

  const ext = pptxUrl ? 'pptx' : 'pdf';
  const pptxPath = await download(url, outputDir, `slides_${Date.now()}.${ext}`);

  let pdfPath: string | undefined;
  if (pptxUrl && pdfUrl) {
    pdfPath = await download(pdfUrl, outputDir, `slides_${Date.now()}.pdf`);
  }

  return { pptxPath, pdfPath };
}

/** Save infographic — poll metadata for image URL, then download. */
export async function saveInfographic(
  callRpc: RpcCaller,
  download: DownloadFn,
  artifactId: string,
  outputDir: string,
): Promise<string> {
  const meta = await pollArtifactMetadata(callRpc, artifactId, (m) => {
    const section = m[14];
    if (!Array.isArray(section)) return false;
    const json = JSON.stringify(section);
    return json.includes('googleusercontent.com');
  }, 30);

  const section = meta[14];
  let imageUrl: string | undefined;
  const json = JSON.stringify(section);
  const urlMatch = json.match(/(https:\/\/lh3\.googleusercontent\.com\/[^"\\]+)/);
  if (urlMatch) imageUrl = urlMatch[1];

  if (!imageUrl) throw new Error('Infographic image URL not found in metadata');

  return download(imageUrl, outputDir, `infographic_${Date.now()}.png`);
}

/**
 * Ready predicate for data-table artifact metadata.
 *
 * The server's initial placeholder at `meta[18]` is `[null, [prompt, lang]]`
 * — the naive `length >= 2` check used previously returned true immediately.
 * The real table data lives at `section[0]`, and must match what
 * `extractDataTableCsv` can actually consume: a non-empty array. Requiring
 * only `section[0] !== null` is not strict enough — an absent slot is
 * `undefined`, and the server can also emit transient `'loading'`-style
 * strings or an empty data array before the rows are filled.
 *
 * Tradeoff: if the backend ever finalizes a data-table artifact with an
 * empty rows array (a valid but vacuous table), saveDataTable will poll
 * until timeout and fall back to the JSON dump. That is accepted as the
 * safer default vs. treating a mid-generation empty array as final,
 * which would silently save an empty result while real rows were still
 * on the way.
 */
export function isDataTableReady(meta: unknown[]): boolean {
  const section = meta[18];
  if (!Array.isArray(section)) return false;
  const dataNode = section[0];
  return Array.isArray(dataNode) && dataNode.length > 0;
}

/**
 * Convert ready data-table metadata into CSV text. Returns null when no
 * rows can be extracted (caller falls back to dumping raw JSON).
 *
 * Only `section[0]` (the data node) is walked. `section[1]` is the
 * `[prompt, lang]` echoed back by the server; feeding it to the walker
 * would emit a phantom row whose cells are the user's prompt + language
 * code, which is how the "CSV-is-just-my-prompt" bug used to surface.
 */
export function extractDataTableCsv(meta: unknown[]): string | null {
  const section = meta[18];
  if (!Array.isArray(section)) return null;
  const dataNode = section[0];
  if (!Array.isArray(dataNode)) return null;
  const rows = extractTableRows(dataNode as unknown[]);
  if (rows.length === 0) return null;
  return rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

/** Save data table — poll metadata for table data, save as CSV. */
export async function saveDataTable(
  callRpc: RpcCaller,
  artifactId: string,
  outputDir: string,
): Promise<string> {
  const meta = await pollArtifactMetadata(callRpc, artifactId, isDataTableReady);

  mkdirSync(outputDir, { recursive: true });

  const csv = extractDataTableCsv(meta);
  if (csv === null) {
    const filePath = join(outputDir, `data_table_${Date.now()}.json`);
    writeFileSync(filePath, JSON.stringify(meta[18], null, 2), 'utf-8');
    return filePath;
  }

  const filePath = join(outputDir, `data_table_${Date.now()}.csv`);
  writeFileSync(filePath, csv, 'utf-8');
  return filePath;
}

/** Walk metadata recursively, emitting rows that look like flat cell arrays. */
export function extractTableRows(data: unknown[]): string[][] {
  const rows: string[][] = [];
  function walk(val: unknown): void {
    if (!Array.isArray(val)) return;
    if (val.length > 1 && val.every(cell => typeof cell === 'string' || typeof cell === 'number' || cell === null)) {
      rows.push(val.map(cell => cell === null ? '' : String(cell)));
      return;
    }
    for (const item of val) walk(item);
  }
  walk(data);
  return rows;
}
