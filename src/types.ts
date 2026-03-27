/**
 * Type definitions for NotebookLM standalone client.
 */

// ── Enums ──

export type SourceType = 'url' | 'text' | 'research' | 'file';
export type ResearchMode = 'fast' | 'deep';
export type AudioLanguage = 'en' | 'zh' | 'ja' | 'ko' | 'es' | 'fr' | 'de' | 'pt' | 'it' | 'hi';
export type AudioFormat = 'conversation' | 'lecture' | 'briefing';
export type StudioFeature = 'audio_overview' | 'mind_map' | 'flashcards';

// ── Artifact Generation Enums ──

export type AudioStyleFormat = 'deep_dive' | 'brief' | 'critique' | 'debate';
export type AudioLength = 'short' | 'default' | 'long';

export type VideoFormat = 'explainer' | 'brief' | 'cinematic';
export type VideoStyle = 'auto' | 'classic' | 'whiteboard' | 'kawaii' | 'anime' | 'watercolor' | 'retro_print';

export type ReportTemplate = 'briefing_doc' | 'study_guide' | 'blog_post' | 'custom';

export type QuizQuantity = 'fewer' | 'standard';
export type QuizDifficulty = 'easy' | 'medium' | 'hard';

export type InfographicOrientation = 'landscape' | 'portrait' | 'square';
export type InfographicDetail = 'concise' | 'standard' | 'detailed';
export type InfographicStyle = 'sketch_note' | 'professional' | 'bento_grid';

export type SlideDeckFormat = 'detailed' | 'presenter';
export type SlideDeckLength = 'default' | 'short';

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

// ── Artifact Generate Options (discriminated union) ──

export interface AudioArtifactOptions {
  type: 'audio';
  instructions?: string;
  language?: string;
  format?: AudioStyleFormat;
  length?: AudioLength;
}

export interface ReportArtifactOptions {
  type: 'report';
  template?: ReportTemplate;
  instructions?: string;
  language?: string;
}

export interface VideoArtifactOptions {
  type: 'video';
  instructions?: string;
  language?: string;
  format?: VideoFormat;
  style?: VideoStyle;
}

export interface QuizArtifactOptions {
  type: 'quiz';
  instructions?: string;
  quantity?: QuizQuantity;
  difficulty?: QuizDifficulty;
}

export interface FlashcardsArtifactOptions {
  type: 'flashcards';
  instructions?: string;
  quantity?: QuizQuantity;
  difficulty?: QuizDifficulty;
}

export interface InfographicArtifactOptions {
  type: 'infographic';
  instructions?: string;
  language?: string;
  orientation?: InfographicOrientation;
  detail?: InfographicDetail;
  style?: InfographicStyle;
}

export interface SlideDeckArtifactOptions {
  type: 'slide_deck';
  instructions?: string;
  language?: string;
  format?: SlideDeckFormat;
  length?: SlideDeckLength;
}

export interface DataTableArtifactOptions {
  type: 'data_table';
  instructions?: string;
  language?: string;
}

export type ArtifactGenerateOptions =
  | AudioArtifactOptions
  | ReportArtifactOptions
  | VideoArtifactOptions
  | QuizArtifactOptions
  | FlashcardsArtifactOptions
  | InfographicArtifactOptions
  | SlideDeckArtifactOptions
  | DataTableArtifactOptions;

/** Legacy options for generateArtifact (backward compat with audio-only callers). */
export interface LegacyArtifactOptions {
  language?: string;
  customPrompt?: string;
}

// ── Workflow Options ──

export interface AudioOverviewOptions {
  source: SourceInput;
  language?: AudioLanguage;
  /** @deprecated Use instructions instead */
  customPrompt?: string;
  instructions?: string;
  format?: AudioStyleFormat;
  length?: AudioLength;
  outputDir: string;
}

export interface MindMapOptions {
  source: SourceInput;
  outputDir: string;
}

export interface FlashcardsOptions {
  source: SourceInput;
  outputDir: string;
  instructions?: string;
  quantity?: QuizQuantity;
  difficulty?: QuizDifficulty;
}

export interface ReportOptions {
  source: SourceInput;
  outputDir: string;
  template?: ReportTemplate;
  instructions?: string;
  language?: string;
}

export interface VideoOptions {
  source: SourceInput;
  outputDir: string;
  format?: VideoFormat;
  style?: VideoStyle;
  instructions?: string;
  language?: string;
}

export interface QuizOptions {
  source: SourceInput;
  outputDir: string;
  instructions?: string;
  quantity?: QuizQuantity;
  difficulty?: QuizDifficulty;
}

export interface InfographicOptions {
  source: SourceInput;
  outputDir: string;
  instructions?: string;
  language?: string;
  orientation?: InfographicOrientation;
  detail?: InfographicDetail;
  style?: InfographicStyle;
}

export interface SlideDeckOptions {
  source: SourceInput;
  outputDir: string;
  instructions?: string;
  language?: string;
  format?: SlideDeckFormat;
  length?: SlideDeckLength;
}

export interface DataTableOptions {
  source: SourceInput;
  outputDir: string;
  instructions?: string;
  language?: string;
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
  htmlPath: string;
  cards: Array<{ front: string; back: string }>;
  notebookUrl: string;
}

export interface ReportResult {
  htmlPath: string;
  notebookUrl: string;
}

export interface VideoResult {
  videoUrl: string;
  notebookUrl: string;
}

export interface QuizResult {
  htmlPath: string;
  notebookUrl: string;
}

export interface InfographicResult {
  htmlPath: string;
  notebookUrl: string;
}

export interface SlideDeckResult {
  htmlPath: string;
  notebookUrl: string;
}

export interface DataTableResult {
  htmlPath: string;
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
