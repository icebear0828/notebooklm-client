import { describe, it, expect, vi } from 'vitest';
import { runChatCommand, type ChatCommandClient } from '../src/commands/chat.js';

function makeClient(opts: {
  sourceIds?: string[];
  chatText?: string;
  citationText?: string;
} = {}) {
  const sourceIds = opts.sourceIds ?? ['src-1'];
  const chatText = opts.chatText ?? 'plain reply';
  const citationText = opts.citationText ?? 'citation reply';

  const client = {
    getNotebookDetail: vi.fn(async (_notebookId: string) => ({
      title: 'Notebook',
      sources: sourceIds.map((id) => ({ id, title: `Source ${id}` })),
    })),
    sendChat: vi.fn(async (_notebookId: string, _question: string, _sourceIds: string[]) => ({
      text: chatText,
      threadId: 'thread-1',
    })),
    sendChatWithCitations: vi.fn(async (_notebookId: string, _question: string, _sourceIds: string[]) => ({
      text: citationText,
      threadId: 'thread-1',
      responseId: 'response-1',
      citations: [],
    })),
  } satisfies ChatCommandClient;

  return client;
}

describe('runChatCommand', () => {
  it('uses notebook detail sources when --source-ids is omitted', async () => {
    const client = makeClient({ sourceIds: ['src-1', 'src-2'] });

    const result = await runChatCommand(client, 'nb-1', {
      question: 'Summarize this',
    });

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'plain reply',
      stderr: [],
    });
    expect(client.sendChat).toHaveBeenCalledWith('nb-1', 'Summarize this', ['src-1', 'src-2']);
  });

  it('treats explicit empty --source-ids as empty instead of falling back to all sources', async () => {
    const client = makeClient({ sourceIds: ['src-1'] });

    const result = await runChatCommand(client, 'nb-1', {
      question: 'Summarize this',
      sourceIds: '',
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr.join('\n')).toMatch(/0 sources visible/);
    expect(client.sendChat).not.toHaveBeenCalled();
    expect(client.sendChatWithCitations).not.toHaveBeenCalled();
  });

  it('trims and drops blank entries from --source-ids', async () => {
    const client = makeClient({ sourceIds: ['ignored'] });

    const result = await runChatCommand(client, 'nb-1', {
      question: 'Summarize this',
      sourceIds: ' src-1, ,src-2, ',
    });

    expect(result.exitCode).toBe(0);
    expect(client.sendChat).toHaveBeenCalledWith('nb-1', 'Summarize this', ['src-1', 'src-2']);
  });

  it('exits 2 when NotebookLM exposes no sources for the notebook', async () => {
    const client = makeClient({ sourceIds: [] });

    const result = await runChatCommand(client, 'nb-1', {
      question: 'Summarize this',
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr.join('\n')).toMatch(/still indexing/);
    expect(client.sendChat).not.toHaveBeenCalled();
  });

  it('exits 3 when the plain chat response text is empty', async () => {
    const client = makeClient({ chatText: '  \n\t' });

    const result = await runChatCommand(client, 'nb-1', {
      question: 'Summarize this',
    });

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr.join('\n')).toMatch(/API returned empty text/);
    expect(result.stderr.join('\n')).toContain('npx notebooklm export-session');
  });

  it('exits 3 when the citation chat response text is empty', async () => {
    const client = makeClient({ citationText: '' });

    const result = await runChatCommand(client, 'nb-1', {
      question: 'Summarize this',
      withCitations: true,
    });

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr.join('\n')).toMatch(/API returned empty text/);
  });

  it('prints citation results as formatted JSON when text is present', async () => {
    const client = makeClient({ citationText: 'citation reply' });

    const result = await runChatCommand(client, 'nb-1', {
      question: 'Summarize this',
      withCitations: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toEqual([]);
    expect(result.stdout).toBe(JSON.stringify({
      text: 'citation reply',
      threadId: 'thread-1',
      responseId: 'response-1',
      citations: [],
    }, null, 2));
  });
});
