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

  if (session.cookieJar && session.cookieJar.length > 0) {
    for (const c of session.cookieJar) {
      const isDotDomain = c.domain.startsWith('.');
      const domain = isDotDomain ? c.domain : c.domain;
      const domainFlag = isDotDomain ? 'TRUE' : 'FALSE';
      const secure = c.secure ? 'TRUE' : 'FALSE';
      const path = c.path ?? '/';
      lines.push(`${domain}\t${domainFlag}\t${path}\t${secure}\t0\t${c.name}\t${c.value}`);
    }
  } else {
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
  writeFileSync(cookieJarPath, lines.join('\n'), 'utf-8');

  const curlArgs = [
    '-sSL',
    '-o', filePath,
    '-b', cookieJarPath,
    '-c', cookieJarPath,
    '-H', `User-Agent: ${session.userAgent}`,
    '-H', 'Referer: https://notebooklm.google.com/',
    '--max-redirs', '20',
  ];
  if (proxy) {
    curlArgs.push('-x', proxy);
  }
  curlArgs.push(downloadUrl);

  // Retry loop: CDN may return 404 briefly after artifact URL appears
  const maxRetries = 6;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await execFileAsync(curlBin, curlArgs, { timeout: 120_000 });
    } catch (err) {
      await unlink(cookieJarPath).catch(() => {});
      throw new Error(`Audio download failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Verify we got actual media, not HTML (404 page or login page)
    const content = await readFile(filePath);
    const head = content.slice(0, 50).toString('utf-8');
    if (!head.includes('<!doctype') && !head.includes('<html')) {
      break;
    }

    // HTML response — CDN not ready yet or auth issue
    await unlink(filePath).catch(() => {});
    if (attempt < maxRetries) {
      const delay = attempt * 10_000;
      console.error(`NotebookLM: CDN not ready (attempt ${attempt}/${maxRetries}), retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    } else {
      await unlink(cookieJarPath).catch(() => {});
      throw new Error('Audio download returned HTML after retries — CDN may be unavailable or session expired. Re-run: npx notebooklm export-session');
    }
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

/** Save data table — poll metadata for table data, save as CSV. */
export async function saveDataTable(
  callRpc: RpcCaller,
  artifactId: string,
  outputDir: string,
): Promise<string> {
  const meta = await pollArtifactMetadata(callRpc, artifactId, (m) => {
    const section = m[18];
    return Array.isArray(section) && section.length >= 2;
  });

  mkdirSync(outputDir, { recursive: true });

  const section = meta[18];
  let csvContent = '';

  if (Array.isArray(section)) {
    const rows = extractTableRows(section);
    if (rows.length > 0) {
      csvContent = rows.map(row =>
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','),
      ).join('\n');
    }
  }

  if (!csvContent) {
    const filePath = join(outputDir, `data_table_${Date.now()}.json`);
    writeFileSync(filePath, JSON.stringify(section, null, 2), 'utf-8');
    return filePath;
  }

  const filePath = join(outputDir, `data_table_${Date.now()}.csv`);
  writeFileSync(filePath, csvContent, 'utf-8');
  return filePath;
}

/** Try to extract rows from data table metadata. */
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
