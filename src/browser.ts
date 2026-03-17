/**
 * Simplified browser management for standalone NotebookLM client.
 *
 * Combines: detectChromePath, getSystemFingerprint, injectAntiDetection,
 * cleanProfileForLaunch, and launchBrowser into a single module.
 */

import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { readFile, writeFile, unlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { platform, cpus, totalmem, hostname } from 'node:os';
import crypto from 'node:crypto';
import { BrowserError } from './errors.js';
import { getProfileDir } from './paths.js';
import type { BrowserLaunchOptions } from './types.js';

// Lazy — must not evaluate at import time (setHomeDir may not have been called yet)
function getDefaultProfileDir(): string {
  return getProfileDir();
}

// ── Chrome Detection ──

export function detectChromePath(): string | undefined {
  const os = platform();

  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  const localAppData = process.env['LOCALAPPDATA'] ?? '';
  const programFiles = process.env['PROGRAMFILES'] ?? '';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';

  const paths: Record<string, string[]> = {
    win32: [
      // Chrome
      `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      // Edge (pre-installed on Windows 10+)
      `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      // Brave
      `${localAppData}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
      `${programFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    ],
    darwin: [
      // Chrome
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `${home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      // Edge
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      // Brave
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      // Chromium
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    linux: [
      // Chrome
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      // Edge
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      // Brave
      '/usr/bin/brave-browser',
      '/usr/bin/brave-browser-stable',
      // Chromium
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ],
  };

  const candidates = paths[os] ?? [];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

// ── Fingerprint ──

export interface FingerprintConfig {
  hardwareConcurrency: number;
  deviceMemory: number;
  webglVendor: string;
  webglRenderer: string;
  languages: string[];
  platform: string;
  canvasNoiseSeed: number;
  canvasNoisePixels: number;
  canvasNoiseDelta: number;
}

function hashToSeed(input: string): number {
  const hash = crypto.createHash('md5').update(input).digest();
  return hash.readUInt32LE(0);
}

export function getSystemFingerprint(): FingerprintConfig {
  const cpuCount = cpus().length;
  const totalMemGB = Math.round(totalmem() / (1024 ** 3));
  const deviceMemory = Math.min(totalMemGB, 8);
  const seed = hashToSeed(hostname());

  return {
    hardwareConcurrency: cpuCount,
    deviceMemory,
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    languages: ['en-US', 'en'],
    platform: 'Win32',
    canvasNoiseSeed: seed,
    canvasNoisePixels: 8,
    canvasNoiseDelta: 3,
  };
}

// ── Anti-Detection Injection ──

const ANTI_DETECTION_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--remote-allow-origins=*',
  '--lang=en-US',
  '--disable-session-crashed-bubble',
  '--disable-features=InfiniteSessionRestore',
  '--hide-crash-restore-bubble',
] as const;

export async function injectAntiDetection(page: Page, config?: FingerprintConfig): Promise<void> {
  const fp = config ?? getSystemFingerprint();

  await page.evaluateOnNewDocument(
    (cfg: {
      hardwareConcurrency: number;
      deviceMemory: number;
      webglVendor: string;
      webglRenderer: string;
      languages: string[];
      platform: string;
      canvasNoiseSeed: number;
      canvasNoisePixels: number;
      canvasNoiseDelta: number;
    }) => {
      // mulberry32 PRNG
      function mulberry32(seed: number): () => number {
        let s = seed | 0;
        return () => {
          s = (s + 0x6D2B79F5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }

      // webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // plugins
      const pluginData = [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', mimeType: 'application/pdf' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', mimeType: 'application/pdf' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', mimeType: 'application/pdf' },
        { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', mimeType: 'application/pdf' },
        { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format', mimeType: 'application/pdf' },
      ];

      const plugins: Array<Record<number | string, unknown>> = pluginData.map(p => {
        const mimeEntry = { type: p.mimeType, suffixes: 'pdf', description: p.description };
        const plugin: Record<number | string, unknown> = {
          name: p.name, filename: p.filename, description: p.description,
          length: 1, 0: mimeEntry,
        };
        Object.setPrototypeOf(plugin, PluginArray.prototype);
        return plugin;
      });
      Object.defineProperty(plugins, 'length', { get: () => pluginData.length });
      Object.defineProperty(navigator, 'plugins', { get: () => plugins });

      // languages & platform
      Object.defineProperty(navigator, 'languages', { get: () => [...cfg.languages] });
      Object.defineProperty(navigator, 'platform', { get: () => cfg.platform });

      // permissions
      const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
      window.navigator.permissions.query = (parameters: PermissionDescriptor) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: 'denied' } as PermissionStatus)
          : originalQuery(parameters);

      // chrome object
      Object.defineProperty(window, 'chrome', {
        writable: true,
        value: {
          runtime: {
            connect: function() { return { onMessage: { addListener: function() {} }, postMessage: function() {} }; },
            sendMessage: function() {},
            onMessage: { addListener: function() {}, removeListener: function() {} },
          },
          loadTimes: () => {
            const t = performance.timing;
            return {
              commitLoadTime: t.responseStart / 1000,
              connectionInfo: 'h2',
              finishDocumentLoadTime: t.domContentLoadedEventEnd / 1000,
              finishLoadTime: t.loadEventEnd / 1000,
              firstPaintAfterLoadTime: 0,
              firstPaintTime: t.responseStart / 1000 + 0.1,
              navigationType: 'Other',
              npnNegotiatedProtocol: 'h2',
              requestTime: t.requestStart / 1000,
              startLoadTime: t.navigationStart / 1000,
              wasAlternateProtocolAvailable: false,
              wasFetchedViaSpdy: true,
              wasNpnNegotiated: true,
            };
          },
          csi: () => ({
            onloadT: performance.timing.domContentLoadedEventEnd,
            startE: performance.timing.navigationStart,
            pageT: Date.now() - performance.timing.navigationStart,
          }),
          app: { isInstalled: false, getDetails: function() { return null; }, getIsInstalled: function() { return false; } },
        },
      });

      // Canvas fingerprint (deterministic noise)
      const rng = mulberry32(cfg.canvasNoiseSeed);
      const noisePositions: Array<{ x: number; y: number; dr: number; dg: number; db: number }> = [];
      for (let i = 0; i < cfg.canvasNoisePixels; i++) {
        noisePositions.push({
          x: Math.floor(rng() * 100),
          y: Math.floor(rng() * 100),
          dr: Math.floor(rng() * (cfg.canvasNoiseDelta * 2 + 1)) - cfg.canvasNoiseDelta,
          dg: Math.floor(rng() * (cfg.canvasNoiseDelta * 2 + 1)) - cfg.canvasNoiseDelta,
          db: Math.floor(rng() * (cfg.canvasNoiseDelta * 2 + 1)) - cfg.canvasNoiseDelta,
        });
      }

      const noisedCanvases = new WeakSet<HTMLCanvasElement>();

      function applyCanvasNoise(canvas: HTMLCanvasElement): void {
        if (noisedCanvases.has(canvas)) return;
        const ctx = canvas.getContext('2d');
        if (!ctx || canvas.width === 0 || canvas.height === 0) return;
        for (const pos of noisePositions) {
          const px = pos.x % canvas.width;
          const py = pos.y % canvas.height;
          const imgData = ctx.getImageData(px, py, 1, 1);
          imgData.data[0] = Math.max(0, Math.min(255, (imgData.data[0] ?? 0) + pos.dr));
          imgData.data[1] = Math.max(0, Math.min(255, (imgData.data[1] ?? 0) + pos.dg));
          imgData.data[2] = Math.max(0, Math.min(255, (imgData.data[2] ?? 0) + pos.db));
          ctx.putImageData(imgData, px, py);
        }
        noisedCanvases.add(canvas);
      }

      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (type?: string, quality?: number) {
        applyCanvasNoise(this);
        return origToDataURL.call(this, type, quality);
      };

      const origToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback, type?: string, quality?: number) {
        applyCanvasNoise(this);
        return origToBlob.call(this, callback, type, quality);
      };

      // WebGL parameter masking
      function hookWebGL(proto: { getParameter: (pname: number) => unknown }): void {
        const origGetParam = proto.getParameter;
        proto.getParameter = function (pname: number): unknown {
          if (pname === 0x9245) return cfg.webglVendor;
          if (pname === 0x9246) return cfg.webglRenderer;
          return origGetParam.call(this, pname);
        };
      }
      hookWebGL(WebGLRenderingContext.prototype);
      if (typeof WebGL2RenderingContext !== 'undefined') {
        hookWebGL(WebGL2RenderingContext.prototype);
      }

      // hardwareConcurrency / deviceMemory
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cfg.hardwareConcurrency });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => cfg.deviceMemory });

      // Error stack sanitization
      const origError = Error;
      const errorHandler: ProxyHandler<ErrorConstructor> = {
        construct(target: ErrorConstructor, args: [string?]) {
          const err = new target(args[0]);
          const origStack = err.stack;
          if (origStack) {
            err.stack = origStack
              .replace(/pptr:\/\//g, 'chrome-extension://')
              .replace(/devtools:\/\//g, 'chrome-extension://')
              .replace(/chrome-error:\/\//g, 'chrome-extension://')
              .replace(/__puppeteer_evaluation_script__/g, 'chrome-extension://extension');
          }
          return err;
        },
      };
      (window as unknown as Record<string, unknown>).Error = new Proxy(origError, errorHandler);
    },
    {
      hardwareConcurrency: fp.hardwareConcurrency,
      deviceMemory: fp.deviceMemory,
      webglVendor: fp.webglVendor,
      webglRenderer: fp.webglRenderer,
      languages: fp.languages,
      platform: fp.platform,
      canvasNoiseSeed: fp.canvasNoiseSeed,
      canvasNoisePixels: fp.canvasNoisePixels,
      canvasNoiseDelta: fp.canvasNoiseDelta,
    },
  );
}

// ── Profile Cleanup ──

export async function cleanProfileForLaunch(profileDir: string): Promise<void> {
  await Promise.allSettled([
    cleanPreferences(profileDir),
    cleanLocalState(profileDir),
    removeStaleDevToolsPort(profileDir),
  ]);
}

async function cleanPreferences(profileDir: string): Promise<void> {
  const prefsPath = join(profileDir, 'Default', 'Preferences');

  let raw: string;
  try {
    raw = await readFile(prefsPath, 'utf-8');
  } catch {
    return;
  }

  let prefs: Record<string, unknown>;
  try {
    prefs = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }

  const profile = prefs['profile'] as Record<string, unknown> | undefined;
  if (!profile) return;

  let changed = false;

  if (profile['exit_type'] !== 'Normal') {
    profile['exit_type'] = 'Normal';
    changed = true;
  }

  if (profile['exited_cleanly'] !== true) {
    profile['exited_cleanly'] = true;
    changed = true;
  }

  if (changed) {
    try {
      await writeFile(prefsPath, JSON.stringify(prefs, null, 3), 'utf-8');
    } catch {
      // Failed to write — not critical
    }
  }
}

async function cleanLocalState(profileDir: string): Promise<void> {
  const statePath = join(profileDir, 'Local State');

  let raw: string;
  try {
    raw = await readFile(statePath, 'utf-8');
  } catch {
    return;
  }

  let state: Record<string, unknown>;
  try {
    state = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }

  let changed = false;

  const profile = state['profile'] as Record<string, unknown> | undefined;
  if (profile && profile['exited_cleanly'] !== true) {
    profile['exited_cleanly'] = true;
    changed = true;
  }

  const metrics = state['user_experience_metrics'] as Record<string, unknown> | undefined;
  if (metrics) {
    const stability = metrics['stability'] as Record<string, unknown> | undefined;
    if (stability && stability['exited_cleanly'] !== true) {
      stability['exited_cleanly'] = true;
      changed = true;
    }
  }

  if (changed) {
    try {
      await writeFile(statePath, JSON.stringify(state, null, 3), 'utf-8');
    } catch {
      // Failed to write — not critical
    }
  }
}

async function removeStaleDevToolsPort(profileDir: string): Promise<void> {
  const portFile = join(profileDir, 'DevToolsActivePort');
  try {
    await access(portFile);
    await unlink(portFile);
  } catch {
    // File doesn't exist — nothing to do
  }
}

// ── Browser Launch ──

export interface BrowserSession {
  browser: Browser;
  page: Page;
}

export async function launchBrowser(opts: BrowserLaunchOptions = {}): Promise<BrowserSession> {
  const profileDir = opts.profileDir ?? getDefaultProfileDir();
  const chromePath = opts.executablePath ?? detectChromePath();

  if (!chromePath) {
    throw new BrowserError(
      'Chrome not found. Please install Chrome or specify --chrome-path.\n' +
      'Checked: macOS /Applications, Linux /usr/bin, Windows Program Files',
    );
  }

  await cleanProfileForLaunch(profileDir);

  const launchArgs = [...ANTI_DETECTION_ARGS, ...(opts.args ?? [])];
  if (opts.proxy) {
    launchArgs.push(`--proxy-server=${opts.proxy}`);
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    userDataDir: profileDir,
    headless: opts.headless ?? false,
    args: launchArgs,
    ignoreDefaultArgs: ['--enable-automation'],
    defaultViewport: null,
    timeout: opts.timeout ?? 60000,
    protocolTimeout: opts.protocolTimeout ?? 120000,
  });

  // Close the default about:blank tab, use a fresh page with anti-detection.
  const existingPages = await browser.pages();
  const page = await browser.newPage();
  await injectAntiDetection(page, getSystemFingerprint());
  // Close default tab after creating ours, so Chrome doesn't quit
  for (const p of existingPages) {
    if (p !== page) {
      try { await p.close(); } catch { /* ignore */ }
    }
  }

  return { browser, page };
}

export { getDefaultProfileDir as getDefaultProfileDir };
