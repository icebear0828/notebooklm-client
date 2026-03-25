/**
 * Type definitions for NotebookLM standalone client.
 */

// ── Enums ──

export type SourceType = 'url' | 'text' | 'research' | 'file';
export type ResearchMode = 'fast' | 'deep';
export type AudioLanguage = 'en' | 'zh' | 'ja' | 'ko' | 'es' | 'fr' | 'de' | 'pt' | 'it' | 'hi';
export type AudioFormat = 'conversation' | 'lecture' | 'briefing';
export type StudioFeature = 'audio_overview' | 'mind_map' | 'flashcards';

export type WorkflowStatus =
  | 'pending'
  | 'creating_notebook'
  | 'adding_source'
  | 'navigating_studio'
  | 'configuring'
  | 'generating'
  | 'downloading'
  | 'completed'
  | 'failed';

// ── Session ──

export interface NotebookSession {
  loggedIn: boolean;
  userAgent: string;
  notebookUrl?: string;
}

// ── Source Input ──

export interface SourceInput {
  type: SourceType;
  url?: string;
  text?: string;
  topic?: string;
  filePath?: string;
  researchMode?: ResearchMode;
}

// ── Options ──

export interface AudioOverviewOptions {
  source: SourceInput;
  language?: AudioLanguage;
  customPrompt?: string;
  outputDir: string;
}

export interface MindMapOptions {
  source: SourceInput;
  outputDir: string;
}

export interface FlashcardsOptions {
  source: SourceInput;
}

export interface AnalyzeOptions {
  source: SourceInput;
  question: string;
}

export interface ChatOptions {
  message: string;
}

// ── Results ──

export interface AudioOverviewResult {
  audioPath: string;
  notebookUrl: string;
}

export interface MindMapResult {
  imagePath: string;
  notebookUrl: string;
}

export interface FlashcardsResult {
  cards: Array<{ front: string; back: string }>;
  notebookUrl: string;
}

export interface AnalyzeResult {
  answer: string;
  notebookUrl: string;
}

export interface ChatResult {
  response: string;
}

// ── Workflow Progress ──

export interface WorkflowProgress {
  status: WorkflowStatus;
  message: string;
}

// ── RPC Session ──

export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
}

export interface NotebookRpcSession {
  at: string;
  bl: string;
  fsid: string;
  /** Flat cookie string for API calls (all cookies joined). */
  cookies: string;
  /** Cookies with domain info for cross-domain downloads. */
  cookieJar?: SessionCookie[];
  userAgent: string;
  /** Browser language (e.g. 'en', 'zh-CN'). Extracted from navigator.language. */
  language?: string;
}

// ── Data Models ──

export interface NotebookInfo {
  id: string;
  title: string;
  sourceCount?: number;
  createdAt?: [number, number];
  updatedAt?: [number, number];
}

export interface SourceInfo {
  id: string;
  title: string;
  wordCount?: number;
  statusCode?: number;
  url?: string;
  createdAt?: [number, number];
}

export interface ArtifactInfo {
  id: string;
  title: string;
  type: number;
  downloadUrl?: string;
  streamUrl?: string;
  hlsUrl?: string;
  dashUrl?: string;
  durationSeconds?: number;
  durationNanos?: number;
  sourceIds?: string[];
}

// ── Research ──

export interface ResearchResult {
  url: string;
  title: string;
  description: string;
}

// ── Studio Config ──

export interface StudioAudioType {
  id: number;
  name: string;
  description: string;
}

export interface StudioDocType {
  name: string;
  description: string;
}

export interface StudioConfig {
  audioTypes: StudioAudioType[];
  explainerTypes: StudioAudioType[];
  slideTypes: StudioAudioType[];
  docTypes: StudioDocType[];
}

export interface AccountInfo {
  /** Account plan type (1=free, 6=plus, etc.) */
  planType: number;
  /** Maximum notebooks allowed */
  notebookLimit: number;
  /** Maximum sources per notebook */
  sourceLimit: number;
  /** Maximum words per source */
  sourceWordLimit: number;
  /** Whether the account has Plus features */
  isPlus: boolean;
}

/** @deprecated Use AccountInfo instead */
export type QuotaInfo = AccountInfo;

export interface NotebookChatChunk {
  text: string;
  thinking?: string;
  done: boolean;
  threadId?: string;
  responseId?: string;
}

// ── Browser Launch Options ──

export interface BrowserLaunchOptions {
  profileDir?: string;
  executablePath?: string;
  headless?: boolean;
  args?: string[];
  timeout?: number;
  protocolTimeout?: number;
  /** Proxy URL (http, socks5, socks5h). */
  proxy?: string;
}
