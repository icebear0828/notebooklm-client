/**
 * High-level workflow orchestrations — extracted from NotebookClient.
 *
 * Each `run*` function takes a `NotebookClient` instance (import type only
 * to avoid circular runtime dependency) and orchestrates a full workflow:
 * create notebook → add source → generate artifact → download.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { NB_URLS, ARTIFACT_TYPE } from './rpc-ids.js';
import { humanSleep } from './utils/humanize.js';
import {
  downloadFileHttp,
  saveQuizHtml,
  saveReport,
  saveSlideDeck,
  saveInfographic,
  saveDataTable,
} from './download.js';
import type { NotebookClient } from './client.js';
import type {
  SourceInput,
  ArtifactInfo,
  WorkflowProgress,
  AudioOverviewOptions,
  AudioOverviewResult,
  MindMapOptions,
  MindMapResult,
  FlashcardsOptions,
  FlashcardsResult,
  AnalyzeOptions,
  AnalyzeResult,
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

// ── Source helpers ──

export async function addSourceFromInput(
  client: NotebookClient,
  notebookId: string,
  source: SourceInput,
): Promise<string[]> {
  switch (source.type) {
    case 'url': {
      const { sourceId } = await client.addUrlSource(notebookId, source.url!);
      return [sourceId];
    }
    case 'text': {
      const { sourceId } = await client.addTextSource(notebookId, 'Pasted Text', source.text!);
      return [sourceId];
    }
    case 'file': {
      const { sourceId } = await client.addFileSource(notebookId, source.filePath!);
      return [sourceId];
    }
    case 'research': {
      const mode = source.researchMode ?? 'fast';
      // Seed source required — empty notebook cannot trigger research
      await client.addTextSource(notebookId, 'Research Topic', source.topic!);
      const { researchId: _researchId } = await client.createWebSearch(notebookId, source.topic!, mode);

      const timeoutMs = mode === 'deep' ? 1_200_000 : 120_000;
      const { results, report } = await client.pollResearchResults(notebookId, timeoutMs);
      console.error(`NotebookLM: Research completed — ${results.length} sources${report ? ' + report' : ''}`);

      // importResearch RPC is broken (sources don't appear in notebook).
      // Instead: add the research report as a rich text source, then add each URL.
      if (report) {
        await client.addTextSource(notebookId, `Research Report: ${source.topic!}`, report);
      }
      let added = 0;
      for (const r of results) {
        try {
          await client.addUrlSource(notebookId, r.url);
          added++;
        } catch {
          // Non-fatal: some URLs may be unreachable
        }
      }
      if (added > 0 || report) {
        console.error(`NotebookLM: Imported ${added} URL sources${report ? ' + report' : ''}`);
      }

      // Deep research imports 40+ URL sources; Google indexes each async
      // (10-15s per URL), so 2min is too tight. Bump to 10min only here —
      // other call sites process a single user-provided source in seconds.
      await pollSourcesReady(client, notebookId, 600_000);

      const detail = await client.getNotebookDetail(notebookId);
      return detail.sources.map((s) => s.id);
    }
  }
}

export async function pollSourcesReady(
  client: NotebookClient,
  notebookId: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  let pollCount = 0;
  while (Date.now() - start < timeoutMs) {
    const detail = await client.getNotebookDetail(notebookId);
    if (detail.sources.length > 0) {
      const readyCount = detail.sources.filter(s => s.wordCount !== undefined && s.wordCount > 0).length;
      // With 50+ URL sources from research, some will fail to fetch (403/404/timeout).
      // Accept "mostly ready": 70% indexed or 30+ sources (whichever is lower).
      const threshold = Math.min(Math.ceil(detail.sources.length * 0.7), 30);
      if (readyCount >= threshold) {
        if (readyCount < detail.sources.length) {
          console.error(`NotebookLM: Sources ready ${readyCount}/${detail.sources.length} (threshold met)`);
        }
        return;
      }
    }
    pollCount++;
    const delay = Math.min(3000 + pollCount * 1500, 15000);
    await humanSleep(delay);
  }
  console.error('NotebookLM: Source processing may not have completed within timeout');
}

export async function pollArtifactReady(
  client: NotebookClient,
  notebookId: string,
  artifactId: string,
  timeoutMs: number,
): Promise<ArtifactInfo> {
  const start = Date.now();
  let pollCount = 0;

  while (Date.now() - start < timeoutMs) {
    const artifacts = await client.getArtifacts(notebookId);
    let artifact = artifacts.find((a) => a.id === artifactId);
    // Fallback: generateArtifact RPC sometimes returns a task ID that differs
    // from the final artifact id. If exact match missed, take any ready media.
    if (!artifact) {
      artifact = artifacts.find(a =>
        (a.type === ARTIFACT_TYPE.AUDIO || a.type === ARTIFACT_TYPE.VIDEO) &&
        (a.downloadUrl || a.streamUrl || a.hlsUrl),
      );
    }
    if (artifact) {
      const isMedia = artifact.type === ARTIFACT_TYPE.AUDIO || artifact.type === ARTIFACT_TYPE.VIDEO;
      if (isMedia) {
        if (artifact.downloadUrl || artifact.streamUrl || artifact.hlsUrl) return artifact;
      } else {
        return artifact;
      }
    }

    pollCount++;
    const baseDelay = Math.min(5000 + pollCount * 2500, 30000);
    await humanSleep(baseDelay);
  }
  throw new Error('Artifact generation timed out');
}

// ── Reusable notebook setup ──

/**
 * Create-or-reuse a NotebookLM workspace.
 *
 * - If `notebookId` is provided: skip createNotebook, optionally append a new
 *   source, then return the union of existing + newly added source ids.
 * - Otherwise: create a fresh notebook; `source` is required.
 *
 * Throws when neither a notebookId nor a source is provided, or when a
 * reused notebook ends up with zero sources (would silently fail upstream).
 */
export async function setupNotebook(
  client: NotebookClient,
  source: SourceInput | undefined,
  notebookId: string | undefined,
  onProgress?: (p: WorkflowProgress) => void,
): Promise<{ notebookId: string; sourceIds: string[] }> {
  if (!notebookId && !source) {
    throw new Error(
      'setupNotebook requires either notebookId (to reuse) or source (to create)',
    );
  }

  let nbId: string;
  if (notebookId) {
    onProgress?.({
      status: 'creating_notebook',
      message: `Reusing notebook ${notebookId}...`,
    });
    nbId = notebookId;
  } else {
    onProgress?.({ status: 'creating_notebook', message: 'Creating notebook...' });
    const created = await client.createNotebook();
    nbId = created.notebookId;
  }

  let newSourceIds: string[] = [];
  if (source) {
    onProgress?.({
      status: 'adding_source',
      message: `Adding source (${source.type})...`,
    });
    newSourceIds = await addSourceFromInput(client, nbId, source);
    onProgress?.({
      status: 'configuring',
      message: 'Waiting for source processing...',
    });
    await pollSourcesReady(client, nbId, 600_000);
  }

  let sourceIds: string[];
  if (notebookId) {
    const detail = await client.getNotebookDetail(nbId);
    const existing = detail.sources.map((s) => s.id);
    sourceIds = Array.from(new Set([...newSourceIds, ...existing]));
  } else {
    sourceIds = newSourceIds;
  }

  if (sourceIds.length === 0) {
    throw new Error(
      `Notebook ${nbId} has no sources — supply --url/--text/--file/--topic at least once before generating`,
    );
  }
  return { notebookId: nbId, sourceIds };
}

// ── Bound download helper ──

function boundDownloadFn(client: NotebookClient) {
  const session = client.getRpcSession()!;
  const proxy = client.getProxy();
  return (url: string, outputDir: string, filename: string) =>
    downloadFileHttp({ session, proxy }, url, outputDir, filename);
}

// ── Workflow functions ──

export async function runAudioOverview(
  client: NotebookClient,
  options: AudioOverviewOptions,
  onProgress?: (p: WorkflowProgress) => void,
): Promise<AudioOverviewResult> {
  client.ensureConnected();

  const { notebookId, sourceIds } = await setupNotebook(
    client,
    options.source,
    options.notebookId,
    onProgress,
  );

  onProgress?.({ status: 'generating', message: 'Generating audio overview...' });
  const config = await client.getStudioConfig(notebookId);
  const audioType = config.audioTypes.find(t => t.name.includes('Deep Dive')) ?? config.audioTypes[0];
  if (!audioType) throw new Error('No audio types available from Studio config');
  const { artifactId } = await client.generateArtifact(
    notebookId,
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
  const artifact = await pollArtifactReady(client, notebookId, artifactId, 1_800_000);

  onProgress?.({ status: 'downloading', message: 'Downloading audio...' });
  const audioPath = await client.downloadAudio(artifact.downloadUrl!, options.outputDir);

  onProgress?.({ status: 'completed', message: 'Audio overview complete!' });
  return { audioPath, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
}

export async function runMindMap(
  client: NotebookClient,
  options: MindMapOptions,
  onProgress?: (p: WorkflowProgress) => void,
): Promise<MindMapResult> {
  client.ensureConnected();

  const { notebookId } = await setupNotebook(
    client,
    options.source,
    options.notebookId,
    onProgress,
  );

  onProgress?.({ status: 'generating', message: 'Generating mind map (via page)...' });
  const page = client.getActivePage();
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

export async function runFlashcards(
  client: NotebookClient,
  options: FlashcardsOptions,
  onProgress?: (p: WorkflowProgress) => void,
): Promise<FlashcardsResult> {
  client.ensureConnected();

  const { notebookId, sourceIds } = await setupNotebook(
    client,
    options.source,
    options.notebookId,
    onProgress,
  );

  onProgress?.({ status: 'generating', message: 'Generating flashcards...' });
  const { artifactId } = await client.generateArtifact(notebookId, sourceIds, {
    type: 'flashcards',
    instructions: options.instructions,
    language: options.language,
    quantity: options.quantity,
    difficulty: options.difficulty,
  });

  onProgress?.({ status: 'generating', message: 'Waiting for flashcards...' });
  await pollArtifactReady(client, notebookId, artifactId, 300_000);

  onProgress?.({ status: 'downloading', message: 'Saving flashcards...' });
  const htmlPath = await saveQuizHtml(
    (id) => client.getInteractiveHtml(id),
    artifactId, options.outputDir, 'flashcards',
  );

  onProgress?.({ status: 'completed', message: 'Flashcards generated!' });
  return { htmlPath, cards: [], notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
}

export async function runAnalyze(
  client: NotebookClient,
  options: AnalyzeOptions,
  onProgress?: (p: WorkflowProgress) => void,
): Promise<AnalyzeResult> {
  client.ensureConnected();

  onProgress?.({ status: 'creating_notebook', message: 'Creating notebook...' });
  const { notebookId } = await client.createNotebook();

  onProgress?.({ status: 'adding_source', message: `Adding source (${options.source.type})...` });
  const sourceIds = await addSourceFromInput(client, notebookId, options.source);
  await pollSourcesReady(client, notebookId, 600_000);

  onProgress?.({ status: 'generating', message: 'Analyzing...' });
  const { text } = await client.sendChat(notebookId, options.question, sourceIds);

  onProgress?.({ status: 'completed', message: 'Analysis complete!' });
  return { answer: text, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
}

export async function runReport(
  client: NotebookClient,
  options: ReportOptions,
  onProgress?: (p: WorkflowProgress) => void,
): Promise<ReportResult> {
  client.ensureConnected();

  const { notebookId, sourceIds } = await setupNotebook(
    client,
    options.source,
    options.notebookId,
    onProgress,
  );

  onProgress?.({ status: 'generating', message: 'Generating report...' });
  const { artifactId } = await client.generateArtifact(notebookId, sourceIds, {
    type: 'report',
    template: options.template,
    instructions: options.instructions,
    language: options.language,
  });

  onProgress?.({ status: 'generating', message: 'Waiting for report...' });
  await pollArtifactReady(client, notebookId, artifactId, 300_000);

  onProgress?.({ status: 'downloading', message: 'Saving report...' });
  const callRpc = client.callBatchExecute.bind(client);
  const markdownPath = await saveReport(callRpc, artifactId, options.outputDir);

  onProgress?.({ status: 'completed', message: 'Report complete!' });
  return { markdownPath, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
}

export async function runVideo(
  client: NotebookClient,
  options: VideoOptions,
  onProgress?: (p: WorkflowProgress) => void,
): Promise<VideoResult> {
  client.ensureConnected();

  const { notebookId, sourceIds } = await setupNotebook(
    client,
    options.source,
    options.notebookId,
    onProgress,
  );

  onProgress?.({ status: 'generating', message: 'Generating video...' });
  const { artifactId } = await client.generateArtifact(notebookId, sourceIds, {
    type: 'video',
    format: options.format,
    style: options.style,
    instructions: options.instructions,
    language: options.language,
  });

  onProgress?.({ status: 'generating', message: 'Waiting for video generation...' });
  const artifact = await pollArtifactReady(client, notebookId, artifactId, 1_800_000);
  const videoUrl = artifact.streamUrl ?? artifact.hlsUrl ?? artifact.downloadUrl ?? '';

  onProgress?.({ status: 'completed', message: 'Video complete!' });
  return { videoUrl, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
}

export async function runQuiz(
  client: NotebookClient,
  options: QuizOptions,
  onProgress?: (p: WorkflowProgress) => void,
): Promise<QuizResult> {
  client.ensureConnected();

  const { notebookId, sourceIds } = await setupNotebook(
    client,
    options.source,
    options.notebookId,
    onProgress,
  );

  onProgress?.({ status: 'generating', message: 'Generating quiz...' });
  const { artifactId } = await client.generateArtifact(notebookId, sourceIds, {
    type: 'quiz',
    instructions: options.instructions,
    language: options.language,
    quantity: options.quantity,
    difficulty: options.difficulty,
  });

  onProgress?.({ status: 'generating', message: 'Waiting for quiz...' });
  await pollArtifactReady(client, notebookId, artifactId, 300_000);

  onProgress?.({ status: 'downloading', message: 'Saving quiz...' });
  const htmlPath = await saveQuizHtml(
    (id) => client.getInteractiveHtml(id),
    artifactId, options.outputDir, 'quiz',
  );

  onProgress?.({ status: 'completed', message: 'Quiz complete!' });
  return { htmlPath, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
}

export async function runInfographic(
  client: NotebookClient,
  options: InfographicOptions,
  onProgress?: (p: WorkflowProgress) => void,
): Promise<InfographicResult> {
  client.ensureConnected();

  const { notebookId, sourceIds } = await setupNotebook(
    client,
    options.source,
    options.notebookId,
    onProgress,
  );

  onProgress?.({ status: 'generating', message: 'Generating infographic...' });
  const { artifactId } = await client.generateArtifact(notebookId, sourceIds, {
    type: 'infographic',
    instructions: options.instructions,
    language: options.language,
    orientation: options.orientation,
    detail: options.detail,
    style: options.style,
  });

  onProgress?.({ status: 'generating', message: 'Waiting for infographic...' });
  await pollArtifactReady(client, notebookId, artifactId, 300_000);

  onProgress?.({ status: 'downloading', message: 'Saving infographic...' });
  const callRpc = client.callBatchExecute.bind(client);
  const imagePath = await saveInfographic(callRpc, boundDownloadFn(client), artifactId, options.outputDir);

  onProgress?.({ status: 'completed', message: 'Infographic complete!' });
  return { imagePath, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
}

export async function runSlideDeck(
  client: NotebookClient,
  options: SlideDeckOptions,
  onProgress?: (p: WorkflowProgress) => void,
): Promise<SlideDeckResult> {
  client.ensureConnected();

  const { notebookId, sourceIds } = await setupNotebook(
    client,
    options.source,
    options.notebookId,
    onProgress,
  );

  onProgress?.({ status: 'generating', message: 'Generating slide deck...' });
  const { artifactId } = await client.generateArtifact(notebookId, sourceIds, {
    type: 'slide_deck',
    instructions: options.instructions,
    language: options.language,
    format: options.format,
    length: options.length,
  });

  onProgress?.({ status: 'generating', message: 'Waiting for slides...' });
  await pollArtifactReady(client, notebookId, artifactId, 300_000);

  onProgress?.({ status: 'downloading', message: 'Downloading slides...' });
  const callRpc = client.callBatchExecute.bind(client);
  const { pptxPath, pdfPath } = await saveSlideDeck(callRpc, boundDownloadFn(client), artifactId, options.outputDir);

  onProgress?.({ status: 'completed', message: 'Slide deck complete!' });
  return { pptxPath, pdfPath, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
}

export async function runDataTable(
  client: NotebookClient,
  options: DataTableOptions,
  onProgress?: (p: WorkflowProgress) => void,
): Promise<DataTableResult> {
  client.ensureConnected();

  const { notebookId, sourceIds } = await setupNotebook(
    client,
    options.source,
    options.notebookId,
    onProgress,
  );

  onProgress?.({ status: 'generating', message: 'Generating data table...' });
  const { artifactId } = await client.generateArtifact(notebookId, sourceIds, {
    type: 'data_table',
    instructions: options.instructions,
    language: options.language,
  });

  onProgress?.({ status: 'generating', message: 'Waiting for data table...' });
  await pollArtifactReady(client, notebookId, artifactId, 300_000);

  onProgress?.({ status: 'downloading', message: 'Saving data table...' });
  const callRpc = client.callBatchExecute.bind(client);
  const csvPath = await saveDataTable(callRpc, artifactId, options.outputDir);

  onProgress?.({ status: 'completed', message: 'Data table complete!' });
  return { csvPath, notebookUrl: `${NB_URLS.BASE}/notebook/${notebookId}` };
}
