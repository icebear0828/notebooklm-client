/**
 * notebooklm-client — Standalone NotebookLM API client.
 *
 * @example
 * ```ts
 * import { NotebookClient } from 'notebooklm-client';
 *
 * // Browser mode (default — launches Chrome)
 * const client = new NotebookClient();
 * await client.connect();
 *
 * // HTTP mode (no browser — uses exported session + Chrome-like TLS)
 * const client2 = new NotebookClient();
 * await client2.connect({ transport: 'http' });
 * ```
 */

export { NotebookClient } from './client.js';
export type { TransportMode, ConnectOptions } from './client.js';

// Transport layer
export type { Transport, TransportRequest } from './transport.js';
export { BrowserTransport } from './transport-browser.js';
export { HttpTransport } from './transport-http.js';
export type { HttpTransportOptions } from './transport-http.js';
export { CurlTransport } from './transport-curl.js';
export type { CurlTransportOptions } from './transport-curl.js';
export { TlsClientTransport } from './transport-tlsclient.js';
export type { TlsClientTransportOptions } from './transport-tlsclient.js';
export { detectBestTier, createTransport, TIER_LABELS } from './transport-resolver.js';
export type { TransportTier, TransportFactoryOptions } from './transport-resolver.js';

// Paths (multi-account support)
export { getHomeDir, setHomeDir, getSessionPath, getProfileDir, getRpcIdsPath } from './paths.js';

// Session persistence
export { saveSession, loadSession, hasValidSession, refreshTokens } from './session-store.js';

// TLS config
export { CHROME_CIPHERS, CHROME_SIGALGS, chromeTlsOptions } from './tls-config.js';

export type {
  // Workflow Options
  AudioOverviewOptions,
  MindMapOptions,
  FlashcardsOptions,
  ReportOptions,
  VideoOptions,
  QuizOptions,
  InfographicOptions,
  SlideDeckOptions,
  DataTableOptions,
  AnalyzeOptions,
  ChatOptions,
  BrowserLaunchOptions,

  // Workflow Results
  AudioOverviewResult,
  MindMapResult,
  FlashcardsResult,
  ReportResult,
  VideoResult,
  QuizResult,
  InfographicResult,
  SlideDeckResult,
  DataTableResult,
  AnalyzeResult,
  ChatResult,

  // Artifact Generation (low-level)
  ArtifactGenerateOptions,
  LegacyArtifactOptions,
  AudioArtifactOptions,
  ReportArtifactOptions,
  VideoArtifactOptions,
  QuizArtifactOptions,
  FlashcardsArtifactOptions,
  InfographicArtifactOptions,
  SlideDeckArtifactOptions,
  DataTableArtifactOptions,

  // Data
  NotebookInfo,
  SourceInfo,
  ArtifactInfo,
  StudioConfig,
  StudioAudioType,
  StudioDocType,
  AccountInfo,
  QuotaInfo,
  NotebookSession,
  NotebookRpcSession,
  WorkflowProgress,
  SourceInput,

  // Research
  ResearchResult,

  // Enums
  SourceType,
  ResearchMode,
  AudioLanguage,
  AudioFormat,
  AudioStyleFormat,
  AudioLength,
  VideoFormat,
  VideoStyle,
  ReportTemplate,
  QuizQuantity,
  QuizDifficulty,
  InfographicOrientation,
  InfographicDetail,
  InfographicStyle,
  SlideDeckFormat,
  SlideDeckLength,
  WorkflowStatus,
} from './types.js';

export { REPORT_TEMPLATES } from './artifact-payloads.js';

export { SessionError, BrowserError, UserDisplayableError } from './errors.js';
export { parseEnvelopes, stripSafetyPrefix } from './boq-parser.js';
export { ARTIFACT_TYPE } from './rpc-ids.js';
