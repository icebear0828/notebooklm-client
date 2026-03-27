/**
 * E2E tests for all artifact types with custom prompts.
 *
 * Uses work account (NOTEBOOKLM_HOME=~/.notebooklm-work, Plus quota).
 * Requires proxy at HTTPS_PROXY or 127.0.0.1:7890.
 *
 * Run:
 *   NOTEBOOKLM_HOME=~/.notebooklm-work npx vitest run tests/e2e-artifacts.test.ts --config vitest.config.e2e.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NotebookClient } from '../src/client.js';
import { hasValidSession } from '../src/session-store.js';
import { setHomeDir } from '../src/paths.js';
import { ARTIFACT_TYPE } from '../src/rpc-ids.js';

setHomeDir(process.env['NOTEBOOKLM_HOME'] ?? `${process.env['HOME']}/.notebooklm-work`);

let client: NotebookClient;
let hasSession = false;

let notebookId = '';
let sourceIds: string[] = [];


const proxy = process.env['HTTPS_PROXY'] ?? process.env['https_proxy'] ?? 'http://127.0.0.1:7890';

beforeAll(async () => {
  hasSession = await hasValidSession();
  if (!hasSession) {
    console.warn('No valid session at work home — skipping');
    return;
  }

  client = new NotebookClient();
  await client.connect({ transport: 'auto', proxy });

  const { notebookId: nbId } = await client.createNotebook();
  notebookId = nbId;
  console.log('Test notebook:', notebookId);

  const { sourceId } = await client.addTextSource(
    notebookId,
    'AI Overview',
    `Artificial intelligence (AI) is the simulation of human intelligence processes by computer systems.
These processes include learning, reasoning, and self-correction. AI applications include expert systems,
natural language processing, speech recognition, and machine vision. Machine learning is a subset of AI
that provides systems the ability to learn and improve from experience without being explicitly programmed.
Deep learning is a subset of machine learning that uses neural networks with many layers. Key concepts
include supervised learning, unsupervised learning, reinforcement learning, transformers, and attention
mechanisms. Recent advances include large language models (LLMs) like GPT-4 and Claude, which demonstrate
remarkable capabilities in natural language understanding, code generation, and reasoning tasks.`,
  );
  sourceIds = [sourceId];
  console.log('Test source:', sourceId);

  const start = Date.now();
  while (Date.now() - start < 60_000) {
    const detail = await client.getNotebookDetail(notebookId);
    if (detail.sources.every(s => s.wordCount && s.wordCount > 0)) break;
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log('Source ready');
}, 120_000);

afterAll(async () => {
  if (!client) return;
  if (notebookId) {
    try { await client.deleteNotebook(notebookId); } catch { /* best-effort */ }
  }
  await client.disconnect();
});

function skipIfNoSession() {
  if (!hasSession) {
    console.warn('Skipped: no session');
    return true;
  }
  return false;
}

/** Small delay between tests to avoid hitting rate limits. */
const pause = () => new Promise(r => setTimeout(r, 2000));

describe('E2E Artifact Generation', () => {

  // ── Report ──

  it('should generate a briefing doc report', async () => {
    if (skipIfNoSession()) return;
    const { artifactId, title } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.REPORT, sourceIds, {
      type: 'report',
      template: 'briefing_doc',
      instructions: 'Focus on machine learning concepts',
    });
    console.log('Report artifact:', artifactId, title);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  it('should generate a study guide report', async () => {
    if (skipIfNoSession()) return;
    const { artifactId, title } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.REPORT, sourceIds, {
      type: 'report',
      template: 'study_guide',
    });
    console.log('Study guide:', artifactId, title);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  it('should generate a custom report', async () => {
    if (skipIfNoSession()) return;
    const { artifactId, title } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.REPORT, sourceIds, {
      type: 'report',
      template: 'custom',
      instructions: 'Write a comparison table of supervised vs unsupervised learning',
    });
    console.log('Custom report:', artifactId, title);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  // ── Quiz ──

  it('should generate a quiz', async () => {
    if (skipIfNoSession()) return;
    const { artifactId, title } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.QUIZ, sourceIds, {
      type: 'quiz',
      instructions: 'Focus on deep learning',
      difficulty: 'medium',
    });
    console.log('Quiz:', artifactId, title);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  it('should generate a quiz with quantity option', async () => {
    if (skipIfNoSession()) return;
    const { artifactId } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.QUIZ, sourceIds, {
      type: 'quiz',
      quantity: 'fewer',
      difficulty: 'easy',
    });
    console.log('Quiz (fewer/easy):', artifactId);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  it('should generate a quiz with hard difficulty', async () => {
    if (skipIfNoSession()) return;
    const { artifactId } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.QUIZ, sourceIds, {
      type: 'quiz',
      difficulty: 'hard',
    });
    console.log('Quiz (hard):', artifactId);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  // ── Flashcards ──

  it('should generate flashcards', async () => {
    if (skipIfNoSession()) return;
    const { artifactId, title } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.QUIZ, sourceIds, {
      type: 'flashcards',
      instructions: 'Key AI terminology',
    });
    console.log('Flashcards:', artifactId, title);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  it('should generate flashcards with options', async () => {
    if (skipIfNoSession()) return;
    const { artifactId } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.QUIZ, sourceIds, {
      type: 'flashcards',
      quantity: 'standard',
      difficulty: 'medium',
    });
    console.log('Flashcards (standard/medium):', artifactId);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  it('should generate flashcards without instructions', async () => {
    if (skipIfNoSession()) return;
    const { artifactId } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.QUIZ, sourceIds, {
      type: 'flashcards',
    });
    console.log('Flashcards (no opts):', artifactId);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  // ── Slides ──

  it('should generate a slide deck', async () => {
    if (skipIfNoSession()) return;
    const { artifactId, title } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.SLIDE_DECK, sourceIds, {
      type: 'slide_deck',
      instructions: 'Make it visual and concise',
    });
    console.log('Slides:', artifactId, title);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  it('should generate presenter slides', async () => {
    if (skipIfNoSession()) return;
    const { artifactId } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.SLIDE_DECK, sourceIds, {
      type: 'slide_deck',
      format: 'presenter',
      length: 'short',
    });
    console.log('Slides (presenter/short):', artifactId);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  it('should generate detailed slides', async () => {
    if (skipIfNoSession()) return;
    const { artifactId } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.SLIDE_DECK, sourceIds, {
      type: 'slide_deck',
      format: 'detailed',
    });
    console.log('Slides (detailed):', artifactId);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  // ── Data Table ──

  it('should generate a data table', async () => {
    if (skipIfNoSession()) return;
    const { artifactId, title } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.DATA_TABLE, sourceIds, {
      type: 'data_table',
      instructions: 'Compare AI subfields by key characteristics',
    });
    console.log('Data table:', artifactId, title);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  it('should generate a data table in Chinese', async () => {
    if (skipIfNoSession()) return;
    const { artifactId } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.DATA_TABLE, sourceIds, {
      type: 'data_table',
      language: 'zh',
      instructions: '对比各种AI技术的优缺点',
    });
    console.log('Data table (zh):', artifactId);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  it('should generate a data table without instructions', async () => {
    if (skipIfNoSession()) return;
    const { artifactId } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.DATA_TABLE, sourceIds, {
      type: 'data_table',
    });
    console.log('Data table (no opts):', artifactId);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  // ── Audio (verify backward compat + new options) ──

  it('should generate audio with legacy options (backward compat)', async () => {
    if (skipIfNoSession()) return;
    const config = await client.getStudioConfig(notebookId);
    const audioType = config.audioTypes.find(t => t.name.includes('Deep Dive')) ?? config.audioTypes[0];
    expect(audioType).toBeDefined();

    const { artifactId } = await client.generateArtifact(notebookId, audioType!.id, sourceIds, {
      customPrompt: 'Explain like a podcast for beginners',
    });
    console.log('Audio (legacy):', artifactId);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  it('should generate audio with new format options', async () => {
    if (skipIfNoSession()) return;
    const { artifactId } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.AUDIO, sourceIds, {
      type: 'audio',
      format: 'debate',
      length: 'short',
      instructions: 'Debate the pros and cons of AI',
    });
    console.log('Audio (debate/short):', artifactId);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  it('should generate audio with brief format', async () => {
    if (skipIfNoSession()) return;
    const { artifactId } = await client.generateArtifact(notebookId, ARTIFACT_TYPE.AUDIO, sourceIds, {
      type: 'audio',
      format: 'brief',
    });
    console.log('Audio (brief):', artifactId);
    expect(artifactId).toBeTruthy();
    await pause();
  }, 90_000);

  // Note: getInteractiveHtml (v9rmvd RPC) returns artifact metadata for reports,
  // not rendered HTML. HTML retrieval is a pre-existing limitation tracked separately.
});
