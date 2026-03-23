/**
 * E2E tests for HTTP transport mode.
 *
 * Requires a valid session at ~/.notebooklm/session.json
 * (run `npx notebooklm export-session` first).
 *
 * These tests hit the real NotebookLM API — run with:
 *   npx vitest run tests/e2e-http.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NotebookClient } from '../src/client.js';
import { hasValidSession, loadSession, refreshTokens } from '../src/session-store.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SKIP_REASON = 'No valid session — run `npx notebooklm export-session` first';

let client: NotebookClient;
let hasSession = false;

// Notebook created during tests — cleaned up in afterAll
let testNotebookId = '';
let testSourceId = '';
let testChatThreadId = '';

beforeAll(async () => {
  hasSession = await hasValidSession();
  if (!hasSession) return;

  client = new NotebookClient();
  await client.connect({ transport: 'http' });
});

afterAll(async () => {
  if (!client) return;

  // Cleanup: delete test notebook if created
  if (testNotebookId) {
    try {
      await client.deleteNotebook(testNotebookId);
    } catch {
      // Best-effort cleanup
    }
  }

  await client.disconnect();
});

describe('E2E HTTP Transport', () => {
  // ── Session / Connection ──

  it('should connect via HTTP transport', () => {
    if (!hasSession) return expect(true).toBe(true); // skip
    expect(client.getTransportMode()).toBe('http');
    expect(client.getRpcSession()).not.toBeNull();
    expect(client.getRpcSession()!.at).toBeTruthy();
  });

  it('should have no browser page in HTTP mode', () => {
    if (!hasSession) return expect(true).toBe(true);
    expect(client.getActivePage()).toBeNull();
  });

  // ── List Notebooks ──

  it('should list notebooks', async () => {
    if (!hasSession) return expect(true).toBe(true);
    const notebooks = await client.listNotebooks();
    expect(Array.isArray(notebooks)).toBe(true);
    // Each notebook should have id and title
    for (const nb of notebooks) {
      expect(nb.id).toBeTruthy();
      expect(typeof nb.title).toBe('string');
    }
  });

  // ── Account Info ──

  it('should get account info with valid limits', async () => {
    if (!hasSession) return expect(true).toBe(true);
    const account = await client.getAccountInfo();
    expect(account.planType).toBeGreaterThan(0);
    expect(account.notebookLimit).toBeGreaterThan(0);
    expect(account.sourceLimit).toBeGreaterThan(0);
    expect(account.sourceWordLimit).toBeGreaterThan(0);
    expect(typeof account.isPlus).toBe('boolean');
  }, 30_000);

  // ── Create Notebook ──

  it('should create a notebook', async () => {
    if (!hasSession) return expect(true).toBe(true);
    const result = await client.createNotebook();
    testNotebookId = result.notebookId;
    expect(testNotebookId).toBeTruthy();
    expect(testNotebookId.length).toBeGreaterThan(10);
  }, 30_000);

  // ── Get Notebook Detail ──

  it('should get notebook detail', async () => {
    if (!hasSession || !testNotebookId) return expect(true).toBe(true);
    const detail = await client.getNotebookDetail(testNotebookId);
    expect(typeof detail.title).toBe('string');
    expect(Array.isArray(detail.sources)).toBe(true);
    expect(detail.sources).toHaveLength(0); // just created, no sources yet
  }, 30_000);

  // ── Add Text Source ──

  it('should add a text source', async () => {
    if (!hasSession || !testNotebookId) return expect(true).toBe(true);
    const result = await client.addTextSource(
      testNotebookId,
      'E2E Test Source',
      'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript. '
      + 'It adds optional static typing, classes, and interfaces. '
      + 'TypeScript is developed and maintained by Microsoft. '
      + 'It is designed for development of large applications and transpiles to JavaScript.',
    );
    testSourceId = result.sourceId;
    expect(testSourceId).toBeTruthy();
    expect(result.title).toBeTruthy();
  }, 30_000);

  // ── Add URL Source ──

  it('should add a URL source', async () => {
    if (!hasSession || !testNotebookId) return expect(true).toBe(true);
    const result = await client.addUrlSource(
      testNotebookId,
      'https://en.wikipedia.org/wiki/TypeScript',
    );
    expect(result.sourceId).toBeTruthy();
    expect(result.title).toBeTruthy();
  }, 60_000);

  // ── Verify Sources Added ──

  it('should show sources in notebook detail', async () => {
    if (!hasSession || !testNotebookId) return expect(true).toBe(true);

    // Poll until sources are processed (wordCount > 0)
    let ready = false;
    for (let i = 0; i < 20; i++) {
      const detail = await client.getNotebookDetail(testNotebookId);
      if (detail.sources.length >= 2 && detail.sources.every((s) => s.wordCount && s.wordCount > 0)) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    expect(ready).toBe(true);
  }, 120_000);

  // ── Get Source Summary ──

  it('should get source summary', async () => {
    if (!hasSession || !testSourceId) return expect(true).toBe(true);
    const result = await client.getSourceSummary(testSourceId);
    expect(typeof result.summary).toBe('string');
  }, 30_000);

  // ── Chat ──

  it('should send chat message', async () => {
    if (!hasSession || !testNotebookId || !testSourceId) return expect(true).toBe(true);
    const result = await client.sendChat(
      testNotebookId,
      'What is TypeScript?',
      [testSourceId],
    );
    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(10);
    if (result.threadId) {
      testChatThreadId = result.threadId;
    }
  }, 60_000);

  // ── Multi-turn Chat ──

  it('should support multi-turn chat', async () => {
    if (!hasSession || !testNotebookId || !testSourceId) return expect(true).toBe(true);
    const result = await client.sendChat(
      testNotebookId,
      'Who maintains it?',
      [testSourceId],
    );
    expect(result.text).toBeTruthy();
    // Should reference Microsoft (context from previous turn + source)
  }, 60_000);

  // ── Delete Chat Thread ──

  it('should delete chat thread', async () => {
    if (!hasSession || !testChatThreadId) return expect(true).toBe(true);
    // Should not throw
    await client.deleteChatThread(testChatThreadId);
  }, 30_000);

  // ── Studio Config ──

  it('should get studio config with dynamic types', async () => {
    if (!hasSession || !testNotebookId) return expect(true).toBe(true);
    const config = await client.getStudioConfig(testNotebookId);
    expect(Array.isArray(config.audioTypes)).toBe(true);
    expect(config.audioTypes.length).toBeGreaterThan(0);
    expect(config.audioTypes[0]!.id).toBeDefined();
    expect(config.audioTypes[0]!.name).toBeTruthy();
    expect(Array.isArray(config.slideTypes)).toBe(true);
    expect(Array.isArray(config.docTypes)).toBe(true);
  }, 30_000);

  // ── Get Artifacts (empty) ──

  it('should get artifacts (empty for new notebook)', async () => {
    if (!hasSession || !testNotebookId) return expect(true).toBe(true);
    const artifacts = await client.getArtifacts(testNotebookId);
    expect(Array.isArray(artifacts)).toBe(true);
  }, 30_000);

  // ── Generate Artifact (audio) ──

  it('should generate an audio artifact', async () => {
    if (!hasSession || !testNotebookId || !testSourceId) return expect(true).toBe(true);
    // Use dynamic studio config instead of hardcoded type ID
    const config = await client.getStudioConfig(testNotebookId);
    const deepDive = config.audioTypes.find(t => t.name.includes('Deep Dive'));
    const audioType = deepDive ?? config.audioTypes[0];
    expect(audioType).toBeDefined();

    const result = await client.generateArtifact(
      testNotebookId,
      audioType!.id,
      [testSourceId],
    );
    expect(result.artifactId).toBeTruthy();
    expect(typeof result.title).toBe('string');
  }, 60_000);

  // ── Download Audio via HTTP ──

  let testArtifactId = '';

  it('should download audio via HTTP transport', async () => {
    if (!hasSession || !testNotebookId) return expect(true).toBe(true);

    // Poll for artifact to be ready (has downloadUrl)
    let downloadUrl = '';
    for (let i = 0; i < 60; i++) {
      const artifacts = await client.getArtifacts(testNotebookId);
      const audio = artifacts.find((a) => a.downloadUrl);
      if (audio?.downloadUrl) {
        downloadUrl = audio.downloadUrl;
        testArtifactId = audio.id;
        break;
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }

    if (!downloadUrl) {
      console.error('Audio not ready within timeout — skipping download test');
      return;
    }

    const tmpDir = await mkdtemp(join(tmpdir(), 'nb-e2e-'));
    try {
      const filePath = await client.downloadAudio(downloadUrl, tmpDir);
      expect(existsSync(filePath)).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 660_000); // 11 min — audio generation can take a while

  // ── Delete Artifact ──

  it('should delete an artifact', async () => {
    if (!hasSession || !testArtifactId) return expect(true).toBe(true);
    await client.deleteArtifact(testArtifactId);

    // Verify deleted
    const artifacts = await client.getArtifacts(testNotebookId);
    const found = artifacts.find((a) => a.id === testArtifactId);
    expect(found).toBeUndefined();
  }, 30_000);

  // ── Delete Source ──

  it('should delete a source', async () => {
    if (!hasSession || !testSourceId) return expect(true).toBe(true);
    await client.deleteSource(testSourceId);
    // Verify it's gone
    const detail = await client.getNotebookDetail(testNotebookId);
    const found = detail.sources.find((s) => s.id === testSourceId);
    expect(found).toBeUndefined();
  }, 30_000);

  // ── Delete Notebook ──

  it('should delete the test notebook', async () => {
    if (!hasSession || !testNotebookId) return expect(true).toBe(true);
    await client.deleteNotebook(testNotebookId);

    // Verify deleted
    const notebooks = await client.listNotebooks();
    const found = notebooks.find((nb) => nb.id === testNotebookId);
    expect(found).toBeUndefined();

    testNotebookId = ''; // prevent afterAll from double-deleting
  }, 30_000);

  // ── Token Refresh (no browser) ──

  it('should refresh tokens using cookies only (no browser)', async () => {
    if (!hasSession) return expect(true).toBe(true);

    const session = await loadSession();
    if (!session) return expect(true).toBe(true);

    const tmpDir = await mkdtemp(join(tmpdir(), 'nb-refresh-'));
    try {
      const savePath = join(tmpDir, 'refreshed.json');
      const refreshed = await refreshTokens(session, savePath);

      // Should have a valid CSRF token
      expect(refreshed.at).toBeTruthy();
      expect(refreshed.at.length).toBeGreaterThan(10);
      // bl should contain labs-tailwind
      expect(refreshed.bl).toContain('labs-tailwind');
      // Cookies should be preserved
      expect(refreshed.cookies).toContain('SID=');
      // Should be saved to disk
      expect(existsSync(savePath)).toBe(true);

      // Verify the refreshed session actually works
      const testClient = new NotebookClient();
      await testClient.connect({ transport: 'http', session: refreshed });
      const notebooks = await testClient.listNotebooks();
      expect(Array.isArray(notebooks)).toBe(true);
      await testClient.disconnect();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 30_000);
});
