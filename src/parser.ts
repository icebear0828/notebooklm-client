/**
 * NotebookLM RPC response parsers.
 */

import { parseEnvelopes } from './boq-parser.js';
import type { NotebookInfo, SourceInfo, ArtifactInfo, StudioConfig, StudioAudioType, StudioDocType, AccountInfo, ResearchResult, ChatCitation, ChatWithCitationsResult } from './types.js';
type QuotaInfo = AccountInfo;

// ── Helpers ──

function get(data: unknown, ...path: number[]): unknown {
  let current: unknown = data;
  for (const idx of path) {
    if (!Array.isArray(current)) return undefined;
    current = current[idx];
  }
  return current;
}

function getString(data: unknown, ...path: number[]): string {
  const val = get(data, ...path);
  return typeof val === 'string' ? val : '';
}

function getArray(data: unknown, ...path: number[]): unknown[] | null {
  const val = get(data, ...path);
  return Array.isArray(val) ? val : null;
}

function extractInner(raw: string): unknown {
  const envelopes = parseEnvelopes(raw);
  return envelopes.length > 0 ? envelopes[0] : null;
}

function extractAllInner(raw: string): unknown[] {
  return parseEnvelopes(raw);
}

// ── Notebook CRUD Parsers ──

export function parseCreateNotebook(raw: string): { notebookId: string; threadId: string } {
  const inner = extractInner(raw);
  const id = getString(inner, 2);
  if (!id) {
    let debugRaw = raw;
    if (raw && raw.length > 1000) debugRaw = raw.slice(0, 1000) + '...';
    throw new Error(`Failed to parse notebook ID from create response\nRaw response: ${debugRaw}`);
  }
  // Trailing field is the auto-allocated default chat thread: [[<threadId>]].
  // Empty string when the server omits it (treat as best-effort — caller can
  // fall back to listChatThreads).
  const threadId = getString(inner, 11, 0, 0);
  return { notebookId: id, threadId };
}

/**
 * hPTbtc response shape: `[[[<threadId>], [<threadId>], ...]]` — one tuple per
 * chat thread bound to the notebook. Returns the IDs in server order.
 */
export function parseListChatThreads(raw: string): string[] {
  const inner = extractInner(raw);
  const entries = getArray(inner, 0);
  if (!entries) return [];
  const ids: string[] = [];
  for (const entry of entries) {
    if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[0]) {
      ids.push(entry[0]);
    }
  }
  return ids;
}

export function parseListNotebooks(raw: string): NotebookInfo[] {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return [];

  const entries = Array.isArray(inner[0]) ? inner[0] as unknown[] : inner;
  const notebooks: NotebookInfo[] = [];

  for (const entry of entries) {
    if (!Array.isArray(entry)) continue;
    const title = typeof entry[0] === 'string' ? entry[0] : '';
    const id = typeof entry[2] === 'string' ? entry[2] : '';
    if (id && /^[0-9a-f]{8}-/.test(id)) {
      const sourceCount = Array.isArray(entry[1]) ? entry[1].length : undefined;
      notebooks.push({ id, title, sourceCount });
    }
  }

  return notebooks;
}

export function parseNotebookDetail(raw: string): { title: string; sources: SourceInfo[] } {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return { title: '', sources: [] };

  const entry = Array.isArray(inner[0]) ? inner[0] as unknown[] : inner;
  const title = typeof entry[0] === 'string' ? entry[0] : '';
  const sources: SourceInfo[] = [];
  const sourcesArr = Array.isArray(entry[1]) ? entry[1] as unknown[] : [];

  for (const srcEntry of sourcesArr) {
    if (!Array.isArray(srcEntry)) continue;
    let id = '';
    const first = srcEntry[0];
    if (Array.isArray(first) && typeof first[0] === 'string') {
      id = first[0];
    }
    const sourceTitle = typeof srcEntry[1] === 'string' ? srcEntry[1] : '';
    if (id) {
      const meta = Array.isArray(srcEntry[2]) ? srcEntry[2] as unknown[] : [];
      const wordCount = typeof meta[1] === 'number' ? meta[1] : undefined;
      let url: string | undefined;
      if (Array.isArray(meta[7]) && typeof meta[7][0] === 'string') {
        url = meta[7][0];
      } else if (typeof meta[7] === 'string') {
        url = meta[7];
      }
      sources.push({ id, title: sourceTitle, wordCount, url });
    }
  }

  return { title, sources };
}

// ── Source Parsers ──

export function parseAddSource(raw: string): { sourceId: string; title: string } {
  const inner = extractInner(raw);
  const entry = getArray(inner, 0, 0);
  if (!entry) return { sourceId: '', title: '' };
  const idArr = getArray(entry, 0);
  const id = idArr && typeof idArr[0] === 'string' ? idArr[0] : '';
  const title = getString(entry, 1);
  return { sourceId: id, title };
}

export function parseListSourceThreads(raw: string): string[] {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return [];
  const threads: string[] = [];
  for (const entry of inner) {
    if (Array.isArray(entry) && Array.isArray(entry[0]) && typeof entry[0][0] === 'string') {
      threads.push(entry[0][0]);
    }
  }
  return threads;
}

export function parseSourceContent(raw: string): { id: string; title: string; wordCount: number } {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return { id: '', title: '', wordCount: 0 };
  const idArr = getArray(inner, 0);
  const id = idArr && typeof idArr[0] === 'string' ? idArr[0] : '';
  const title = getString(inner, 1);
  const meta = getArray(inner, 2);
  const wordCount = meta && typeof meta[1] === 'number' ? meta[1] : 0;
  return { id, title, wordCount };
}

export function parseSourceSummary(raw: string): { sourceId: string; summary: string } {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return { sourceId: '', summary: '' };
  const sourceId = getString(inner, 0, 0, 0, 0);
  const summary = typeof inner[1] === 'string' ? inner[1] : '';
  return { sourceId, summary };
}

// ── Artifact Parsers ──

export function parseGenerateArtifact(raw: string): { artifactId: string; title: string } {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return { artifactId: '', title: '' };
  const entry = Array.isArray(inner[0]) ? inner[0] as unknown[] : inner;
  const artifactId = typeof entry[0] === 'string' ? entry[0] : '';
  const title = typeof entry[1] === 'string' ? entry[1] : '';
  return { artifactId, title };
}

export function parseArtifacts(raw: string): ArtifactInfo[] {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return [];

  let entries: unknown[] = inner;
  if (entries.length === 1 && Array.isArray(entries[0])) {
    entries = entries[0] as unknown[];
  }

  const artifacts: ArtifactInfo[] = [];

  for (const rawEntry of entries) {
    if (!Array.isArray(rawEntry)) continue;
    const entry: unknown[] = (rawEntry.length === 1 && Array.isArray(rawEntry[0]))
      ? rawEntry[0] as unknown[]
      : rawEntry;

    const id = typeof entry[0] === 'string' ? entry[0] : '';
    const title = typeof entry[1] === 'string' ? entry[1] : '';
    const type = typeof entry[2] === 'number' ? entry[2] : 0;
    if (!id) continue;

    const artifact: ArtifactInfo = { id, title, type };

    const sourceIdsRaw = getArray(entry, 3);
    if (sourceIdsRaw) {
      artifact.sourceIds = [];
      for (const sid of sourceIdsRaw) {
        if (Array.isArray(sid) && Array.isArray(sid[0]) && typeof sid[0][0] === 'string') {
          artifact.sourceIds.push(sid[0][0]);
        } else if (Array.isArray(sid) && typeof sid[0] === 'string') {
          artifact.sourceIds.push(sid[0]);
        }
      }
    }

    const mediaUrls = findMediaUrls(entry);
    if (mediaUrls.download) artifact.downloadUrl = mediaUrls.download;
    if (mediaUrls.stream) artifact.streamUrl = mediaUrls.stream;
    if (mediaUrls.hls) artifact.hlsUrl = mediaUrls.hls;
    if (mediaUrls.dash) artifact.dashUrl = mediaUrls.dash;
    if (mediaUrls.durationSeconds !== undefined) artifact.durationSeconds = mediaUrls.durationSeconds;
    if (mediaUrls.durationNanos !== undefined) artifact.durationNanos = mediaUrls.durationNanos;

    artifacts.push(artifact);
  }

  return artifacts;
}

interface MediaUrls {
  download?: string;
  stream?: string;
  hls?: string;
  dash?: string;
  durationSeconds?: number;
  durationNanos?: number;
}

function findMediaUrls(data: unknown, depth = 0): MediaUrls {
  if (depth > 12 || data === null || data === undefined) return {};

  if (Array.isArray(data)) {
    if (data.length === 2 && typeof data[0] === 'number' && typeof data[1] === 'number'
        && data[0] > 10 && data[0] < 100000 && data[1] > 1000000) {
      return { durationSeconds: data[0], durationNanos: data[1] };
    }

    if (data.length >= 2 && Array.isArray(data[0])) {
      const first = data[0];
      if (typeof first[0] === 'string' && first[0].includes('googleusercontent.com/notebooklm/')) {
        const result: MediaUrls = {};
        for (const variant of data) {
          if (!Array.isArray(variant) || typeof variant[0] !== 'string') continue;
          const url = variant[0] as string;
          const typeCode = variant[1];
          if (url.includes('=m140-dv') || typeCode === 4) result.download = url;
          else if (url.includes('=m140') || typeCode === 1) result.stream = url;
          else if (url.includes('=mm,hls') || typeCode === 2) result.hls = url;
          else if (url.includes('=mm,dash') || typeCode === 3) result.dash = url;
        }
        return result;
      }
    }

    const merged: MediaUrls = {};
    for (const item of data) {
      const found = findMediaUrls(item, depth + 1);
      Object.assign(merged, found);
    }
    return merged;
  }

  return {};
}

export function findArtifactDownloadUrl(raw: string, artifactId: string): string | null {
  const artifacts = parseArtifacts(raw);
  const artifact = artifacts.find((a) => a.id === artifactId);
  return artifact?.downloadUrl ?? null;
}

// ── Chat Parser ──

export function parseChatStream(raw: string): { text: string; threadId: string; responseId: string } {
  const inners = extractAllInner(raw);

  let lastText = '';
  let threadId = '';
  let responseId = '';

  for (const inner of inners) {
    if (!Array.isArray(inner)) continue;
    const payload = Array.isArray(inner[0]) ? inner[0] as unknown[] : inner;
    const text = typeof payload[0] === 'string' ? payload[0] : '';
    if (text) {
      lastText = text;
    }
    const meta = getArray(payload, 2);
    if (meta) {
      if (typeof meta[0] === 'string' && meta[0]) threadId = meta[0];
      if (typeof meta[1] === 'string' && meta[1]) responseId = meta[1];
    }
  }

  return { text: lastText, threadId, responseId };
}

// ── Chat With Citations Parser ──

interface ChunkDetail {
  sourceId: string | null;
  relevance: number | null;
  excerpt: string;
}

function flattenExcerptTree(node: unknown): string {
  if (typeof node === 'string') return node;
  if (!Array.isArray(node)) return '';
  const parts: string[] = [];
  for (const child of node) {
    if (typeof child === 'string') {
      parts.push(child);
    } else if (Array.isArray(child)) {
      parts.push(flattenExcerptTree(child));
    }
  }
  return parts.join('');
}

function buildChunkMap(citationTree: unknown[]): Map<string, ChunkDetail> {
  const map = new Map<string, ChunkDetail>();
  for (const cite of citationTree) {
    if (!Array.isArray(cite)) continue;
    const chunkId = getString(cite, 0, 0);
    if (!chunkId) continue;
    const meta = getArray(cite, 1);
    if (!meta) continue;

    const relevance = typeof meta[2] === 'number' ? meta[2] : null;
    const excerptRaw = get(meta, 4);
    const excerpt = flattenExcerptTree(excerptRaw);
    const sourceId = getString(meta, 5, 0, 0, 0) || null;

    map.set(chunkId, { sourceId, relevance, excerpt });
  }
  return map;
}

export function parseChatWithCitations(raw: string): ChatWithCitationsResult {
  const base = parseChatStream(raw);
  const inners = extractAllInner(raw);
  const citations: ChatCitation[] = [];

  // Use the last envelope that has citation data (streaming sends progressive updates)
  let lastChunkMap: Map<string, ChunkDetail> | null = null;
  let lastInlineRefs: unknown[] | null = null;

  for (const inner of inners) {
    if (!Array.isArray(inner)) continue;
    const payload = Array.isArray(inner[0]) ? inner[0] as unknown[] : inner;

    const answerData = getArray(payload, 4, 0);
    if (!answerData || answerData.length < 2) continue;
    if (!Array.isArray(answerData[1])) continue;

    lastInlineRefs = answerData[1] as unknown[];
    const citationTree = getArray(payload, 4, 3);
    lastChunkMap = citationTree ? buildChunkMap(citationTree) : new Map<string, ChunkDetail>();
  }

  if (lastInlineRefs && lastChunkMap) {
    for (let i = 0; i < lastInlineRefs.length; i++) {
      const ref = lastInlineRefs[i];
      if (!Array.isArray(ref)) continue;

      const chunkId = getString(ref, 0, 0);
      if (!chunkId) continue;

      const refMeta = getArray(ref, 1);
      const charStart = refMeta && typeof refMeta[1] === 'number' ? refMeta[1] : null;
      const charEnd = refMeta && typeof refMeta[2] === 'number' ? refMeta[2] : null;

      const detail = lastChunkMap.get(chunkId);

      citations.push({
        index: i + 1,
        sourceId: detail?.sourceId ?? null,
        relevance: detail?.relevance ?? null,
        charStart,
        charEnd,
        excerpt: detail?.excerpt ?? '',
        chunkId,
      });
    }
  }

  return {
    ...base,
    citations,
  };
}

// ── Studio Config Parser ──

export function parseStudioConfig(raw: string): StudioConfig {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return { audioTypes: [], explainerTypes: [], slideTypes: [], docTypes: [] };

  const sections = Array.isArray(inner[0]) ? inner[0] as unknown[] : inner;

  function parseTypedSection(section: unknown): StudioAudioType[] {
    if (!Array.isArray(section) || !Array.isArray(section[0])) return [];
    const items = section[0] as unknown[];
    return items.filter(Array.isArray).map((item: unknown) => {
      const arr = item as unknown[];
      return {
        id: typeof arr[0] === 'number' ? arr[0] : 0,
        name: typeof arr[1] === 'string' ? arr[1] : '',
        description: typeof arr[2] === 'string' ? arr[2] : '',
      };
    });
  }

  function parseDocSection(section: unknown): StudioDocType[] {
    if (!Array.isArray(section) || !Array.isArray(section[0])) return [];
    const items = section[0] as unknown[];
    return items.filter(Array.isArray).map((item: unknown) => {
      const arr = item as unknown[];
      return {
        name: typeof arr[0] === 'string' ? arr[0] : '',
        description: typeof arr[1] === 'string' ? arr[1] : '',
      };
    });
  }

  return {
    audioTypes: parseTypedSection(sections[0]),
    explainerTypes: parseTypedSection(sections[1]),
    slideTypes: parseTypedSection(sections[2]),
    docTypes: parseDocSection(sections[3]),
  };
}

// ── Quota Parser ──

export function parseQuota(raw: string): QuotaInfo {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return { planType: 0, notebookLimit: 0, sourceLimit: 0, sourceWordLimit: 0, isPlus: false };

  // Response: [[null, [planType, notebookLimit, sourceLimit, sourceWordLimit, ?], [bool], [[?]], [isPlus, ?, ?, ?]]]
  // RPC: GetOrCreateAccount → account config, NOT usage/remaining counts
  const entry = Array.isArray(inner[0]) && !Array.isArray(inner[1]) ? inner[0] as unknown[] : inner;
  const limits = Array.isArray(entry[1]) ? entry[1] as number[] : [];
  const flags = Array.isArray(entry[4]) ? entry[4] as unknown[] : [];

  return {
    planType: typeof limits[0] === 'number' ? limits[0] : 0,
    notebookLimit: typeof limits[1] === 'number' ? limits[1] : 0,
    sourceLimit: typeof limits[2] === 'number' ? limits[2] : 0,
    sourceWordLimit: typeof limits[3] === 'number' ? limits[3] : 0,
    isPlus: flags[0] === true,
  };
}

// ── Research Results Parser ──

/**
 * Parse POLL_RESEARCH (e3bVqc) response for research results.
 *
 * Response: [[[taskId, taskInfo, ts1, ts2], ...]]
 * taskInfo: [notebookId, [query, sourceType], innerStatus, sourcesAndSummary?, statusCode?]
 *
 * statusCode: 1=in_progress, 2=completed (fast), 6=completed (deep)
 *
 * sourcesAndSummary:
 *   [[url, title, desc, type], ...], "summary"]   (HTTP transport, nested)
 *   [[url, title, desc, type], ...]                (browser capture, flat)
 *
 * Deep research report entries:
 *   [null, [title, markdown], null, 3, ...]        (current format)
 *   [null, title, null, type, ..., [chunks]]       (legacy format)
 */
export function parseResearchResults(raw: string): { status: number; results: ResearchResult[]; report?: string } {
  const inner = extractInner(raw);
  if (!Array.isArray(inner)) return { status: 0, results: [] };

  // Navigate to the task entry: inner → [[entry, ...]] → entry
  const outerList = getArray(inner, 0);
  if (!outerList) return { status: 0, results: [] };

  const wrapper = Array.isArray(outerList[0]) ? outerList[0] as unknown[] : outerList;
  let entryArr: unknown[] | null = null;
  if (typeof wrapper[0] === 'string') {
    entryArr = wrapper;
  } else if (Array.isArray(wrapper[0]) && typeof wrapper[0][0] === 'string') {
    entryArr = wrapper[0] as unknown[];
  }
  if (!entryArr) return { status: 0, results: [] };

  const taskInfo = getArray(entryArr, 1);
  if (!taskInfo) return { status: 0, results: [] };

  // statusCode at taskInfo[4]: 2=completed (fast), 6=completed (deep)
  const statusCode = typeof taskInfo[4] === 'number' ? taskInfo[4] : (typeof taskInfo[2] === 'number' ? taskInfo[2] : 0);
  const isCompleted = statusCode === 2 || statusCode === 6;
  const status = isCompleted ? 2 : statusCode; // normalize to 2 for completed

  const results: ResearchResult[] = [];
  let report: string | undefined;

  let sourcesAndSummary = getArray(taskInfo, 3);
  if (!sourcesAndSummary) return { status, results };

  // Unwrap nested format: [[[url,title,...], ...], "summary"] → [[url,title,...], ...]
  let sourceItems: unknown[];
  if (sourcesAndSummary.length > 0 && Array.isArray(sourcesAndSummary[0]) && Array.isArray(sourcesAndSummary[0][0])) {
    sourceItems = sourcesAndSummary[0] as unknown[];
  } else {
    sourceItems = sourcesAndSummary;
  }

  for (const item of sourceItems) {
    if (!Array.isArray(item)) continue;

    // Deep research report entry: [null, [title, markdown], null, 3, ...]
    if (item[0] === null && Array.isArray(item[1]) && typeof item[1][0] === 'string' && typeof item[1][1] === 'string') {
      if (!report) report = item[1][1];
      continue;
    }
    // Legacy report: [null, title, null, type, ..., [chunks]]
    if (item[0] === null && typeof item[1] === 'string' && Array.isArray(item[6])) {
      const chunks = (item[6] as unknown[]).filter((c): c is string => typeof c === 'string');
      if (chunks.length > 0 && !report) report = chunks.join('\n\n');
      continue;
    }

    // URL source: [url, title, desc, type]
    const url = typeof item[0] === 'string' ? item[0] : '';
    const title = typeof item[1] === 'string' ? item[1] : '';
    const description = typeof item[2] === 'string' ? item[2] : '';
    if (url) results.push({ url, title, description });
  }

  return { status, results, report };
}

// Re-export Boq utilities
export { parseEnvelopes, stripSafetyPrefix } from './boq-parser.js';
