/**
 * NotebookLM RPC client — transport-agnostic.
 *
 * Transport modes (auto-detected in 'auto' mode):
 *   - 'browser':          Real Chrome via Puppeteer (100% fingerprint, heavy)
 *   - 'curl-impersonate': curl with BoringSSL (100% fingerprint, macOS/Linux)
 *   - 'tls-client':       Go uTLS via FFI (99% fingerprint, all platforms)
 *   - 'http':             undici with Chrome ciphers (~40% fingerprint, always available)
 *   - 'auto':             Best available non-browser transport
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Page } from 'puppeteer-core';
import { SessionError, UserDisplayableError } from './errors.js';
import { humanSleep, jitteredIncrement } from './utils/humanize.js';
import { parseEnvelopes } from './boq-parser.js';
import { NB_RPC, NB_URLS, DEFAULT_USER_CONFIG, PLATFORM_WEB } from './rpc-ids.js';
import { loadNbRpcIds } from './rpc-config.js';
import { BrowserTransport } from './transport-browser.js';
import { detectBestTier, createTransport, TIER_LABELS } from './transport-resolver.js';
import type { TransportTier } from './transport-resolver.js';
import { saveSession, loadSession, refreshTokens } from './session-store.js';
import type { Transport } from './transport.js';
import {
  parseCreateNotebook,
  parseListNotebooks,
  parseNotebookDetail,
  parseAddSource,
  parseGenerateArtifact,
  parseArtifacts,
  parseChatStream,
  parseSourceSummary,
  parseStudioConfig,
  parseQuota,
} from './parser.js';
import type {
  NotebookSession,
  NotebookRpcSession,
  NotebookInfo,
  StudioConfig,
  AccountInfo,
  QuotaInfo,
  SourceInfo,
  ArtifactInfo,
  SourceInput,
  AudioOverviewOptions,
  AudioOverviewResult,
  MindMapOptions,
  MindMapResult,
  FlashcardsOptions,
  FlashcardsResult,
  AnalyzeOptions,
  AnalyzeResult,
  ChatOptions,
  ChatResult,
  WorkflowProgress,
  BrowserLaunchOptions,
} from './types.js';

export type TransportMode = 'browser' | 'curl-impersonate' | 'tls-client' | 'http' | 'auto';

export interface ConnectOptions extends BrowserLaunchOptions {
  /** Transport mode. Default: 'browser'. */
  transport?: TransportMode;
  /** Path to session file for HTTP mode. Uses default if omitted. */
  sessionPath?: string;
  /** Pre-built session data for HTTP mode. Takes precedence over sessionPath. */
  session?: NotebookRpcSession;
  /** Path to curl-impersonate binary. Auto-detected if omitted. */
  curlBinaryPath?: string;
  /** tls-client profile identifier. Default: 'chrome_131'. */
  tlsClientProfile?: string;
}

export class NotebookClient {
  private transport: Transport | null = null;
  private transportMode: TransportMode = 'browser';
  private reqCounter = 100000;
  private activeNotebookId = '';

  // ── Lifecycle ──

  async connect(config: ConnectOptions = {}): Promise<void> {
    this.transportMode = config.transport ?? 'browser';

    if (this.transportMode === 'browser') {
      await this.connectBrowser(config);
    } else {
      await this.connectHeadless(config);
    }
  }

  private async connectBrowser(config: ConnectOptions): Promise<void> {
    const bt = new BrowserTransport(config);
    await bt.init();
    this.transport = bt;

    // Auto-save session for later HTTP use
    try {
      const session = await bt.exportSession();
      const path = await saveSession(session, config.sessionPath);
      console.error(`NotebookLM: Session saved to ${path}`);
    } catch {
      // Non-critical
    }
  }

  private async connectHeadless(config: ConnectOptions): Promise<void> {
    let session = config.session ?? null;

    // Try NOTEBOOKLM_AUTH_JSON env var (for Docker/CI)
    if (!session && process.env['NOTEBOOKLM_AUTH_JSON']) {
      try {
        session = JSON.parse(process.env['NOTEBOOKLM_AUTH_JSON']) as NotebookRpcSession;
      } catch {
        throw new SessionError('NOTEBOOKLM_AUTH_JSON contains invalid JSON');
      }
    }

    if (!session) {
      session = await loadSession(config.sessionPath);
    }

    if (!session) {
      throw new SessionError(
        'No session available. ' +
        'Run `export-session` to log in, or set NOTEBOOKLM_AUTH_JSON env var.',
      );
    }

    const sessionPath = config.sessionPath;
    const onSessionExpired = async (): Promise<NotebookRpcSession> => {
      console.error('NotebookLM: Token expired, auto-refreshing...');
      try {
        return await refreshTokens(session!, sessionPath);
      } catch {
        const fromDisk = await loadSession(sessionPath);
        if (fromDisk) return fromDisk;
        throw new SessionError(
          'Session expired and auto-refresh failed (cookies may be invalid). ' +
          'Re-run `export-session` to log in again.',
        );
      }
    };

    // Determine transport tier
    let tier: TransportTier;
    if (this.transportMode === 'auto') {
      tier = await detectBestTier({ curlBinaryPath: config.curlBinaryPath });
    } else {
      // Direct tier selection: 'curl-impersonate' | 'tls-client' | 'http'
      tier = this.transportMode as TransportTier;
    }

    this.transport = await createTransport(tier, {
      session,
      curlBinaryPath: config.curlBinaryPath,
      tlsClientProfile: config.tlsClientProfile,
      onSessionExpired,
    });

    // Update transportMode to actual tier used (for getTransportMode())
    this.transportMode = tier;
    console.error(`NotebookLM: Connected via ${TIER_LABELS[tier]} (bl=${session.bl.slice(0, 40)}...)`);
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.dispose();
      this.transport = null;
    }
  }

  getSession(): NotebookSession | null {
    if (!this.transport) return null;
    const rpc = this.transport.getSession();
    return {
      loggedIn: true,
      userAgent: rpc.userAgent,
      notebookUrl: this.activeNotebookId
        ? `${NB_URLS.BASE}/notebook/${this.activeNotebookId}`
        : NB_URLS.DASHBOARD,
    };
  }

  getRpcSession(): NotebookRpcSession | null {
    if (!this.transport) return null;
    return this.transport.getSession();
  }

  /** Get the active Puppeteer Page (only available in browser mode). */
  getActivePage(): Page | null {
    if (this.transport instanceof BrowserTransport) {
      return this.transport.getPage();
    }
    return null;
  }

  /** Get current transport mode. */
  getTransportMode(): TransportMode {
    return this.transportMode;
  }

  /**
   * Export current session to disk for later HTTP mode use.
   * Only meaningful in browser mode.
   */
  async exportSession(path?: string): Promise<string> {
    if (!(this.transport instanceof BrowserTransport)) {
      throw new Error('exportSession is only available in browser mode');
    }
    const session = await this.transport.exportSession();
    return saveSession(session, path);
  }

  // ── RPC Transport ──

  private resolveRpcId(staticId: string): string {
    const overrides = loadNbRpcIds();
    return overrides[staticId] ?? staticId;
  }

  private nextReqId(): number {
    this.reqCounter += jitteredIncrement(100000, 0.2);
    return this.reqCounter;
  }

  async callBatchExecute(rpcId: string, payload: unknown[], sourcePath?: string): Promise<string> {
    if (!this.transport) throw new SessionError('Not connected');

    const resolvedId = this.resolveRpcId(rpcId);
    const { at, bl, fsid } = this.transport.getSession();
    const reqId = this.nextReqId();
    const sp = sourcePath ?? (this.activeNotebookId ? `/notebook/${this.activeNotebookId}` : '/');
    const fReq = JSON.stringify([[[resolvedId, JSON.stringify(payload), null, 'generic']]]);

    const doCall = (): Promise<string> =>
      this.transport!.execute({
        url: NB_URLS.BATCH_EXECUTE,
        queryParams: {
          rpcids: resolvedId,
          'source-path': sp,
          bl,
          hl: this.transport!.getSession().language ?? 'en',
          _reqid: String(reqId),
          rt: 'c',
          ...(fsid ? { 'f.sid': fsid } : {}),
        },
        body: { 'f.req': fReq, at },
      });

    try {
      const result = await doCall();
      if (result.includes('UserDisplayableError')) {
        throw new UserDisplayableError(result);
      }
      return result;
    } catch (err) {
      if (err instanceof UserDisplayableError) throw err;
      if (this.isAuthError(err)) {
        await this.transport.refreshSession();
        const result = await doCall();
        if (result.includes('UserDisplayableError')) {
          throw new UserDisplayableError(result);
        }
        return result;
      }
      throw err;
    }
  }

  private chatThreadId = '';
  private chatHistory: Array<[string, null, number]> = [];

  async callChatStream(notebookId: string, message: string, sourceIds: string[]): Promise<string> {
    if (!this.transport) throw new SessionError('Not connected');

    const sourceIdArrays = sourceIds.map((id) => [[id]]);
    const { at, bl, fsid } = this.transport.getSession();
    const reqId = this.nextReqId();

    const innerPayload = [
      sourceIdArrays,
      message,
      this.chatHistory.length > 0 ? this.chatHistory : [],
      [2, null, [1], [1]],
      this.chatThreadId || null,
      null,
      null,
      notebookId,
      1,
    ];

    const doCall = (): Promise<string> =>
      this.transport!.execute({
        url: NB_URLS.CHAT_STREAM,
        queryParams: {
          bl,
          hl: this.transport!.getSession().language ?? 'en',
          _reqid: String(reqId),
          rt: 'c',
          ...(fsid ? { 'f.sid': fsid } : {}),
        },
        body: {
          'f.req': JSON.stringify([null, JSON.stringify(innerPayload)]),
          at,
        },
      });

    try {
      return await doCall();
    } catch (err) {
      if (this.isAuthError(err)) {
        await this.transport.refreshSession();
        return doCall();
      }
      throw err;
    }
  }

  private isAuthError(err: unknown): boolean {
    if (err instanceof Error) return /HTTP\s+(401|400)\b/.test(err.message);
    return false;
  }

  // ── Low-level API Methods ──

  async createNotebook(): Promise<{ notebookId: string }> {
    const raw = await this.callBatchExecute(
      NB_RPC.CREATE_NOTEBOOK,
      ['', null, null, [...PLATFORM_WEB], [1, null, null, null, null, null, null, null, null, null, [1]]],
      '/',
    );
    const result = parseCreateNotebook(raw);
    this.activeNotebookId = result.notebookId;
    return result;
  }

  async listNotebooks(): Promise<NotebookInfo[]> {
    const raw = await this.callBatchExecute(NB_RPC.LIST_NOTEBOOKS, [null, 1, null, [...PLATFORM_WEB]], '/');
    return parseListNotebooks(raw);
  }

  async getNotebookDetail(notebookId: string): Promise<{ title: string; sources: SourceInfo[] }> {
    const raw = await this.callBatchExecute(
      NB_RPC.GET_NOTEBOOK,
      [notebookId, null, [...PLATFORM_WEB], null, 1],
      `/notebook/${notebookId}`,
    );
    return parseNotebookDetail(raw);
  }

  async deleteNotebook(notebookId: string): Promise<void> {
    await this.callBatchExecute(NB_RPC.DELETE_NOTEBOOK, [[notebookId], [...PLATFORM_WEB]], '/');
  }

  async addUrlSource(notebookId: string, url: string): Promise<{ sourceId: string; title: string }> {
    const raw = await this.callBatchExecute(
      NB_RPC.ADD_SOURCE,
      [
        [[null, null, [url], null, null, null, null, null, null, null, 1]],
        notebookId,
        [...PLATFORM_WEB],
        [1, null, null, null, null, null, null, null, null, null, [1]],
      ],
      `/notebook/${notebookId}`,
    );
    return parseAddSource(raw);
  }

  async addTextSource(notebookId: string, title: string, content: string): Promise<{ sourceId: string; title: string }> {
    const raw = await this.callBatchExecute(
      NB_RPC.ADD_SOURCE,
      [
        [[null, [title, content], null, 2, null, null, null, null, null, null, 1]],
        notebookId,
        [...PLATFORM_WEB],
        [1, null, null, null, null, null, null, null, null, null, [1]],
      ],
      `/notebook/${notebookId}`,
    );
    return parseAddSource(raw);
  }

  async createWebSearch(notebookId: string, query: string, mode: 'fast' | 'deep' = 'fast'): Promise<{ researchId: string }> {
    const modeFlag = mode === 'deep' ? 2 : 1;
    const raw = await this.callBatchExecute(
      NB_RPC.CREATE_WEB_SEARCH,
      [[query, modeFlag], null, 1, notebookId],
      `/notebook/${notebookId}`,
    );
    const envelopes = parseEnvelopes(raw);
    for (const env of envelopes) {
      if (env[0] === 'wrb.fr' && typeof env[2] === 'string') {
        try {
          const inner = JSON.parse(env[2]) as unknown;
          if (Array.isArray(inner) && typeof inner[0] === 'string') {
            return { researchId: inner[0] };
          }
        } catch { /* skip */ }
      }
    }
    return { researchId: '' };
  }

  async deleteSource(sourceId: string): Promise<void> {
    await this.callBatchExecute(NB_RPC.DELETE_SOURCE, [[[sourceId]], [...PLATFORM_WEB]]);
  }

  async getSourceSummary(sourceId: string): Promise<{ summary: string }> {
    const raw = await this.callBatchExecute(NB_RPC.GET_SOURCE_SUMMARY, [[[[sourceId]]]]);
    const result = parseSourceSummary(raw);
    return { summary: result.summary };
  }

  async generateArtifact(
    notebookId: string,
    type: number,
    sourceIds: string[],
    options?: { language?: string; customPrompt?: string },
  ): Promise<{ artifactId: string; title: string }> {
    const sourceIdArraysTriple = sourceIds.map((id) => [[id]]);
    const sourceIdArraysSingle = sourceIds.map((id) => [id]);
    const language = options?.language ?? this.transport!.getSession().language ?? 'en';
    const prompt = options?.customPrompt ?? null;

    const raw = await this.callBatchExecute(
      NB_RPC.GENERATE_ARTIFACT,
      [
        [...DEFAULT_USER_CONFIG],
        notebookId,
        [
          null,
          null,
          type,
          sourceIdArraysTriple,
          null,
          null,
          [null, [prompt, 1, null, sourceIdArraysSingle, language, null, 1]],
        ],
      ],
      `/notebook/${notebookId}`,
    );
    return parseGenerateArtifact(raw);
  }

  async getArtifacts(notebookId: string): Promise<ArtifactInfo[]> {
    const raw = await this.callBatchExecute(
      NB_RPC.GET_ARTIFACTS_FILTERED,
      [
        [...DEFAULT_USER_CONFIG],
        notebookId,
        'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"',
      ],
      `/notebook/${notebookId}`,
    );
    return parseArtifacts(raw);
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    await this.callBatchExecute(NB_RPC.DELETE_ARTIFACT, [[...DEFAULT_USER_CONFIG], artifactId]);
  }

  async getStudioConfig(notebookId: string): Promise<StudioConfig> {
    const raw = await this.callBatchExecute(
      NB_RPC.GET_STUDIO_CONFIG,
      [[...DEFAULT_USER_CONFIG], notebookId],
      `/notebook/${notebookId}`,
    );
    return parseStudioConfig(raw);
  }

  /** Get account info (plan type, limits). RPC: GetOrCreateAccount */
  async getAccountInfo(): Promise<AccountInfo> {
    const raw = await this.callBatchExecute(NB_RPC.GET_QUOTA, [[...DEFAULT_USER_CONFIG]], '/');
    return parseQuota(raw);
  }

  /** @deprecated Use getAccountInfo() instead */
  async getQuota(): Promise<QuotaInfo> {
    return this.getAccountInfo();
  }

  async downloadAudio(downloadUrl: string, outputDir: string): Promise<string> {
    const page = this.getActivePage();
    if (!page) {
      // HTTP mode: download directly via undici
      return this.downloadAudioHttp(downloadUrl, outputDir);
    }

    // Browser mode: use CDP download
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

  private async downloadAudioHttp(downloadUrl: string, outputDir: string): Promise<string> {
    if (!this.transport) throw new SessionError('Not connected');

    mkdirSync(outputDir, { recursive: true });

    const session = this.transport.getSession();
    const filePath = join(outputDir, `audio_${Date.now()}.mp4`);

    // Google download URLs redirect across domains (lh3.googleusercontent.com →
    // lh3.google.com → accounts.google.com). Cookies must be sent with correct
    // domain matching. Use curl-impersonate with a Netscape cookie jar built from
    // the session's cookieJar (which preserves per-cookie domain info from CDP).
    const { readFile, unlink } = await import('node:fs/promises');
    const { writeFileSync } = await import('node:fs');
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
      // Use domain-scoped cookies from CDP
      for (const c of session.cookieJar) {
        const domain = c.domain.startsWith('.') ? c.domain : `.${c.domain}`;
        const secure = c.secure ? 'TRUE' : 'FALSE';
        const path = c.path ?? '/';
        lines.push(`${domain}\tTRUE\t${path}\t${secure}\t0\t${c.name}\t${c.value}`);
      }
    } else {
      // Fallback: flat cookies string → assume .google.com domain
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

    try {
      await execFileAsync(curlBin, [
        '-sSL',
        '-o', filePath,
        '-b', cookieJarPath,
        '-c', cookieJarPath,
        '-H', `User-Agent: ${session.userAgent}`,
        '-H', 'Referer: https://notebooklm.google.com/',
        '--max-redirs', '20',
        downloadUrl,
      ], { timeout: 120_000 });
    } catch (err) {
      await unlink(cookieJarPath).catch(() => {});
      throw new Error(`Audio download failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    await unlink(cookieJarPath).catch(() => {});

    // Verify we got actual media, not HTML
    const content = await readFile(filePath);
    const head = content.slice(0, 50).toString('utf-8');
    if (head.includes('<!doctype') || head.includes('<html')) {
      await unlink(filePath).catch(() => {});
      throw new Error('Audio download returned login page — re-run: npx notebooklm export-session');
    }

    console.error(`NotebookLM: Audio downloaded to ${filePath}`);
    return filePath;
  }

  async sendChat(notebookId: string, message: string, sourceIds: string[]): Promise<{ text: string; threadId: string }> {
    const raw = await this.callChatStream(notebookId, message, sourceIds);
    const result = parseChatStream(raw);

    if (result.threadId) this.chatThreadId = result.threadId;
    this.chatHistory.push([message, null, 1]);
    if (result.text) {
      this.chatHistory.push([result.text, null, 2]);
    }

    return { text: result.text, threadId: result.threadId };
  }

  async deleteChatThread(threadId: string): Promise<void> {
    await this.callBatchExecute(NB_RPC.DELETE_CHAT_THREAD, [[], threadId, null, 1]);
  }

  // ── High-level Workflow Methods ──

  async runAudioOverview(
    options: AudioOverviewOptions,
    onProgress?: (p: WorkflowProgress) => void,
  ): Promise<AudioOverviewResult> {
    this.ensureConnected();

    onProgress?.({ status: 'creating_notebook', message: 'Creating notebook...' });
    const { notebookId } = await this.createNotebook();

    onProgress?.({ status: 'adding_source', message: `Adding source (${options.source.type})...` });
    const sourceIds = await this.addSourceFromInput(notebookId, options.source);

    onProgress?.({ status: 'configuring', message: 'Waiting for source processing...' });
    await this.pollSourcesReady(notebookId, 120_000);

    onProgress?.({ status: 'generating', message: 'Generating audio overview...' });
    const config = await this.getStudioConfig(notebookId);
    const audioType = config.audioTypes.find(t => t.name.includes('Deep Dive')) ?? config.audioTypes[0];
    if (!audioType) throw new Error('No audio types available from Studio config');
    const { artifactId } = await this.generateArtifact(
      notebookId,
      audioType.id,
      sourceIds,
      { language: options.language, customPrompt: options.customPrompt },
    );

    onProgress?.({ status: 'generating', message: 'Waiting for audio generation...' });
    const audioDownloadUrl = await this.pollArtifactReady(notebookId, artifactId, 1_800_000);

    onProgress?.({ status: 'downloading', message: 'Downloading audio...' });
    const audioPath = await this.downloadAudio(audioDownloadUrl, options.outputDir);

    onProgress?.({ status: 'completed', message: 'Audio overview complete!' });
    return { audioPath, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
  }

  async runMindMap(
    options: MindMapOptions,
    onProgress?: (p: WorkflowProgress) => void,
  ): Promise<MindMapResult> {
    this.ensureConnected();

    onProgress?.({ status: 'creating_notebook', message: 'Creating notebook...' });
    const { notebookId } = await this.createNotebook();

    onProgress?.({ status: 'adding_source', message: `Adding source (${options.source.type})...` });
    await this.addSourceFromInput(notebookId, options.source);
    await this.pollSourcesReady(notebookId, 120_000);

    onProgress?.({ status: 'generating', message: 'Generating mind map (via page)...' });
    const page = this.getActivePage();
    if (page) {
      await page.goto(`${NB_URLS.BASE}/notebook/${notebookId}`, { waitUntil: 'networkidle2', timeout: 60000 });
      await humanSleep(5000);
    }

    mkdirSync(options.outputDir, { recursive: true });
    const imagePath = join(options.outputDir, `mindmap_${Date.now()}.png`);
    if (page) {
      await page.screenshot({ path: imagePath, fullPage: true });
    }

    onProgress?.({ status: 'completed', message: 'Mind map complete!' });
    return { imagePath, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
  }

  async runFlashcards(
    options: FlashcardsOptions,
    onProgress?: (p: WorkflowProgress) => void,
  ): Promise<FlashcardsResult> {
    this.ensureConnected();

    onProgress?.({ status: 'creating_notebook', message: 'Creating notebook...' });
    const { notebookId } = await this.createNotebook();

    onProgress?.({ status: 'adding_source', message: `Adding source (${options.source.type})...` });
    const sourceIds = await this.addSourceFromInput(notebookId, options.source);
    await this.pollSourcesReady(notebookId, 120_000);

    onProgress?.({ status: 'generating', message: 'Generating flashcards...' });
    await this.generateArtifact(notebookId, 4, sourceIds);

    onProgress?.({ status: 'completed', message: 'Flashcards generated!' });
    return { cards: [], notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
  }

  async runAnalyze(
    options: AnalyzeOptions,
    onProgress?: (p: WorkflowProgress) => void,
  ): Promise<AnalyzeResult> {
    this.ensureConnected();

    onProgress?.({ status: 'creating_notebook', message: 'Creating notebook...' });
    const { notebookId } = await this.createNotebook();

    onProgress?.({ status: 'adding_source', message: `Adding source (${options.source.type})...` });
    const sourceIds = await this.addSourceFromInput(notebookId, options.source);
    await this.pollSourcesReady(notebookId, 120_000);

    onProgress?.({ status: 'generating', message: 'Analyzing...' });
    const { text } = await this.sendChat(notebookId, options.question, sourceIds);

    onProgress?.({ status: 'completed', message: 'Analysis complete!' });
    return { answer: text, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
  }

  async chat(options: ChatOptions): Promise<ChatResult> {
    this.ensureConnected();
    if (!this.activeNotebookId) throw new Error('No active notebook. Create or open one first.');

    const detail = await this.getNotebookDetail(this.activeNotebookId);
    const sourceIds = detail.sources.map((s) => s.id);

    const { text } = await this.sendChat(this.activeNotebookId, options.message, sourceIds);
    return { response: text };
  }

  // ── Private Helpers ──

  private async addSourceFromInput(notebookId: string, source: SourceInput): Promise<string[]> {
    switch (source.type) {
      case 'url': {
        const { sourceId } = await this.addUrlSource(notebookId, source.url!);
        return [sourceId];
      }
      case 'text': {
        const { sourceId } = await this.addTextSource(notebookId, 'Pasted Text', source.text!);
        return [sourceId];
      }
      case 'research': {
        await this.createWebSearch(notebookId, source.topic!, source.researchMode ?? 'fast');
        await humanSleep(10000);
        const detail = await this.getNotebookDetail(notebookId);
        return detail.sources.map((s) => s.id);
      }
    }
  }

  private async pollSourcesReady(notebookId: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    let pollCount = 0;
    while (Date.now() - start < timeoutMs) {
      const detail = await this.getNotebookDetail(notebookId);
      const allReady = detail.sources.length > 0 && detail.sources.every((s) => s.wordCount !== undefined && s.wordCount > 0);
      if (allReady) return;
      pollCount++;
      const delay = Math.min(3000 + pollCount * 1500, 15000);
      await humanSleep(delay);
    }
    console.error('NotebookLM: Source processing may not have completed within timeout');
  }

  private async pollArtifactReady(notebookId: string, artifactId: string, timeoutMs: number): Promise<string> {
    const start = Date.now();
    let pollCount = 0;

    while (Date.now() - start < timeoutMs) {
      const artifacts = await this.getArtifacts(notebookId);
      const artifact = artifacts.find((a) => a.id === artifactId);
      if (artifact?.downloadUrl) return artifact.downloadUrl;

      pollCount++;
      const baseDelay = Math.min(5000 + pollCount * 2500, 30000);
      await humanSleep(baseDelay);
    }
    throw new Error('Audio generation timed out');
  }

  private ensureConnected(): void {
    if (!this.transport) throw new SessionError('NotebookLM client not connected');
  }
}
