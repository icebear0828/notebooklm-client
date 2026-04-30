/**
 * Low-level API operations — stateless functions extracted from NotebookClient.
 *
 * Every function takes a `RpcCaller` (matching callBatchExecute signature)
 * so there is no circular dependency on the client class.
 */

import { statSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
// SessionError used by addFileSource callers — not directly here
import { parseEnvelopes } from './boq-parser.js';
import { NB_RPC, NB_URLS, DEFAULT_USER_CONFIG, PLATFORM_WEB } from './rpc-ids.js';
import { buildArtifactPayload } from './artifact-payloads.js';
import {
  parseCreateNotebook,
  parseListNotebooks,
  parseListChatThreads,
  parseNotebookDetail,
  parseAddSource,
  parseGenerateArtifact,
  parseArtifacts,
  parseChatStream,
  parseChatWithCitations,
  parseSourceSummary,
  parseStudioConfig,
  parseQuota,
  parseResearchResults,
} from './parser.js';
import type { RpcCaller } from './download.js';
import type {
  NotebookRpcSession,
  NotebookInfo,
  StudioConfig,
  AccountInfo,
  SourceInfo,
  ArtifactInfo,
  ResearchResult,
  ArtifactGenerateOptions,
  LegacyArtifactOptions,
  ChatWithCitationsResult,
} from './types.js';

// Re-export for convenience
export type { RpcCaller } from './download.js';

// ── Notebooks ──

export async function createNotebook(
  callRpc: RpcCaller,
): Promise<{ notebookId: string; threadId: string }> {
  const raw = await callRpc(
    NB_RPC.CREATE_NOTEBOOK,
    ['', null, null, [...PLATFORM_WEB], [1, null, null, null, null, null, null, null, null, null, [1]]],
    '/',
  );
  return parseCreateNotebook(raw);
}

/**
 * List chat thread IDs bound to a notebook. NotebookLM auto-allocates one
 * default thread per notebook on creation; the web UI uses that thread for
 * every chat in the notebook so messages persist in the chat panel.
 */
export async function listChatThreads(
  callRpc: RpcCaller,
  notebookId: string,
): Promise<string[]> {
  const raw = await callRpc(
    NB_RPC.LIST_CHAT_THREADS,
    [[], null, notebookId, 20],
    `/notebook/${notebookId}`,
  );
  return parseListChatThreads(raw);
}

export async function listNotebooks(callRpc: RpcCaller): Promise<NotebookInfo[]> {
  const raw = await callRpc(NB_RPC.LIST_NOTEBOOKS, [null, 1, null, [...PLATFORM_WEB]], '/');
  return parseListNotebooks(raw);
}

export async function getNotebookDetail(
  callRpc: RpcCaller,
  notebookId: string,
): Promise<{ title: string; sources: SourceInfo[] }> {
  const raw = await callRpc(
    NB_RPC.GET_NOTEBOOK,
    [notebookId, null, [...PLATFORM_WEB], null, 1],
    `/notebook/${notebookId}`,
  );
  return parseNotebookDetail(raw);
}

export async function deleteNotebook(callRpc: RpcCaller, notebookId: string): Promise<void> {
  await callRpc(NB_RPC.DELETE_NOTEBOOK, [[notebookId], [...PLATFORM_WEB]], '/');
}

export async function renameNotebook(
  callRpc: RpcCaller,
  notebookId: string,
  newTitle: string,
): Promise<void> {
  await callRpc(
    NB_RPC.RENAME_NOTEBOOK,
    [notebookId, [[null, null, null, [null, newTitle]]]],
    '/',
  );
}

// ── Sources ──

export async function addUrlSource(
  callRpc: RpcCaller,
  notebookId: string,
  url: string,
): Promise<{ sourceId: string; title: string }> {
  const raw = await callRpc(
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

export async function addTextSource(
  callRpc: RpcCaller,
  notebookId: string,
  title: string,
  content: string,
): Promise<{ sourceId: string; title: string }> {
  const raw = await callRpc(
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

/** Dependencies for file upload (Scotty protocol). */
export interface FileUploadDeps {
  session: NotebookRpcSession;
  proxy?: string;
}

/**
 * Upload a local file as a source. Uses Google's Scotty resumable upload protocol.
 * Supported: pdf, txt, md, docx, csv, pptx, epub, mp3, wav, m4a, png, jpg, gif, etc.
 */
export async function addFileSource(
  callRpc: RpcCaller,
  deps: FileUploadDeps,
  notebookId: string,
  filePath: string,
): Promise<{ sourceId: string; title: string }> {
  const absPath = resolve(filePath);
  const stat = statSync(absPath);
  if (!stat.isFile()) throw new Error(`Not a file: ${absPath}`);
  const fileName = basename(absPath);
  const fileSize = stat.size;

  const raw = await callRpc(
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

  const fileBuffer = readFileSync(absPath);
  await scottyUpload(deps, notebookId, fileName, sourceId, fileSize, fileBuffer);

  return { sourceId, title: fileName };
}

/**
 * Execute Scotty resumable upload: initiate session → upload bytes.
 */
async function scottyUpload(
  deps: FileUploadDeps,
  notebookId: string,
  fileName: string,
  sourceId: string,
  fileSize: number,
  fileBuffer: Buffer,
): Promise<void> {
  const { request: undiciRequest, Agent, ProxyAgent } = await import('undici');
  const { CHROME_CIPHERS } = await import('./tls-config.js');
  const { session, proxy } = deps;

  const baseHeaders: Record<string, string> = {
    'Accept': '*/*',
    'Cookie': session.cookies,
    'Origin': 'https://notebooklm.google.com',
    'Referer': 'https://notebooklm.google.com/',
    'User-Agent': session.userAgent,
    'x-goog-authuser': '0',
  };

  let dispatcher: InstanceType<typeof Agent> | InstanceType<typeof ProxyAgent>;
  if (proxy) {
    dispatcher = new ProxyAgent({
      uri: proxy,
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

export async function deleteSource(callRpc: RpcCaller, sourceId: string): Promise<void> {
  await callRpc(NB_RPC.DELETE_SOURCE, [[[sourceId]], [...PLATFORM_WEB]]);
}

export async function getSourceSummary(
  callRpc: RpcCaller,
  sourceId: string,
): Promise<{ summary: string }> {
  const raw = await callRpc(NB_RPC.GET_SOURCE_SUMMARY, [[[[sourceId]]]]);
  return { summary: parseSourceSummary(raw).summary };
}

export async function renameSource(
  callRpc: RpcCaller,
  notebookId: string,
  sourceId: string,
  newTitle: string,
): Promise<void> {
  await callRpc(
    NB_RPC.UPDATE_SOURCE,
    [null, [sourceId], [[[newTitle]]]],
    `/notebook/${notebookId}`,
  );
}

export async function refreshSource(
  callRpc: RpcCaller,
  notebookId: string,
  sourceId: string,
): Promise<void> {
  await callRpc(
    NB_RPC.REFRESH_SOURCE,
    [null, [sourceId], [...PLATFORM_WEB]],
    `/notebook/${notebookId}`,
  );
}

// ── Notes ──

export async function listNotes(
  callRpc: RpcCaller,
  notebookId: string,
): Promise<Array<{ id: string; title: string; content: string }>> {
  const raw = await callRpc(NB_RPC.GET_NOTES, [notebookId], `/notebook/${notebookId}`);
  const envelopes = parseEnvelopes(raw);
  const first = envelopes[0];
  if (!Array.isArray(first) || !Array.isArray(first[0])) return [];

  const notes: Array<{ id: string; title: string; content: string }> = [];
  for (const item of first[0]) {
    if (!Array.isArray(item) || typeof item[0] !== 'string') continue;
    if (item[1] === null && item[2] === 2) continue;
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

export async function createNote(
  callRpc: RpcCaller,
  notebookId: string,
  title = 'New Note',
  content = '',
): Promise<{ noteId: string }> {
  const raw = await callRpc(
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
  if (noteId && (title !== 'New Note' || content)) {
    await updateNote(callRpc, notebookId, noteId, content, title);
  }
  return { noteId };
}

export async function updateNote(
  callRpc: RpcCaller,
  notebookId: string,
  noteId: string,
  content: string,
  title: string,
): Promise<void> {
  await callRpc(
    NB_RPC.UPDATE_NOTE,
    [notebookId, noteId, [[[content, title, [], 0]]]],
    `/notebook/${notebookId}`,
  );
}

export async function deleteNote(
  callRpc: RpcCaller,
  notebookId: string,
  noteId: string,
): Promise<void> {
  await callRpc(NB_RPC.DELETE_NOTE, [notebookId, null, [noteId]], `/notebook/${notebookId}`);
}

// ── Sharing ──

export async function getShareStatus(
  callRpc: RpcCaller,
  notebookId: string,
): Promise<unknown> {
  const raw = await callRpc(
    NB_RPC.GET_SHARE_STATUS,
    [notebookId, [...PLATFORM_WEB]],
    `/notebook/${notebookId}`,
  );
  return parseEnvelopes(raw)[0] ?? null;
}

export async function shareNotebook(
  callRpc: RpcCaller,
  notebookId: string,
  isPublic: boolean,
): Promise<void> {
  const access = isPublic ? 1 : 0;
  await callRpc(
    NB_RPC.SHARE_NOTEBOOK,
    [[[notebookId, null, [access], [access, '']]], 1, null, [...PLATFORM_WEB]],
    `/notebook/${notebookId}`,
  );
}

export async function shareNotebookWithUser(
  callRpc: RpcCaller,
  notebookId: string,
  email: string,
  permission: 'editor' | 'viewer' = 'viewer',
  options?: { notify?: boolean; message?: string },
): Promise<void> {
  const permCode = permission === 'editor' ? 2 : 3;
  const notify = options?.notify !== false ? 1 : 0;
  const msg = options?.message ?? '';
  const msgFlag = msg ? 0 : 1;
  await callRpc(
    NB_RPC.SHARE_NOTEBOOK,
    [[[notebookId, [[email, null, permCode]], null, [msgFlag, msg]]], notify, null, [...PLATFORM_WEB]],
    `/notebook/${notebookId}`,
  );
}

// ── Settings ──

export async function getOutputLanguage(callRpc: RpcCaller): Promise<string | null> {
  const raw = await callRpc(
    NB_RPC.GET_ACCOUNT_INFO,
    [null, [1, null, null, null, null, null, null, null, null, null, [1]]],
    '/',
  );
  const envelopes = parseEnvelopes(raw);
  const result = envelopes[0];
  if (!Array.isArray(result)) return null;
  const outer = Array.isArray(result[0]) ? result[0] as unknown[] : null;
  if (!outer) return null;
  const settings = Array.isArray(outer[2]) ? outer[2] as unknown[] : null;
  if (!settings) return null;
  const langArr = Array.isArray(settings[4]) ? settings[4] as unknown[] : null;
  return langArr && typeof langArr[0] === 'string' ? langArr[0] : null;
}

export async function setOutputLanguage(callRpc: RpcCaller, language: string): Promise<void> {
  await callRpc(NB_RPC.SET_USER_SETTINGS, [[[null, [[null, null, null, null, [language]]]]]], '/');
}

// ── Artifacts ──

export async function renameArtifact(
  callRpc: RpcCaller,
  artifactId: string,
  newTitle: string,
): Promise<void> {
  await callRpc(NB_RPC.RENAME_ARTIFACT, [artifactId, newTitle]);
}

export async function getInteractiveHtml(
  callRpc: RpcCaller,
  artifactId: string,
): Promise<string> {
  const raw = await callRpc(NB_RPC.GET_INTERACTIVE_HTML, [artifactId]);
  const envelopes = parseEnvelopes(raw);
  const first = envelopes[0];
  if (typeof first === 'string') return first;
  if (Array.isArray(first)) {
    if (typeof first[0] === 'string') return first[0];
    const flat = Array.isArray(first[0]) ? first[0] as unknown[] : first;
    for (const el of flat) {
      if (typeof el === 'string' && el.length > 200 && el.includes('<')) return el;
      if (Array.isArray(el) && typeof el[0] === 'string' && el[0].length > 200 && el[0].includes('<')) return el[0];
    }
  }
  return '';
}

export async function generateArtifact(
  callRpc: RpcCaller,
  notebookId: string,
  sourceIds: string[],
  sessionLanguage: string,
  options?: ArtifactGenerateOptions | LegacyArtifactOptions,
): Promise<{ artifactId: string; title: string }> {
  const sidsTriple = sourceIds.map((id) => [[id]]);
  const sidsDouble = sourceIds.map((id) => [id]);

  let innerPayload: unknown[];

  if (options && 'type' in options) {
    const opts = { ...options } as ArtifactGenerateOptions & { language?: string };
    if (!opts.language) opts.language = sessionLanguage;
    innerPayload = buildArtifactPayload(sidsTriple, sidsDouble, opts);
  } else {
    const legacy = options as LegacyArtifactOptions | undefined;
    innerPayload = buildArtifactPayload(sidsTriple, sidsDouble, {
      type: 'audio',
      instructions: legacy?.customPrompt ?? undefined,
      language: legacy?.language ?? sessionLanguage,
    });
  }

  const raw = await callRpc(
    NB_RPC.GENERATE_ARTIFACT,
    [[...DEFAULT_USER_CONFIG], notebookId, innerPayload],
    `/notebook/${notebookId}`,
  );
  return parseGenerateArtifact(raw);
}

export async function getArtifacts(
  callRpc: RpcCaller,
  notebookId: string,
): Promise<ArtifactInfo[]> {
  const raw = await callRpc(
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

export async function deleteArtifact(callRpc: RpcCaller, artifactId: string): Promise<void> {
  await callRpc(NB_RPC.DELETE_ARTIFACT, [[...DEFAULT_USER_CONFIG], artifactId]);
}

// ── Research ──

export async function createWebSearch(
  callRpc: RpcCaller,
  notebookId: string,
  query: string,
  mode: 'fast' | 'deep' = 'fast',
): Promise<{ researchId: string; artifactId?: string }> {
  if (mode === 'deep') {
    return createDeepResearch(callRpc, notebookId, query);
  }

  const raw = await callRpc(
    NB_RPC.CREATE_WEB_SEARCH,
    [[query, 1], null, 1, notebookId],
    `/notebook/${notebookId}`,
  );
  const envelopes = parseEnvelopes(raw);
  const first = envelopes[0];
  const taskId = Array.isArray(first) && typeof first[0] === 'string' ? first[0] : '';
  if (!taskId) {
    console.error('NotebookLM: Warning — failed to parse researchId from fast research response');
  }
  return { researchId: taskId };
}

async function createDeepResearch(
  callRpc: RpcCaller,
  notebookId: string,
  query: string,
): Promise<{ researchId: string; artifactId?: string }> {
  const raw = await callRpc(
    NB_RPC.CREATE_DEEP_RESEARCH,
    [null, [1], [query, 1], 5, notebookId],
    `/notebook/${notebookId}`,
  );
  const envelopes = parseEnvelopes(raw);
  const first = envelopes[0];
  const taskId = Array.isArray(first) && typeof first[0] === 'string' ? first[0] : '';
  const reportId = Array.isArray(first) && typeof first[1] === 'string' ? first[1] : undefined;
  if (!taskId) {
    console.error('NotebookLM: Warning — failed to parse researchId from deep research response');
  }
  return { researchId: taskId, artifactId: reportId };
}

export async function pollResearchResults(
  callRpc: RpcCaller,
  notebookId: string,
  timeoutMs = 120_000,
): Promise<{ results: ResearchResult[]; report?: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const raw = await callRpc(
      NB_RPC.POLL_RESEARCH,
      [null, null, notebookId],
      `/notebook/${notebookId}`,
    );
    const parsed = parseResearchResults(raw);
    if (parsed.status >= 2) {
      console.error(`NotebookLM: Research completed — ${parsed.results.length} sources${parsed.report ? ' + report' : ''}`);
      return { results: parsed.results, report: parsed.report };
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  console.error('NotebookLM: Research poll timed out');
  return { results: [] };
}

export async function importResearch(
  callRpc: RpcCaller,
  notebookId: string,
  researchId: string,
  results: ResearchResult[],
  report?: string,
): Promise<void> {
  const sources: unknown[][] = [];

  if (report) {
    sources.push([null, ['Deep Research Report', report], null, 3, null, null, null, null, null, null, 3]);
  }

  for (const r of results) {
    sources.push([null, null, [r.url, r.title], null, null, null, null, null, null, null, 2]);
  }

  if (sources.length === 0) return;

  await callRpc(
    NB_RPC.IMPORT_RESEARCH,
    [null, [1], researchId, notebookId, sources],
    `/notebook/${notebookId}`,
  );
  console.error(`NotebookLM: Imported ${sources.length} research sources`);
}

export async function getStudioConfig(
  callRpc: RpcCaller,
  notebookId: string,
): Promise<StudioConfig> {
  const raw = await callRpc(
    NB_RPC.GET_STUDIO_CONFIG,
    [[...DEFAULT_USER_CONFIG], notebookId],
    `/notebook/${notebookId}`,
  );
  return parseStudioConfig(raw);
}

export async function getAccountInfo(callRpc: RpcCaller): Promise<AccountInfo> {
  const raw = await callRpc(NB_RPC.GET_ACCOUNT_INFO, [[...DEFAULT_USER_CONFIG]], '/');
  return parseQuota(raw);
}

// ── Chat ──

export async function sendChat(
  callChatStream: (notebookId: string, message: string, sourceIds: string[]) => Promise<string>,
  notebookId: string,
  message: string,
  sourceIds: string[],
): Promise<{ text: string; threadId: string }> {
  const raw = await callChatStream(notebookId, message, sourceIds);
  return parseChatStream(raw);
}

export async function sendChatWithCitations(
  callChatStream: (notebookId: string, message: string, sourceIds: string[]) => Promise<string>,
  notebookId: string,
  message: string,
  sourceIds: string[],
): Promise<ChatWithCitationsResult> {
  const raw = await callChatStream(notebookId, message, sourceIds);
  return parseChatWithCitations(raw);
}

export async function deleteChatThread(callRpc: RpcCaller, threadId: string): Promise<void> {
  await callRpc(NB_RPC.DELETE_CHAT_THREAD, [[], threadId, null, 1]);
}
