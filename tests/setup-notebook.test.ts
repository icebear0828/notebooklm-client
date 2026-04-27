import { describe, it, expect, vi } from 'vitest';
import { setupNotebook } from '../src/workflows.js';
import type { NotebookClient } from '../src/client.js';
import type { SourceInput } from '../src/types.js';

type MockClient = NotebookClient & {
  createNotebook: ReturnType<typeof vi.fn>;
  addUrlSource: ReturnType<typeof vi.fn>;
  addTextSource: ReturnType<typeof vi.fn>;
  addFileSource: ReturnType<typeof vi.fn>;
  getNotebookDetail: ReturnType<typeof vi.fn>;
};

function makeClient(opts: {
  newNotebookId?: string;
  newSourceId?: string;
  existingSources?: { id: string; wordCount: number }[];
}): MockClient {
  const newNotebookId = opts.newNotebookId ?? 'created-nb';
  const newSourceId = opts.newSourceId ?? 'src-new';
  const existing = opts.existingSources ?? [];
  return {
    createNotebook: vi
      .fn()
      .mockResolvedValue({ notebookId: newNotebookId, title: 'untitled' }),
    addUrlSource: vi
      .fn()
      .mockResolvedValue({ sourceId: newSourceId, title: 'url' }),
    addTextSource: vi
      .fn()
      .mockResolvedValue({ sourceId: newSourceId, title: 'text' }),
    addFileSource: vi
      .fn()
      .mockResolvedValue({ sourceId: newSourceId, title: 'file' }),
    getNotebookDetail: vi.fn().mockResolvedValue({
      title: 'nb',
      sources: existing,
    }),
  } as unknown as MockClient;
}

const urlSource: SourceInput = { type: 'url', url: 'https://example.com/x' };

describe('setupNotebook', () => {
  it('creates a fresh notebook when no notebookId given', async () => {
    // pollSourcesReady polls getNotebookDetail until at least one source has
    // wordCount > 0 — so seed the mock with the just-added source as ready.
    const client = makeClient({
      newNotebookId: 'fresh',
      newSourceId: 'src-1',
      existingSources: [{ id: 'src-1', wordCount: 100 }],
    });
    const res = await setupNotebook(client, urlSource, undefined);
    expect(res.notebookId).toBe('fresh');
    expect(res.sourceIds).toEqual(['src-1']);
    expect(client.createNotebook).toHaveBeenCalledOnce();
    expect(client.addUrlSource).toHaveBeenCalledWith('fresh', 'https://example.com/x');
  });

  it('reuses an existing notebook and returns its current sources when no new source given', async () => {
    const client = makeClient({
      existingSources: [
        { id: 'old-1', wordCount: 100 },
        { id: 'old-2', wordCount: 200 },
      ],
    });
    const res = await setupNotebook(client, undefined, 'reused-nb');
    expect(res.notebookId).toBe('reused-nb');
    expect(res.sourceIds).toEqual(['old-1', 'old-2']);
    expect(client.createNotebook).not.toHaveBeenCalled();
    expect(client.addUrlSource).not.toHaveBeenCalled();
  });

  it('reuses notebook AND appends a new source, merging with existing', async () => {
    const client = makeClient({
      newSourceId: 'src-new',
      existingSources: [
        { id: 'src-new', wordCount: 50 },
        { id: 'old-1', wordCount: 100 },
      ],
    });
    const res = await setupNotebook(client, urlSource, 'reused-nb');
    expect(res.notebookId).toBe('reused-nb');
    expect(client.addUrlSource).toHaveBeenCalledWith('reused-nb', 'https://example.com/x');
    expect(client.createNotebook).not.toHaveBeenCalled();
    expect(res.sourceIds).toEqual(['src-new', 'old-1']);
  });

  it('throws when neither notebookId nor source provided', async () => {
    const client = makeClient({});
    await expect(setupNotebook(client, undefined, undefined)).rejects.toThrow(
      /requires either notebookId/,
    );
  });

  it('throws when reused notebook is empty and no new source given', async () => {
    const client = makeClient({ existingSources: [] });
    await expect(setupNotebook(client, undefined, 'empty-nb')).rejects.toThrow(
      /no sources/,
    );
  });

  it('deduplicates source ids when the appended source matches existing', async () => {
    const client = makeClient({
      newSourceId: 'shared-id',
      existingSources: [{ id: 'shared-id', wordCount: 50 }],
    });
    const res = await setupNotebook(client, urlSource, 'reused-nb');
    expect(res.sourceIds).toEqual(['shared-id']);
  });
});
