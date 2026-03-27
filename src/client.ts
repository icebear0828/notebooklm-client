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

import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { type Page } from 'puppeteer-core';
import { SessionError, UserDisplayableError } from './errors.js';
import { humanSleep, jitteredIncrement } from './utils/humanize.js';
import { parseEnvelopes } from './boq-parser.js';
import { NB_RPC, NB_URLS, DEFAULT_USER_CONFIG, PLATFORM_WEB, ARTIFACT_TYPE } from './rpc-ids.js';
import { buildArtifactPayload } from './artifact-payloads.js';
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
  parseResearchResults,
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
  ResearchResult,
  ArtifactGenerateOptions,
  LegacyArtifactOptions,
  ReportOptions,
  ReportResult,
  VideoOptions,
  VideoResult,
  QuizOptions,
  QuizResult,
  InfographicOptions,
  InfographicResult,
  SlideDeckOptions,
  SlideDeckResult,
  DataTableOptions,
  DataTableResult,
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
  private proxy?: string;
  private reqCounter = 100000;
  private activeNotebookId = '';

  // ── Lifecycle ──

  async connect(config: ConnectOptions = {}): Promise<void> {
    this.transportMode = config.transport ?? 'browser';
    this.proxy = config.proxy;

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
    const proxyUrl = config.proxy;
    const onSessionExpired = async (): Promise<NotebookRpcSession> => {
      console.error('NotebookLM: Token expired, auto-refreshing...');
      try {
        return await refreshTokens(session!, sessionPath, proxyUrl);
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
      proxy: config.proxy,
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

  async renameNotebook(notebookId: string, newTitle: string): Promise<void> {
    await this.callBatchExecute(
      NB_RPC.RENAME_NOTEBOOK,
      [notebookId, [[null, null, null, [null, newTitle]]]],
      '/',
    );
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

  /**
   * Upload a local file as a source. Works with all transports.
   *
   * Uses Google's Scotty resumable upload protocol:
   *   1. Register file source via RPC (ADD_SOURCE_FILE)
   *   2. Initiate resumable upload session
   *   3. Upload raw file bytes
   *
   * Supported: pdf, txt, md, docx, csv, pptx, epub, mp3, wav, m4a, png, jpg, gif, etc.
   */
  async addFileSource(notebookId: string, filePath: string): Promise<{ sourceId: string; title: string }> {
    if (!this.transport) throw new SessionError('Not connected');

    const absPath = resolve(filePath);
    const stat = statSync(absPath);
    if (!stat.isFile()) throw new Error(`Not a file: ${absPath}`);
    const fileName = basename(absPath);
    const fileSize = stat.size;

    // Step 1: Register file source via RPC
    const raw = await this.callBatchExecute(
      NB_RPC.ADD_SOURCE_FILE,
      [
        [[fileName]],
        notebookId,
        [...PLATFORM_WEB],
        [1, null, null, null, null, null, null, null, null, null, [1]],
      ],
      `/notebook/${notebookId}`,
    );
    const { sourceId } = parseAddSource(raw);
    if (!sourceId) throw new Error('Failed to register file source — no sourceId returned');

    // Steps 2+3: Upload file via Scotty resumable protocol
    const fileBuffer = readFileSync(absPath);
    await this.scottyUpload(notebookId, fileName, sourceId, fileSize, fileBuffer);

    return { sourceId, title: fileName };
  }

  /**
   * Execute Scotty resumable upload: initiate session → upload bytes.
   * Uses a single HTTP agent for both requests.
   */
  private async scottyUpload(
    notebookId: string, fileName: string, sourceId: string, fileSize: number, fileBuffer: Buffer,
  ): Promise<void> {
    const { request: undiciRequest, Agent, ProxyAgent } = await import('undici');
    const { CHROME_CIPHERS } = await import('./tls-config.js');
    const session = this.transport!.getSession();

    const baseHeaders: Record<string, string> = {
      'Accept': '*/*',
      'Cookie': session.cookies,
      'Origin': 'https://notebooklm.google.com',
      'Referer': 'https://notebooklm.google.com/',
      'User-Agent': session.userAgent,
      'x-goog-authuser': '0',
    };

    let dispatcher: InstanceType<typeof Agent> | InstanceType<typeof ProxyAgent>;
    if (this.proxy) {
      dispatcher = new ProxyAgent({
        uri: this.proxy,
        requestTls: { ciphers: CHROME_CIPHERS, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.3' },
      });
    } else {
      dispatcher = new Agent({
        connect: {
          ciphers: CHROME_CIPHERS,
          minVersion: 'TLSv1.2',
          maxVersion: 'TLSv1.3',
          ALPNProtocols: ['h2', 'http/1.1'],
        } as Record<string, unknown>,
      });
    }

    const doPost = async (
      url: string, headers: Record<string, string>, body: string | Buffer,
    ): Promise<{ status: number; headers: Record<string, string>; body: string }> => {
      const response = await undiciRequest(url, {
        method: 'POST', headers, body, dispatcher,
        headersTimeout: 300_000,
        bodyTimeout: 300_000,
      });
      const responseBody = await response.body.text();
      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(response.headers)) {
        if (typeof value === 'string') {
          responseHeaders[key] = value;
        } else if (Array.isArray(value) && value[0] != null) {
          responseHeaders[key] = value[0];
        }
      }
      return { status: response.statusCode, headers: responseHeaders, body: responseBody };
    };

    try {
      // Step 2: Initiate resumable upload session
      const initResp = await doPost(`${NB_URLS.UPLOAD}?authuser=0`, {
        ...baseHeaders,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-goog-upload-command': 'start',
        'x-goog-upload-header-content-length': String(fileSize),
        'x-goog-upload-protocol': 'resumable',
      }, JSON.stringify({ PROJECT_ID: notebookId, SOURCE_NAME: fileName, SOURCE_ID: sourceId }));

      const uploadUrl = initResp.headers['x-goog-upload-url'];
      if (!uploadUrl) {
        throw new Error(`Upload session initiation failed (HTTP ${initResp.status}): no x-goog-upload-url in response`);
      }

      // Step 3: Upload file bytes
      const uploadResp = await doPost(uploadUrl, {
        ...baseHeaders,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'x-goog-upload-command': 'upload, finalize',
        'x-goog-upload-offset': '0',
      }, fileBuffer);

      if (uploadResp.status < 200 || uploadResp.status >= 300) {
        throw new Error(`File upload failed (HTTP ${uploadResp.status}): ${uploadResp.body.slice(0, 200)}`);
      }
    } finally {
      await dispatcher.close();
    }
  }

  async createWebSearch(notebookId: string, query: string, mode: 'fast' | 'deep' = 'fast'): Promise<{ researchId: string; artifactId?: string }> {
    if (mode === 'deep') {
      return this.createDeepResearch(notebookId, query);
    }

    // Fast Research — uses Ljjv0c
    const raw = await this.callBatchExecute(
      NB_RPC.CREATE_WEB_SEARCH,
      [[query, 1], null, 1, notebookId],
      `/notebook/${notebookId}`,
    );
    const envelopes = parseEnvelopes(raw);
    // Response: [taskId] or [taskId, reportId]
    const first = envelopes[0];
    const taskId = Array.isArray(first) && typeof first[0] === 'string' ? first[0] : '';
    if (!taskId) {
      console.error('NotebookLM: Warning — failed to parse researchId from fast research response');
    }
    return { researchId: taskId };
  }

  /**
   * Deep Research — uses QA9ei RPC (since ~2026-03-19).
   * Returns researchId + artifactId.
   */
  private async createDeepResearch(notebookId: string, query: string): Promise<{ researchId: string; artifactId?: string }> {
    const raw = await this.callBatchExecute(
      NB_RPC.CREATE_DEEP_RESEARCH,
      [null, [1], [query, 1], 5, notebookId],
      `/notebook/${notebookId}`,
    );
    // Response: [taskId, reportId]
    const envelopes = parseEnvelopes(raw);
    const first = envelopes[0];
    const taskId = Array.isArray(first) && typeof first[0] === 'string' ? first[0] : '';
    const reportId = Array.isArray(first) && typeof first[1] === 'string' ? first[1] : undefined;
    if (!taskId) {
      console.error('NotebookLM: Warning — failed to parse researchId from deep research response');
    }
    return { researchId: taskId, artifactId: reportId };
  }

  async deleteSource(sourceId: string): Promise<void> {
    await this.callBatchExecute(NB_RPC.DELETE_SOURCE, [[[sourceId]], [...PLATFORM_WEB]]);
  }

  async getSourceSummary(sourceId: string): Promise<{ summary: string }> {
    const raw = await this.callBatchExecute(NB_RPC.GET_SOURCE_SUMMARY, [[[[sourceId]]]]);
    const result = parseSourceSummary(raw);
    return { summary: result.summary };
  }

  async renameSource(notebookId: string, sourceId: string, newTitle: string): Promise<void> {
    await this.callBatchExecute(
      NB_RPC.UPDATE_SOURCE,
      [null, [sourceId], [[[newTitle]]]],
      `/notebook/${notebookId}`,
    );
  }

  async refreshSource(notebookId: string, sourceId: string): Promise<void> {
    await this.callBatchExecute(
      NB_RPC.REFRESH_SOURCE,
      [null, [sourceId], [...PLATFORM_WEB]],
      `/notebook/${notebookId}`,
    );
  }

  // ── Notes ──

  async listNotes(notebookId: string): Promise<Array<{ id: string; title: string; content: string }>> {
    const raw = await this.callBatchExecute(
      NB_RPC.GET_NOTES,
      [notebookId],
      `/notebook/${notebookId}`,
    );
    const envelopes = parseEnvelopes(raw);
    const first = envelopes[0];
    if (!Array.isArray(first) || !Array.isArray(first[0])) return [];

    const notes: Array<{ id: string; title: string; content: string }> = [];
    for (const item of first[0]) {
      if (!Array.isArray(item) || typeof item[0] !== 'string') continue;
      // Skip deleted notes (status=2): [id, null, 2]
      if (item[1] === null && item[2] === 2) continue;
      // Skip mind maps (JSON content with "children"/"nodes")
      const content = typeof item[1] === 'string'
        ? item[1]
        : (Array.isArray(item[1]) && typeof item[1][1] === 'string' ? item[1][1] : '');
      if (content.includes('"children":') || content.includes('"nodes":')) continue;

      let title = '';
      if (Array.isArray(item[1]) && typeof item[1][4] === 'string') {
        title = item[1][4];
      }
      notes.push({ id: item[0], title, content });
    }
    return notes;
  }

  async createNote(notebookId: string, title = 'New Note', content = ''): Promise<{ noteId: string }> {
    const raw = await this.callBatchExecute(
      NB_RPC.CREATE_NOTE,
      [notebookId, '', [1], null, 'New Note'],
      `/notebook/${notebookId}`,
    );
    const envelopes = parseEnvelopes(raw);
    const first = envelopes[0];
    let noteId = '';
    if (Array.isArray(first) && Array.isArray(first[0]) && typeof first[0][0] === 'string') {
      noteId = first[0][0];
    } else if (Array.isArray(first) && typeof first[0] === 'string') {
      noteId = first[0];
    }
    // Google ignores title in CREATE_NOTE, so always update after creation
    if (noteId && (title !== 'New Note' || content)) {
      await this.updateNote(notebookId, noteId, content, title);
    }
    return { noteId };
  }

  async updateNote(notebookId: string, noteId: string, content: string, title: string): Promise<void> {
    await this.callBatchExecute(
      NB_RPC.UPDATE_NOTE,
      [notebookId, noteId, [[[content, title, [], 0]]]],
      `/notebook/${notebookId}`,
    );
  }

  async deleteNote(notebookId: string, noteId: string): Promise<void> {
    await this.callBatchExecute(
      NB_RPC.DELETE_NOTE,
      [notebookId, null, [noteId]],
      `/notebook/${notebookId}`,
    );
  }

  // ── Sharing ──

  async getShareStatus(notebookId: string): Promise<unknown> {
    const raw = await this.callBatchExecute(
      NB_RPC.GET_SHARE_STATUS,
      [notebookId, [...PLATFORM_WEB]],
      `/notebook/${notebookId}`,
    );
    return parseEnvelopes(raw)[0] ?? null;
  }

  async shareNotebook(notebookId: string, isPublic: boolean): Promise<void> {
    const access = isPublic ? 1 : 0;
    await this.callBatchExecute(
      NB_RPC.SHARE_NOTEBOOK,
      [[[notebookId, null, [access], [access, '']]], 1, null, [...PLATFORM_WEB]],
      `/notebook/${notebookId}`,
    );
  }

  async shareNotebookWithUser(
    notebookId: string,
    email: string,
    permission: 'editor' | 'viewer' = 'viewer',
    options?: { notify?: boolean; message?: string },
  ): Promise<void> {
    // Permission: 2=editor, 3=viewer
    const permCode = permission === 'editor' ? 2 : 3;
    const notify = options?.notify !== false ? 1 : 0;
    const msg = options?.message ?? '';
    const msgFlag = msg ? 0 : 1;
    await this.callBatchExecute(
      NB_RPC.SHARE_NOTEBOOK,
      [[[notebookId, [[email, null, permCode]], null, [msgFlag, msg]]], notify, null, [...PLATFORM_WEB]],
      `/notebook/${notebookId}`,
    );
  }

  // ── Settings ──

  async getOutputLanguage(): Promise<string | null> {
    const raw = await this.callBatchExecute(
      NB_RPC.GET_ACCOUNT_INFO,
      [null, [1, null, null, null, null, null, null, null, null, null, [1]]],
      '/',
    );
    const envelopes = parseEnvelopes(raw);
    const result = envelopes[0];
    // Path: result[0][2][4][0]
    if (!Array.isArray(result)) return null;
    const outer = Array.isArray(result[0]) ? result[0] as unknown[] : null;
    if (!outer) return null;
    const settings = Array.isArray(outer[2]) ? outer[2] as unknown[] : null;
    if (!settings) return null;
    const langArr = Array.isArray(settings[4]) ? settings[4] as unknown[] : null;
    return langArr && typeof langArr[0] === 'string' ? langArr[0] : null;
  }

  async setOutputLanguage(language: string): Promise<void> {
    await this.callBatchExecute(
      NB_RPC.SET_USER_SETTINGS,
      [[[null, [[null, null, null, null, [language]]]]]],
      '/',
    );
  }

  // ── Artifact extras ──

  async renameArtifact(artifactId: string, newTitle: string): Promise<void> {
    await this.callBatchExecute(NB_RPC.RENAME_ARTIFACT, [artifactId, newTitle]);
  }

  async getInteractiveHtml(artifactId: string): Promise<string> {
    const raw = await this.callBatchExecute(NB_RPC.GET_INTERACTIVE_HTML, [artifactId]);
    const envelopes = parseEnvelopes(raw);
    // Response may be: HTML string (ready), or artifact metadata array (still rendering).
    const first = envelopes[0];
    if (typeof first === 'string') return first;
    if (Array.isArray(first)) {
      // Check first-level and second-level for HTML string
      if (typeof first[0] === 'string') return first[0];
      // Artifact metadata array — HTML not ready yet; walk the tree for long strings that look like HTML
      const flat = Array.isArray(first[0]) ? first[0] as unknown[] : first;
      for (const el of flat) {
        if (typeof el === 'string' && el.length > 200 && el.includes('<')) return el;
      }
    }
    return '';
  }

  async generateArtifact(
    notebookId: string,
    _type: number,
    sourceIds: string[],
    options?: ArtifactGenerateOptions | LegacyArtifactOptions,
  ): Promise<{ artifactId: string; title: string }> {
    const sidsTriple = sourceIds.map((id) => [[id]]);
    const sidsDouble = sourceIds.map((id) => [id]);
    const sessionLang = this.transport!.getSession().language ?? 'en';

    let innerPayload: unknown[];

    if (options && 'type' in options) {
      // New discriminated union — inject session language as default
      const opts = { ...options } as ArtifactGenerateOptions & { language?: string };
      if (!opts.language) opts.language = sessionLang;
      innerPayload = buildArtifactPayload(sidsTriple, sidsDouble, opts);
    } else {
      // Legacy format — backward compat (audio only)
      const legacy = options as LegacyArtifactOptions | undefined;
      innerPayload = buildArtifactPayload(sidsTriple, sidsDouble, {
        type: 'audio',
        instructions: legacy?.customPrompt ?? undefined,
        language: legacy?.language ?? sessionLang,
      });
    }

    const raw = await this.callBatchExecute(
      NB_RPC.GENERATE_ARTIFACT,
      [[...DEFAULT_USER_CONFIG], notebookId, innerPayload],
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

  /**
   * Poll POLL_RESEARCH (e3bVqc) until research results are ready.
   * Status codes: 1=in_progress, 2=completed (fast), 6=completed (deep).
   */
  async pollResearchResults(notebookId: string, timeoutMs = 120_000): Promise<{ results: ResearchResult[]; report?: string }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const raw = await this.callBatchExecute(
        NB_RPC.POLL_RESEARCH,
        [null, null, notebookId],
        `/notebook/${notebookId}`,
      );
      const parsed = parseResearchResults(raw);
      if (parsed.status >= 2) {
        console.error(`NotebookLM: Research completed — ${parsed.results.length} sources${parsed.report ? ' + report' : ''}`);
        return { results: parsed.results, report: parsed.report };
      }
      await humanSleep(5000);
    }
    console.error('NotebookLM: Research poll timed out');
    return { results: [] };
  }

  /**
   * Import research results as sources into a notebook.
   * RPC: LBwxtb (IMPORT_RESEARCH)
   *
   * Source entry types:
   *   URL:    [null, null, [url, title], null, ..., 2]
   *   Report: [null, [title, markdown], null, 3, ..., 3]
   */
  async importResearch(
    notebookId: string,
    researchId: string,
    results: ResearchResult[],
    report?: string,
  ): Promise<void> {
    const sources: unknown[][] = [];

    // Add deep research report as a text source if present
    if (report) {
      const reportTitle = 'Deep Research Report';
      sources.push([null, [reportTitle, report], null, 3, null, null, null, null, null, null, 3]);
    }

    // Add URL sources
    for (const r of results) {
      sources.push([null, null, [r.url, r.title], null, null, null, null, null, null, null, 2]);
    }

    if (sources.length === 0) return;

    await this.callBatchExecute(
      NB_RPC.IMPORT_RESEARCH,
      [null, [1], researchId, notebookId, sources],
      `/notebook/${notebookId}`,
    );
    console.error(`NotebookLM: Imported ${sources.length} research sources`);
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
    const raw = await this.callBatchExecute(NB_RPC.GET_ACCOUNT_INFO, [[...DEFAULT_USER_CONFIG]], '/');
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

    const curlArgs = [
      '-sSL',
      '-o', filePath,
      '-b', cookieJarPath,
      '-c', cookieJarPath,
      '-H', `User-Agent: ${session.userAgent}`,
      '-H', 'Referer: https://notebooklm.google.com/',
      '--max-redirs', '20',
    ];
    if (this.proxy) {
      curlArgs.push('-x', this.proxy);
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
        // Got real media
        break;
      }

      // HTML response — CDN not ready yet or auth issue
      await unlink(filePath).catch(() => {});
      if (attempt < maxRetries) {
        const delay = attempt * 10_000; // 10s, 20s, 30s, ...
        console.error(`NotebookLM: CDN not ready (attempt ${attempt}/${maxRetries}), retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        await unlink(cookieJarPath).catch(() => {});
        throw new Error('Audio download returned HTML after retries — CDN may be unavailable or session expired. Re-run: npx notebooklm export-session');
      }
    }

    await unlink(cookieJarPath).catch(() => {});

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
      {
        type: 'audio',
        language: options.language,
        instructions: options.instructions ?? options.customPrompt,
        format: options.format,
        length: options.length,
      },
    );

    onProgress?.({ status: 'generating', message: 'Waiting for audio generation...' });
    const artifact = await this.pollArtifactReady(notebookId, artifactId, 1_800_000);

    onProgress?.({ status: 'downloading', message: 'Downloading audio...' });
    const audioPath = await this.downloadAudio(artifact.downloadUrl!, options.outputDir);

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
    const { artifactId } = await this.generateArtifact(notebookId, ARTIFACT_TYPE.QUIZ, sourceIds, {
      type: 'flashcards',
      instructions: options.instructions,
      quantity: options.quantity,
      difficulty: options.difficulty,
    });

    onProgress?.({ status: 'generating', message: 'Waiting for flashcards...' });
    await this.pollArtifactReady(notebookId, artifactId, 300_000);

    onProgress?.({ status: 'downloading', message: 'Saving flashcards...' });
    const htmlPath = await this.saveArtifactHtml(artifactId, options.outputDir, 'flashcards');

    onProgress?.({ status: 'completed', message: 'Flashcards generated!' });
    return { htmlPath, cards: [], notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
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

  async runReport(
    options: ReportOptions,
    onProgress?: (p: WorkflowProgress) => void,
  ): Promise<ReportResult> {
    this.ensureConnected();

    onProgress?.({ status: 'creating_notebook', message: 'Creating notebook...' });
    const { notebookId } = await this.createNotebook();

    onProgress?.({ status: 'adding_source', message: `Adding source (${options.source.type})...` });
    const sourceIds = await this.addSourceFromInput(notebookId, options.source);
    await this.pollSourcesReady(notebookId, 120_000);

    onProgress?.({ status: 'generating', message: 'Generating report...' });
    const { artifactId } = await this.generateArtifact(notebookId, ARTIFACT_TYPE.REPORT, sourceIds, {
      type: 'report',
      template: options.template,
      instructions: options.instructions,
      language: options.language,
    });

    onProgress?.({ status: 'generating', message: 'Waiting for report...' });
    await this.pollArtifactReady(notebookId, artifactId, 300_000);

    onProgress?.({ status: 'downloading', message: 'Saving report...' });
    const htmlPath = await this.saveArtifactHtml(artifactId, options.outputDir, 'report');

    onProgress?.({ status: 'completed', message: 'Report complete!' });
    return { htmlPath, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
  }

  async runVideo(
    options: VideoOptions,
    onProgress?: (p: WorkflowProgress) => void,
  ): Promise<VideoResult> {
    this.ensureConnected();

    onProgress?.({ status: 'creating_notebook', message: 'Creating notebook...' });
    const { notebookId } = await this.createNotebook();

    onProgress?.({ status: 'adding_source', message: `Adding source (${options.source.type})...` });
    const sourceIds = await this.addSourceFromInput(notebookId, options.source);
    await this.pollSourcesReady(notebookId, 120_000);

    onProgress?.({ status: 'generating', message: 'Generating video...' });
    const { artifactId } = await this.generateArtifact(notebookId, ARTIFACT_TYPE.VIDEO, sourceIds, {
      type: 'video',
      format: options.format,
      style: options.style,
      instructions: options.instructions,
      language: options.language,
    });

    onProgress?.({ status: 'generating', message: 'Waiting for video generation...' });
    const artifact = await this.pollArtifactReady(notebookId, artifactId, 1_800_000);
    const videoUrl = artifact.streamUrl ?? artifact.hlsUrl ?? artifact.downloadUrl ?? '';

    onProgress?.({ status: 'completed', message: 'Video complete!' });
    return { videoUrl, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
  }

  async runQuiz(
    options: QuizOptions,
    onProgress?: (p: WorkflowProgress) => void,
  ): Promise<QuizResult> {
    this.ensureConnected();

    onProgress?.({ status: 'creating_notebook', message: 'Creating notebook...' });
    const { notebookId } = await this.createNotebook();

    onProgress?.({ status: 'adding_source', message: `Adding source (${options.source.type})...` });
    const sourceIds = await this.addSourceFromInput(notebookId, options.source);
    await this.pollSourcesReady(notebookId, 120_000);

    onProgress?.({ status: 'generating', message: 'Generating quiz...' });
    const { artifactId } = await this.generateArtifact(notebookId, ARTIFACT_TYPE.QUIZ, sourceIds, {
      type: 'quiz',
      instructions: options.instructions,
      quantity: options.quantity,
      difficulty: options.difficulty,
    });

    onProgress?.({ status: 'generating', message: 'Waiting for quiz...' });
    await this.pollArtifactReady(notebookId, artifactId, 300_000);

    onProgress?.({ status: 'downloading', message: 'Saving quiz...' });
    const htmlPath = await this.saveArtifactHtml(artifactId, options.outputDir, 'quiz');

    onProgress?.({ status: 'completed', message: 'Quiz complete!' });
    return { htmlPath, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
  }

  async runInfographic(
    options: InfographicOptions,
    onProgress?: (p: WorkflowProgress) => void,
  ): Promise<InfographicResult> {
    this.ensureConnected();

    onProgress?.({ status: 'creating_notebook', message: 'Creating notebook...' });
    const { notebookId } = await this.createNotebook();

    onProgress?.({ status: 'adding_source', message: `Adding source (${options.source.type})...` });
    const sourceIds = await this.addSourceFromInput(notebookId, options.source);
    await this.pollSourcesReady(notebookId, 120_000);

    onProgress?.({ status: 'generating', message: 'Generating infographic...' });
    const { artifactId } = await this.generateArtifact(notebookId, ARTIFACT_TYPE.INFOGRAPHIC, sourceIds, {
      type: 'infographic',
      instructions: options.instructions,
      language: options.language,
      orientation: options.orientation,
      detail: options.detail,
      style: options.style,
    });

    onProgress?.({ status: 'generating', message: 'Waiting for infographic...' });
    await this.pollArtifactReady(notebookId, artifactId, 300_000);

    onProgress?.({ status: 'downloading', message: 'Saving infographic...' });
    const htmlPath = await this.saveArtifactHtml(artifactId, options.outputDir, 'infographic');

    onProgress?.({ status: 'completed', message: 'Infographic complete!' });
    return { htmlPath, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
  }

  async runSlideDeck(
    options: SlideDeckOptions,
    onProgress?: (p: WorkflowProgress) => void,
  ): Promise<SlideDeckResult> {
    this.ensureConnected();

    onProgress?.({ status: 'creating_notebook', message: 'Creating notebook...' });
    const { notebookId } = await this.createNotebook();

    onProgress?.({ status: 'adding_source', message: `Adding source (${options.source.type})...` });
    const sourceIds = await this.addSourceFromInput(notebookId, options.source);
    await this.pollSourcesReady(notebookId, 120_000);

    onProgress?.({ status: 'generating', message: 'Generating slide deck...' });
    const { artifactId } = await this.generateArtifact(notebookId, ARTIFACT_TYPE.SLIDE_DECK, sourceIds, {
      type: 'slide_deck',
      instructions: options.instructions,
      language: options.language,
      format: options.format,
      length: options.length,
    });

    onProgress?.({ status: 'generating', message: 'Waiting for slides...' });
    await this.pollArtifactReady(notebookId, artifactId, 300_000);

    onProgress?.({ status: 'downloading', message: 'Saving slides...' });
    const htmlPath = await this.saveArtifactHtml(artifactId, options.outputDir, 'slides');

    onProgress?.({ status: 'completed', message: 'Slide deck complete!' });
    return { htmlPath, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
  }

  async runDataTable(
    options: DataTableOptions,
    onProgress?: (p: WorkflowProgress) => void,
  ): Promise<DataTableResult> {
    this.ensureConnected();

    onProgress?.({ status: 'creating_notebook', message: 'Creating notebook...' });
    const { notebookId } = await this.createNotebook();

    onProgress?.({ status: 'adding_source', message: `Adding source (${options.source.type})...` });
    const sourceIds = await this.addSourceFromInput(notebookId, options.source);
    await this.pollSourcesReady(notebookId, 120_000);

    onProgress?.({ status: 'generating', message: 'Generating data table...' });
    const { artifactId } = await this.generateArtifact(notebookId, ARTIFACT_TYPE.DATA_TABLE, sourceIds, {
      type: 'data_table',
      instructions: options.instructions,
      language: options.language,
    });

    onProgress?.({ status: 'generating', message: 'Waiting for data table...' });
    await this.pollArtifactReady(notebookId, artifactId, 300_000);

    onProgress?.({ status: 'downloading', message: 'Saving data table...' });
    const htmlPath = await this.saveArtifactHtml(artifactId, options.outputDir, 'data_table');

    onProgress?.({ status: 'completed', message: 'Data table complete!' });
    return { htmlPath, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
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
      case 'file': {
        const { sourceId } = await this.addFileSource(notebookId, source.filePath!);
        return [sourceId];
      }
      case 'research': {
        const mode = source.researchMode ?? 'fast';
        // Research requires at least one source in the notebook as seed
        await this.addTextSource(notebookId, 'Research Topic', source.topic!);
        const { researchId } = await this.createWebSearch(notebookId, source.topic!, mode);

        // Both fast and deep use the same poll→import flow.
        // Status codes differ: fast=2, deep=6, but parseResearchResults normalizes both to 2.
        const timeoutMs = mode === 'deep' ? 1_200_000 : 120_000;
        const { results, report } = await this.pollResearchResults(notebookId, timeoutMs);

        if ((results.length > 0 || report) && researchId) {
          await this.importResearch(notebookId, researchId, results, report);
        }

        // Wait for all imported sources to be processed
        await this.pollSourcesReady(notebookId, 120_000);

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

  private async pollArtifactReady(notebookId: string, artifactId: string, timeoutMs: number): Promise<ArtifactInfo> {
    const start = Date.now();
    let pollCount = 0;

    while (Date.now() - start < timeoutMs) {
      const artifacts = await this.getArtifacts(notebookId);
      const artifact = artifacts.find((a) => a.id === artifactId);
      if (artifact) {
        // Audio/Video: need a media URL
        const isMedia = artifact.type === ARTIFACT_TYPE.AUDIO || artifact.type === ARTIFACT_TYPE.VIDEO;
        if (isMedia) {
          if (artifact.downloadUrl || artifact.streamUrl || artifact.hlsUrl) return artifact;
        } else {
          // HTML-based artifacts are ready as soon as they appear
          return artifact;
        }
      }

      pollCount++;
      const baseDelay = Math.min(5000 + pollCount * 2500, 30000);
      await humanSleep(baseDelay);
    }
    throw new Error('Artifact generation timed out');
  }

  private async saveArtifactHtml(artifactId: string, outputDir: string, prefix: string): Promise<string> {
    // Poll getInteractiveHtml — HTML may not be ready immediately after artifact creation
    let html = '';
    for (let attempt = 0; attempt < 12; attempt++) {
      html = await this.getInteractiveHtml(artifactId);
      if (html.length > 0) break;
      await humanSleep(5000 + attempt * 2500);
    }
    mkdirSync(outputDir, { recursive: true });
    const filePath = join(outputDir, `${prefix}_${Date.now()}.html`);
    writeFileSync(filePath, html, 'utf-8');
    return filePath;
  }

  private ensureConnected(): void {
    if (!this.transport) throw new SessionError('NotebookLM client not connected');
  }
}
