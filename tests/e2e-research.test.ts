/**
 * E2E tests for web search / research features including import.
 *
 * Requires a valid session + proxy.
 * Run with:
 *   NOTEBOOKLM_HOME=~/.notebooklm-work npx vitest run tests/e2e-research.test.ts -c /dev/null
 */

import { describe, it, expect, afterAll } from 'vitest';
import { NotebookClient } from '../src/client.js';
import { hasValidSession } from '../src/session-store.js';

const PROXY = process.env['HTTPS_PROXY'] || 'http://127.0.0.1:7890';

let client: NotebookClient;
const notebooksToClean: string[] = [];

afterAll(async () => {
  if (!client) return;
  for (const id of notebooksToClean) {
    try { await client.deleteNotebook(id); } catch { /* best-effort */ }
  }
  await client.disconnect();
});

async function waitForSourcesReady(notebookId: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const detail = await client.getNotebookDetail(notebookId);
    if (detail.sources.length > 0 && detail.sources.every(s => s.wordCount && s.wordCount > 0)) return;
    await new Promise(r => setTimeout(r, 3_000));
  }
}

describe('E2E Research', async () => {
  const valid = await hasValidSession();

  it('should perform fast research and import sources', async () => {
    if (!valid) { console.log('SKIP: no session'); return; }

    client = new NotebookClient();
    await client.connect({ transport: 'auto', proxy: PROXY });

    const { notebookId } = await client.createNotebook();
    notebooksToClean.push(notebookId);

    // Add seed source and wait for processing
    await client.addTextSource(notebookId, 'Seed', 'Quantum computing basics and qubits');
    await waitForSourcesReady(notebookId);

    // Fast research
    const { researchId } = await client.createWebSearch(notebookId, 'quantum computing breakthroughs 2026', 'fast');
    console.log('Fast research ID:', researchId);
    expect(researchId).toBeTruthy();

    // Poll for results via e3bVqc
    const { results } = await client.pollResearchResults(notebookId);
    console.log('Research results:', results.length);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.url).toBeTruthy();
    expect(results[0]!.title).toBeTruthy();

    // Import results
    await client.importResearch(notebookId, researchId, results);

    // Verify sources were added
    const detail = await client.getNotebookDetail(notebookId);
    console.log('Sources after import:', detail.sources.length);
    // Should have seed + imported URL sources
    expect(detail.sources.length).toBeGreaterThan(1);
  }, 180_000); // 3 min

  it('should perform deep research and return artifactId', async () => {
    if (!valid) { console.log('SKIP: no session'); return; }

    if (!client) {
      client = new NotebookClient();
      await client.connect({ transport: 'auto', proxy: PROXY });
    }

    const { notebookId } = await client.createNotebook();
    notebooksToClean.push(notebookId);

    await client.addTextSource(notebookId, 'Seed', 'Climate change mitigation strategies');
    await waitForSourcesReady(notebookId);

    // Deep research — should return both IDs
    const result = await client.createWebSearch(notebookId, 'effective climate change mitigation strategies 2026', 'deep');
    console.log('Deep research ID:', result.researchId, 'artifactId:', result.artifactId);
    expect(result.researchId).toBeTruthy();
    expect(result.artifactId).toBeTruthy();
  }, 120_000);
});
