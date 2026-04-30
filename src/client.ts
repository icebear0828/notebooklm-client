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

import { type Page } from 'puppeteer-core';
import { SessionError, UserDisplayableError } from './errors.js';
import { jitteredIncrement } from './utils/humanize.js';
import { NB_URLS } from './rpc-ids.js';
import { loadNbRpcIds } from './rpc-config.js';
import { BrowserTransport } from './transport-browser.js';
import { detectBestTier, createTransport, TIER_LABELS } from './transport-resolver.js';
import type { TransportTier } from './transport-resolver.js';
import { saveSession, loadSession, refreshTokens } from './session-store.js';
import type { Transport } from './transport.js';
import { downloadFileHttp, downloadAudioBrowser } from './download.js';
import * as api from './api.js';
import {
  runAudioOverview as _runAudioOverview,
  runMindMap as _runMindMap,
  runFlashcards as _runFlashcards,
  runAnalyze as _runAnalyze,
  runReport as _runReport,
  runVideo as _runVideo,
  runQuiz as _runQuiz,
  runInfographic as _runInfographic,
  runSlideDeck as _runSlideDeck,
  runDataTable as _runDataTable,
} from './workflows.js';
import type {
  NotebookSession,
  NotebookRpcSession,
  NotebookInfo,
  StudioConfig,
  AccountInfo,
  QuotaInfo,
  SourceInfo,
  ArtifactInfo,
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
  ChatWithCitationsResult,
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
  /** Notebook the current chat state belongs to. State resets when this changes. */
  private chatNotebookId = '';
  /** ID of the chat thread used by the web UI for this notebook (from CCqFvf or hPTbtc). */
  private chatThreadId = '';
  /**
   * Per-thread chat history mirrored back to the server in newest-first order
   * (matches what the web UI sends): each completed turn prepends `[assistant, user]`.
   */
  private chatHistory: Array<[string, null, number]> = [];
  /** Number of completed turns on the current thread (1-indexed turn counter sent in chat payload). */
  private chatTurnCounter = 0;

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

    let tier: TransportTier;
    if (this.transportMode === 'auto') {
      tier = await detectBestTier({ curlBinaryPath: config.curlBinaryPath });
    } else {
      tier = this.transportMode as TransportTier;
    }

    this.transport = await createTransport(tier, {
      session,
      curlBinaryPath: config.curlBinaryPath,
      tlsClientProfile: config.tlsClientProfile,
      proxy: config.proxy,
      onSessionExpired,
    });

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

  getActivePage(): Page | null {
    if (this.transport instanceof BrowserTransport) {
      return this.transport.getPage();
    }
    return null;
  }

  getTransportMode(): TransportMode {
    return this.transportMode;
  }

  getProxy(): string | undefined {
    return this.proxy;
  }

  ensureConnected(): void {
    if (!this.transport) throw new SessionError('NotebookLM client not connected');
  }

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

  async callChatStream(notebookId: string, message: string, sourceIds: string[]): Promise<string> {
    if (!this.transport) throw new SessionError('Not connected');

    const sourceIdArrays = sourceIds.map((id) => [[id]]);
    const { at, bl, fsid } = this.transport.getSession();
    const reqId = this.nextReqId();

    // The web UI sends `null` for the first request on a fresh session and an
    // accumulating array thereafter. Sending `[]` instead of `null` for the
    // first turn causes the server to accept the message but not write it to
    // the notebook's visible chat thread on follow-ups.
    const history = this.chatHistory.length > 0 ? this.chatHistory : null;

    const innerPayload = [
      sourceIdArrays,
      message,
      history,
      [2, null, [1], [1]],
      this.chatThreadId || null,
      null,
      null,
      notebookId,
      this.chatTurnCounter + 1,
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

  // ── Bound RPC caller for api.ts functions ──

  private readonly rpc = this.callBatchExecute.bind(this);

  // ── Low-level API (delegated to api.ts) ──

  async createNotebook(): Promise<{ notebookId: string; threadId: string }> {
    const result = await api.createNotebook(this.rpc);
    this.activeNotebookId = result.notebookId;
    if (result.threadId) {
      this.bindChatThread(result.notebookId, result.threadId);
    }
    return result;
  }

  /**
   * Lists chat thread IDs bound to a notebook. The first entry is the default
   * thread the web UI uses, so `sendChat`/`sendChatWithCitations` resolve it
   * automatically — call this only when you need to enumerate threads or seed
   * a custom one.
   */
  async listChatThreads(notebookId: string): Promise<string[]> {
    return api.listChatThreads(this.rpc, notebookId);
  }

  async listNotebooks(): Promise<NotebookInfo[]> {
    return api.listNotebooks(this.rpc);
  }

  async getNotebookDetail(notebookId: string): Promise<{ title: string; sources: SourceInfo[] }> {
    return api.getNotebookDetail(this.rpc, notebookId);
  }

  async deleteNotebook(notebookId: string): Promise<void> {
    return api.deleteNotebook(this.rpc, notebookId);
  }

  async renameNotebook(notebookId: string, newTitle: string): Promise<void> {
    return api.renameNotebook(this.rpc, notebookId, newTitle);
  }

  async addUrlSource(notebookId: string, url: string): Promise<{ sourceId: string; title: string }> {
    return api.addUrlSource(this.rpc, notebookId, url);
  }

  async addTextSource(notebookId: string, title: string, content: string): Promise<{ sourceId: string; title: string }> {
    return api.addTextSource(this.rpc, notebookId, title, content);
  }

  async addFileSource(notebookId: string, filePath: string): Promise<{ sourceId: string; title: string }> {
    this.ensureConnected();
    const session = this.transport!.getSession();
    return api.addFileSource(this.rpc, { session, proxy: this.proxy }, notebookId, filePath);
  }

  async deleteSource(sourceId: string): Promise<void> {
    return api.deleteSource(this.rpc, sourceId);
  }

  async getSourceSummary(sourceId: string): Promise<{ summary: string }> {
    return api.getSourceSummary(this.rpc, sourceId);
  }

  async renameSource(notebookId: string, sourceId: string, newTitle: string): Promise<void> {
    return api.renameSource(this.rpc, notebookId, sourceId, newTitle);
  }

  async refreshSource(notebookId: string, sourceId: string): Promise<void> {
    return api.refreshSource(this.rpc, notebookId, sourceId);
  }

  async listNotes(notebookId: string): Promise<Array<{ id: string; title: string; content: string }>> {
    return api.listNotes(this.rpc, notebookId);
  }

  async createNote(notebookId: string, title = 'New Note', content = ''): Promise<{ noteId: string }> {
    return api.createNote(this.rpc, notebookId, title, content);
  }

  async updateNote(notebookId: string, noteId: string, content: string, title: string): Promise<void> {
    return api.updateNote(this.rpc, notebookId, noteId, content, title);
  }

  async deleteNote(notebookId: string, noteId: string): Promise<void> {
    return api.deleteNote(this.rpc, notebookId, noteId);
  }

  async getShareStatus(notebookId: string): Promise<unknown> {
    return api.getShareStatus(this.rpc, notebookId);
  }

  async shareNotebook(notebookId: string, isPublic: boolean): Promise<void> {
    return api.shareNotebook(this.rpc, notebookId, isPublic);
  }

  async shareNotebookWithUser(
    notebookId: string,
    email: string,
    permission: 'editor' | 'viewer' = 'viewer',
    options?: { notify?: boolean; message?: string },
  ): Promise<void> {
    return api.shareNotebookWithUser(this.rpc, notebookId, email, permission, options);
  }

  async getOutputLanguage(): Promise<string | null> {
    return api.getOutputLanguage(this.rpc);
  }

  async setOutputLanguage(language: string): Promise<void> {
    return api.setOutputLanguage(this.rpc, language);
  }

  async renameArtifact(artifactId: string, newTitle: string): Promise<void> {
    return api.renameArtifact(this.rpc, artifactId, newTitle);
  }

  async getInteractiveHtml(artifactId: string): Promise<string> {
    return api.getInteractiveHtml(this.rpc, artifactId);
  }

  async generateArtifact(
    notebookId: string,
    sourceIds: string[],
    options?: ArtifactGenerateOptions | LegacyArtifactOptions,
  ): Promise<{ artifactId: string; title: string }> {
    const sessionLang = this.transport!.getSession().language ?? 'en';
    return api.generateArtifact(this.rpc, notebookId, sourceIds, sessionLang, options);
  }

  async getArtifacts(notebookId: string): Promise<ArtifactInfo[]> {
    return api.getArtifacts(this.rpc, notebookId);
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    return api.deleteArtifact(this.rpc, artifactId);
  }

  async createWebSearch(notebookId: string, query: string, mode: 'fast' | 'deep' = 'fast'): Promise<{ researchId: string; artifactId?: string }> {
    return api.createWebSearch(this.rpc, notebookId, query, mode);
  }

  async pollResearchResults(notebookId: string, timeoutMs = 120_000): Promise<{ results: ResearchResult[]; report?: string }> {
    return api.pollResearchResults(this.rpc, notebookId, timeoutMs);
  }

  async importResearch(
    notebookId: string,
    researchId: string,
    results: ResearchResult[],
    report?: string,
  ): Promise<void> {
    return api.importResearch(this.rpc, notebookId, researchId, results, report);
  }

  async getStudioConfig(notebookId: string): Promise<StudioConfig> {
    return api.getStudioConfig(this.rpc, notebookId);
  }

  async getAccountInfo(): Promise<AccountInfo> {
    return api.getAccountInfo(this.rpc);
  }

  /** @deprecated Use getAccountInfo() instead */
  async getQuota(): Promise<QuotaInfo> {
    return this.getAccountInfo();
  }

  async downloadAudio(downloadUrl: string, outputDir: string): Promise<string> {
    const page = this.getActivePage();
    if (page) {
      return downloadAudioBrowser(page, downloadUrl, outputDir);
    }
    const session = this.transport!.getSession();
    return downloadFileHttp({ session, proxy: this.proxy }, downloadUrl, outputDir, `audio_${Date.now()}.mp4`);
  }

  async sendChat(notebookId: string, message: string, sourceIds: string[]): Promise<{ text: string; threadId: string }> {
    await this.ensureChatThread(notebookId);
    const result = await api.sendChat(
      this.callChatStream.bind(this),
      notebookId, message, sourceIds,
    );
    this.recordChatTurn(notebookId, message, result.text, result.threadId);
    return result;
  }

  async sendChatWithCitations(notebookId: string, message: string, sourceIds: string[]): Promise<ChatWithCitationsResult> {
    await this.ensureChatThread(notebookId);
    const result = await api.sendChatWithCitations(
      this.callChatStream.bind(this),
      notebookId, message, sourceIds,
    );
    this.recordChatTurn(notebookId, message, result.text, result.threadId);
    return result;
  }

  /**
   * Binds local chat state to `notebookId`/`threadId` (called after createNotebook
   * and at the start of `ensureChatThread`). Resets accumulated history and turn
   * counter whenever the (notebookId, threadId) pair changes — the web UI's
   * follow-up payload format requires history to start empty for a fresh thread.
   */
  private bindChatThread(notebookId: string, threadId: string): void {
    if (this.chatNotebookId === notebookId && this.chatThreadId === threadId) return;
    this.chatNotebookId = notebookId;
    this.chatThreadId = threadId;
    this.chatHistory = [];
    this.chatTurnCounter = 0;
  }

  /**
   * Resolves the notebook's default chat thread before sending a message.
   * - If we already have a thread for this notebook, no-op.
   * - Otherwise, fetch via `hPTbtc`. NotebookLM auto-allocates one default
   *   thread per notebook on creation, so this should always succeed.
   * - Empty result means the notebook is in an unusual state (no allocated
   *   thread); we leave `chatThreadId` empty and let the chat call create one
   *   server-side as a best-effort fallback (only the first message will be
   *   visible in UI, follow-ups won't persist — matches pre-fix behavior).
   */
  private async ensureChatThread(notebookId: string): Promise<void> {
    if (this.chatNotebookId !== notebookId) {
      this.chatNotebookId = notebookId;
      this.chatThreadId = '';
      this.chatHistory = [];
      this.chatTurnCounter = 0;
    }
    if (this.chatThreadId) return;
    const threads = await api.listChatThreads(this.rpc, notebookId);
    if (threads.length > 0 && threads[0]) {
      this.chatThreadId = threads[0];
    }
  }

  private recordChatTurn(
    notebookId: string,
    message: string,
    replyText: string,
    replyThreadId: string,
  ): void {
    // Adopt the thread the server actually wrote to in case ensureChatThread
    // came up empty and the server allocated one for us.
    if (replyThreadId && !this.chatThreadId) {
      this.bindChatThread(notebookId, replyThreadId);
    }
    // Newest-first, with the assistant reply preceding the user prompt within
    // each turn — this is the layout the web UI sends back on follow-ups.
    this.chatHistory.unshift([message, null, 1]);
    if (replyText) this.chatHistory.unshift([replyText, null, 2]);
    this.chatTurnCounter += 1;
  }

  async deleteChatThread(threadId: string): Promise<void> {
    return api.deleteChatThread(this.rpc, threadId);
  }

  async chat(options: ChatOptions): Promise<ChatResult> {
    this.ensureConnected();
    if (!this.activeNotebookId) throw new Error('No active notebook. Create or open one first.');
    const detail = await this.getNotebookDetail(this.activeNotebookId);
    const sourceIds = detail.sources.map((s) => s.id);
    const { text } = await this.sendChat(this.activeNotebookId, options.message, sourceIds);
    return { response: text };
  }

  // ── High-level Workflow Methods (delegated to workflows.ts) ──

  async runAudioOverview(options: AudioOverviewOptions, onProgress?: (p: WorkflowProgress) => void): Promise<AudioOverviewResult> {
    return _runAudioOverview(this, options, onProgress);
  }

  async runMindMap(options: MindMapOptions, onProgress?: (p: WorkflowProgress) => void): Promise<MindMapResult> {
    return _runMindMap(this, options, onProgress);
  }

  async runFlashcards(options: FlashcardsOptions, onProgress?: (p: WorkflowProgress) => void): Promise<FlashcardsResult> {
    return _runFlashcards(this, options, onProgress);
  }

  async runAnalyze(options: AnalyzeOptions, onProgress?: (p: WorkflowProgress) => void): Promise<AnalyzeResult> {
    return _runAnalyze(this, options, onProgress);
  }

  async runReport(options: ReportOptions, onProgress?: (p: WorkflowProgress) => void): Promise<ReportResult> {
    return _runReport(this, options, onProgress);
  }

  async runVideo(options: VideoOptions, onProgress?: (p: WorkflowProgress) => void): Promise<VideoResult> {
    return _runVideo(this, options, onProgress);
  }

  async runQuiz(options: QuizOptions, onProgress?: (p: WorkflowProgress) => void): Promise<QuizResult> {
    return _runQuiz(this, options, onProgress);
  }

  async runInfographic(options: InfographicOptions, onProgress?: (p: WorkflowProgress) => void): Promise<InfographicResult> {
    return _runInfographic(this, options, onProgress);
  }

  async runSlideDeck(options: SlideDeckOptions, onProgress?: (p: WorkflowProgress) => void): Promise<SlideDeckResult> {
    return _runSlideDeck(this, options, onProgress);
  }

  async runDataTable(options: DataTableOptions, onProgress?: (p: WorkflowProgress) => void): Promise<DataTableResult> {
    return _runDataTable(this, options, onProgress);
  }
}
