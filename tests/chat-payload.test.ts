import { describe, it, expect } from 'vitest';
import { NotebookClient } from '../src/client.js';
import type { Transport, TransportRequest } from '../src/transport.js';
import type { NotebookRpcSession } from '../src/types.js';

/**
 * Mock transport that captures every outgoing request and returns canned
 * responses keyed off the URL. The chat stream and batchexecute envelopes
 * follow the on-the-wire `)]}'\n<len>\n<json>` format that boq-parser expects.
 */
class MockTransport implements Transport {
  calls: Array<{ url: string; body: Record<string, string>; queryParams: Record<string, string> }> = [];
  /** Threads returned by the next hPTbtc call. Defaults to one default thread. */
  listChatThreadsResult: string[] = ['default-thread-uuid'];
  /** threadId/responseId returned by the next chat stream call. */
  chatStreamThreadId = 'default-thread-uuid';
  chatStreamResponseId = 'resp-id';
  chatStreamText = 'mock reply';

  async execute(req: TransportRequest): Promise<string> {
    this.calls.push({ url: req.url, body: { ...req.body }, queryParams: { ...req.queryParams } });

    if (req.url.endsWith('/GenerateFreeFormStreamed')) {
      return this.buildChatResponse();
    }
    if (req.url.endsWith('/batchexecute')) {
      const rpcid = req.queryParams['rpcids'] ?? new URL(req.url + '?' + new URLSearchParams(req.queryParams).toString()).searchParams.get('rpcids');
      if (rpcid === 'hPTbtc') return this.buildListThreadsResponse();
      throw new Error(`MockTransport: unexpected rpcid ${rpcid}`);
    }
    throw new Error(`MockTransport: unexpected URL ${req.url}`);
  }

  getSession(): NotebookRpcSession {
    return {
      cookies: [],
      at: 'mock-at',
      bl: 'mock-bl',
      fsid: 'mock-fsid',
      language: 'en',
      lastUpdated: 0,
    } as NotebookRpcSession;
  }

  async refreshSession(): Promise<void> {}
  async dispose(): Promise<void> {}

  /** Decode the chat stream request the SUT just sent and return its inner payload. */
  lastChatPayload(): unknown[] {
    const last = [...this.calls].reverse().find((c) => c.url.endsWith('/GenerateFreeFormStreamed'));
    if (!last) throw new Error('no chat stream call captured');
    const fReq = last.body['f.req'];
    if (!fReq) throw new Error('no f.req in chat body');
    const outer = JSON.parse(fReq) as [null, string];
    return JSON.parse(outer[1]) as unknown[];
  }

  private buildChatResponse(): string {
    // Inner payload echoes [text, null, [threadId, responseId, ...]] per parser.parseChatStream.
    const inner = [this.chatStreamText, null, [this.chatStreamThreadId, this.chatStreamResponseId, 0]];
    const env = [['wrb.fr', 'oid', JSON.stringify(inner), null]];
    const json = JSON.stringify(env);
    return `)]}'\n${json.length}\n${json}`;
  }

  private buildListThreadsResponse(): string {
    // hPTbtc shape: [[[threadId], [threadId], ...]]
    const inner = [this.listChatThreadsResult.map((id) => [id])];
    const env = [['wrb.fr', 'hPTbtc', JSON.stringify(inner), null]];
    const json = JSON.stringify(env);
    return `)]}'\n${json.length}\n${json}`;
  }
}

function makeClient(mock: MockTransport): NotebookClient {
  const c = new NotebookClient();
  // Bypass connect() — we don't need a real transport, just inject the mock.
  (c as unknown as { transport: Transport; transportMode: string }).transport = mock;
  (c as unknown as { transport: Transport; transportMode: string }).transportMode = 'http';
  return c;
}

const NOTEBOOK_A = '11111111-1111-1111-1111-111111111111';
const NOTEBOOK_B = '22222222-2222-2222-2222-222222222222';

describe('chat payload — single notebook, multi-turn', () => {
  it('first turn sends chatHistory=null and turn counter=1', async () => {
    const mock = new MockTransport();
    const c = makeClient(mock);

    await c.sendChat(NOTEBOOK_A, 'first question', ['src-1']);

    const payload = mock.lastChatPayload();
    expect(payload[2]).toBeNull();             // chatHistory MUST be null on first call
    expect(payload[4]).toBe('default-thread-uuid'); // threadId resolved via hPTbtc
    expect(payload[7]).toBe(NOTEBOOK_A);
    expect(payload[8]).toBe(1);                // turn counter
  });

  it('second turn sends accumulated history (newest-first, assistant before user) and turn=2', async () => {
    const mock = new MockTransport();
    mock.chatStreamText = 'first reply';
    const c = makeClient(mock);

    await c.sendChat(NOTEBOOK_A, 'first question', ['src-1']);

    mock.chatStreamText = 'second reply';
    await c.sendChat(NOTEBOOK_A, 'second question', ['src-1']);

    const payload = mock.lastChatPayload();
    expect(payload[2]).toEqual([
      ['first reply', null, 2],
      ['first question', null, 1],
    ]);
    expect(payload[4]).toBe('default-thread-uuid');
    expect(payload[8]).toBe(2);
  });

  it('third turn keeps newest-first ordering and turn=3', async () => {
    const mock = new MockTransport();
    const c = makeClient(mock);

    mock.chatStreamText = 'A1';
    await c.sendChat(NOTEBOOK_A, 'Q1', ['src-1']);
    mock.chatStreamText = 'A2';
    await c.sendChat(NOTEBOOK_A, 'Q2', ['src-1']);
    mock.chatStreamText = 'A3';
    await c.sendChat(NOTEBOOK_A, 'Q3', ['src-1']);

    const payload = mock.lastChatPayload();
    expect(payload[2]).toEqual([
      ['A2', null, 2],
      ['Q2', null, 1],
      ['A1', null, 2],
      ['Q1', null, 1],
    ]);
    expect(payload[8]).toBe(3);
  });

  it('skips assistant entry if reply text is empty (only user message recorded)', async () => {
    const mock = new MockTransport();
    mock.chatStreamText = '';
    const c = makeClient(mock);

    await c.sendChat(NOTEBOOK_A, 'Q1', ['src-1']);
    mock.chatStreamText = 'A2';
    await c.sendChat(NOTEBOOK_A, 'Q2', ['src-1']);

    const payload = mock.lastChatPayload();
    expect(payload[2]).toEqual([
      ['Q1', null, 1],
    ]);
    expect(payload[8]).toBe(2);
  });
});

describe('chat payload — thread resolution', () => {
  it('calls hPTbtc once per notebook to resolve the default thread', async () => {
    const mock = new MockTransport();
    const c = makeClient(mock);

    await c.sendChat(NOTEBOOK_A, 'Q1', ['src-1']);
    await c.sendChat(NOTEBOOK_A, 'Q2', ['src-1']);
    await c.sendChat(NOTEBOOK_A, 'Q3', ['src-1']);

    const listThreadsCalls = mock.calls.filter(
      (c) => c.url.endsWith('/batchexecute') && c.queryParams['rpcids'] === 'hPTbtc',
    );
    expect(listThreadsCalls).toHaveLength(1);
  });

  it('resets state when notebookId changes (different threads, fresh history)', async () => {
    const mock = new MockTransport();
    const c = makeClient(mock);

    mock.chatStreamText = 'A-reply';
    mock.chatStreamThreadId = 'thread-A';
    mock.listChatThreadsResult = ['thread-A'];
    await c.sendChat(NOTEBOOK_A, 'Q-on-A', ['src-1']);

    mock.chatStreamText = 'B-reply';
    mock.chatStreamThreadId = 'thread-B';
    mock.listChatThreadsResult = ['thread-B'];
    await c.sendChat(NOTEBOOK_B, 'Q-on-B', ['src-1']);

    const payload = mock.lastChatPayload();
    expect(payload[2]).toBeNull();          // history reset
    expect(payload[4]).toBe('thread-B');
    expect(payload[7]).toBe(NOTEBOOK_B);
    expect(payload[8]).toBe(1);             // counter reset
  });

  it('falls back to threadId=null when hPTbtc returns no threads', async () => {
    const mock = new MockTransport();
    mock.listChatThreadsResult = [];
    mock.chatStreamThreadId = 'server-allocated';
    const c = makeClient(mock);

    await c.sendChat(NOTEBOOK_A, 'Q1', ['src-1']);

    const payload = mock.lastChatPayload();
    expect(payload[4]).toBeNull();          // no thread to send

    // Subsequent call adopts the server-allocated thread from the reply.
    await c.sendChat(NOTEBOOK_A, 'Q2', ['src-1']);
    const payload2 = mock.lastChatPayload();
    expect(payload2[4]).toBe('server-allocated');
  });
});

describe('chat payload — sourceIds and config', () => {
  it('wraps each sourceId in [[<id>]] and preserves the config tuple', async () => {
    const mock = new MockTransport();
    const c = makeClient(mock);

    await c.sendChat(NOTEBOOK_A, 'Q', ['s1', 's2']);

    const payload = mock.lastChatPayload();
    expect(payload[0]).toEqual([[['s1']], [['s2']]]);
    expect(payload[3]).toEqual([2, null, [1], [1]]);
  });
});
