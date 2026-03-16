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
  // Options
  AudioOverviewOptions,
  MindMapOptions,
  FlashcardsOptions,
  AnalyzeOptions,
  ChatOptions,
  BrowserLaunchOptions,

  // Results
  AudioOverviewResult,
  MindMapResult,
  FlashcardsResult,
  AnalyzeResult,
  ChatResult,

  // Data
  NotebookInfo,
  SourceInfo,
  ArtifactInfo,
  StudioConfig,
  StudioAudioType,
  StudioDocType,
  QuotaInfo,
  NotebookSession,
  NotebookRpcSession,
  WorkflowProgress,
  SourceInput,

  // Enums
  SourceType,
  ResearchMode,
  AudioLanguage,
  AudioFormat,
  WorkflowStatus,
} from './types.js';

export { SessionError, BrowserError } from './errors.js';
export { parseEnvelopes, stripSafetyPrefix } from './boq-parser.js';
