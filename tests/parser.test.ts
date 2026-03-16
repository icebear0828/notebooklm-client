import { describe, it, expect } from 'vitest';
import {
  parseCreateNotebook,
  parseListNotebooks,
  parseNotebookDetail,
  parseAddSource,
  parseGenerateArtifact,
  parseArtifacts,
  parseChatStream,
  parseSourceSummary,
} from '../src/parser.js';

function wrapEnvelope(rpcId: string, inner: unknown): string {
  return ")]}'\n999\n" + JSON.stringify([['wrb.fr', rpcId, JSON.stringify(inner), null]]);
}

describe('parseCreateNotebook', () => {
  it('extracts notebook ID from position [2]', () => {
    const raw = wrapEnvelope('CCqFvf', ['', null, 'abc-def-123']);
    const result = parseCreateNotebook(raw);
    expect(result.notebookId).toBe('abc-def-123');
  });

  it('throws on missing ID', () => {
    const raw = wrapEnvelope('CCqFvf', ['', null, '']);
    expect(() => parseCreateNotebook(raw)).toThrow('Failed to parse notebook ID');
  });
});

describe('parseListNotebooks', () => {
  it('extracts notebooks with UUID IDs', () => {
    const raw = wrapEnvelope('wXbhsf', [
      [
        ['My Notebook', [['s1'], ['s2']], '12345678-abcd-1234-abcd-123456789abc'],
        ['Another', [], '87654321-dcba-4321-dcba-cba987654321'],
      ],
    ]);
    const notebooks = parseListNotebooks(raw);
    expect(notebooks).toHaveLength(2);
    expect(notebooks[0]!.title).toBe('My Notebook');
    expect(notebooks[0]!.id).toBe('12345678-abcd-1234-abcd-123456789abc');
    expect(notebooks[0]!.sourceCount).toBe(2);
  });

  it('returns empty for invalid data', () => {
    const raw = wrapEnvelope('wXbhsf', null);
    expect(parseListNotebooks(raw)).toEqual([]);
  });
});

describe('parseNotebookDetail', () => {
  it('extracts title and sources', () => {
    const raw = wrapEnvelope('rLM1Ne', [
      ['Test Notebook', [
        [['src-id-1'], 'Source 1', [null, 1500]],
        [['src-id-2'], 'Source 2', [null, 3000, null, null, null, null, null, ['https://example.com']]],
      ], 'nb-uuid'],
    ]);
    const detail = parseNotebookDetail(raw);
    expect(detail.title).toBe('Test Notebook');
    expect(detail.sources).toHaveLength(2);
    expect(detail.sources[0]!.id).toBe('src-id-1');
    expect(detail.sources[0]!.wordCount).toBe(1500);
    expect(detail.sources[1]!.url).toBe('https://example.com');
  });
});

describe('parseAddSource', () => {
  it('extracts source ID and title', () => {
    const raw = wrapEnvelope('izAoDd', [
      [[['source-uuid-123'], 'Wikipedia: TypeScript']],
    ]);
    const result = parseAddSource(raw);
    expect(result.sourceId).toBe('source-uuid-123');
    expect(result.title).toBe('Wikipedia: TypeScript');
  });
});

describe('parseGenerateArtifact', () => {
  it('extracts artifact ID and title', () => {
    const raw = wrapEnvelope('R7cb6c', [
      ['artifact-uuid-456', 'Deep Dive Audio', 1],
    ]);
    const result = parseGenerateArtifact(raw);
    expect(result.artifactId).toBe('artifact-uuid-456');
    expect(result.title).toBe('Deep Dive Audio');
  });
});

describe('parseArtifacts', () => {
  it('extracts artifacts with media URLs', () => {
    const downloadUrl = 'https://lh3.googleusercontent.com/notebooklm/test=m140-dv';
    const streamUrl = 'https://lh3.googleusercontent.com/notebooklm/test=m140';

    const raw = wrapEnvelope('gArtLc', [
      [
        ['art-1', 'Audio', 1, [[['src-1']]], null, null,
          [null, [null, 2, null, [['src-1']], 'en', null, 1],
            downloadUrl, streamUrl, true,
            [[downloadUrl, 4, 'audio/mp4'], [streamUrl, 1, 'audio/mp4']],
            [300, 5000000],
          ],
        ],
      ],
    ]);
    const artifacts = parseArtifacts(raw);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.id).toBe('art-1');
    expect(artifacts[0]!.downloadUrl).toBe(downloadUrl);
    expect(artifacts[0]!.streamUrl).toBe(streamUrl);
    expect(artifacts[0]!.durationSeconds).toBe(300);
    expect(artifacts[0]!.sourceIds).toEqual(['src-1']);
  });

  it('returns empty for invalid data', () => {
    const raw = wrapEnvelope('gArtLc', null);
    expect(parseArtifacts(raw)).toEqual([]);
  });
});

describe('parseChatStream', () => {
  it('extracts last text and thread ID', () => {
    const chunk1 = ['Thinking...', null, ['thread-1', 'resp-1', 1]];
    const chunk2 = ['Here is my full answer about TypeScript.', null, ['thread-1', 'resp-1', 2]];

    const raw = ")]}'\n999\n" + JSON.stringify([
      ['wrb.fr', null, JSON.stringify(chunk1), null],
      ['wrb.fr', null, JSON.stringify(chunk2), null],
    ]);

    const result = parseChatStream(raw);
    expect(result.text).toBe('Here is my full answer about TypeScript.');
    expect(result.threadId).toBe('thread-1');
    expect(result.responseId).toBe('resp-1');
  });
});

describe('parseSourceSummary', () => {
  it('extracts source ID and summary', () => {
    const raw = wrapEnvelope('tr032e', [
      [[['src-uuid']]],
      'This source discusses TypeScript fundamentals.',
    ]);
    const result = parseSourceSummary(raw);
    expect(result.sourceId).toBe('src-uuid');
    expect(result.summary).toBe('This source discusses TypeScript fundamentals.');
  });
});
