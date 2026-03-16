/**
 * Type definitions for NotebookLM standalone client.
 */

// ── Enums ──

export type SourceType = 'url' | 'text' | 'research';
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

export interface NotebookRpcSession {
  at: string;
  bl: string;
  fsid: string;
  cookies: string;
  userAgent: string;
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
}
