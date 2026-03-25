/**
 * E2E tests for addFileSource (local file upload via Scotty protocol).
 *
 * Requires a valid session (run `npx notebooklm export-session` first).
 * Uses the work account for quota headroom:
 *   NOTEBOOKLM_HOME=~/.notebooklm-work npx vitest run tests/e2e-file-upload.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NotebookClient } from '../src/client.js';
import { loadSession } from '../src/session-store.js';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let client: NotebookClient;
let hasSession = false;
let testNotebookId = '';
const tmpFiles: string[] = [];

function createTmpFile(name: string, content: string): string {
  const p = join(tmpdir(), `notebooklm-e2e-${Date.now()}-${name}`);
  writeFileSync(p, content, 'utf-8');
  tmpFiles.push(p);
  return p;
}

beforeAll(async () => {
  // loadSession ignores maxAge — just checks if session file exists
  const session = await loadSession();
  if (!session) return;
  hasSession = true;

  client = new NotebookClient();
  await client.connect({ transport: 'auto' });

  const { notebookId } = await client.createNotebook();
  testNotebookId = notebookId;
});

afterAll(async () => {
  if (client && testNotebookId) {
    try { await client.deleteNotebook(testNotebookId); } catch { /* best-effort */ }
  }
  if (client) await client.disconnect();
  for (const f of tmpFiles) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
});

describe('E2E addFileSource', () => {
  it('should upload a .txt file and get a sourceId', async () => {
    if (!hasSession || !testNotebookId) return expect(true).toBe(true);

    const filePath = createTmpFile('test.txt',
      'TypeScript is a strongly typed programming language that builds on JavaScript. '
      + 'It was developed by Microsoft and first released in 2012. '
      + 'TypeScript adds optional static typing, classes, and interfaces to JavaScript. '
      + 'It is designed for the development of large applications.',
    );

    const result = await client.addFileSource(testNotebookId, filePath);
    expect(result.sourceId).toBeTruthy();
    expect(result.title).toBeTruthy();
  }, 60_000);

  it('should show uploaded file source in notebook detail', async () => {
    if (!hasSession || !testNotebookId) return expect(true).toBe(true);

    // Poll until the file source is processed
    let ready = false;
    for (let i = 0; i < 20; i++) {
      const detail = await client.getNotebookDetail(testNotebookId);
      if (detail.sources.length >= 1 && detail.sources.some((s) => s.wordCount && s.wordCount > 0)) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    expect(ready).toBe(true);
  }, 120_000);

  it('should upload a .md file', async () => {
    if (!hasSession || !testNotebookId) return expect(true).toBe(true);

    const filePath = createTmpFile('test.md',
      '# Markdown Test\n\n'
      + 'This is a test markdown file for NotebookLM file upload.\n\n'
      + '## Section 1\n\nSome content about programming languages.\n\n'
      + '## Section 2\n\nMore content about software engineering.\n',
    );

    const result = await client.addFileSource(testNotebookId, filePath);
    expect(result.sourceId).toBeTruthy();
  }, 60_000);
});
