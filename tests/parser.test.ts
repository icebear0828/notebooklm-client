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
  parseStudioConfig,
  parseQuota,
  parseResearchResults,
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

  it('extracts source ID from file source RPC (no title)', () => {
    // ADD_SOURCE_FILE (o4cbdc) returns sourceId but no title
    const raw = wrapEnvelope('o4cbdc', [
      [[['file-source-uuid-789']]],
    ]);
    const result = parseAddSource(raw);
    expect(result.sourceId).toBe('file-source-uuid-789');
    expect(result.title).toBe('');
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

describe('parseStudioConfig', () => {
  it('extracts audio, explainer, slide, and doc types', () => {
    const raw = wrapEnvelope('sqTeoe', [
      [
        // audioTypes section
        [[[1, 'Deep Dive', 'A conversational deep dive'], [2, 'Briefing', 'A quick summary']]],
        // explainerTypes section
        [[[10, 'Tutorial', 'Step-by-step tutorial']]],
        // slideTypes section
        [[[20, 'Presentation', 'Slide deck']]],
        // docTypes section
        [[['Study Guide', 'Comprehensive study guide'], ['FAQ', 'Frequently asked questions']]],
      ],
    ]);
    const config = parseStudioConfig(raw);
    expect(config.audioTypes).toHaveLength(2);
    expect(config.audioTypes[0]!.id).toBe(1);
    expect(config.audioTypes[0]!.name).toBe('Deep Dive');
    expect(config.audioTypes[1]!.name).toBe('Briefing');
    expect(config.explainerTypes).toHaveLength(1);
    expect(config.slideTypes).toHaveLength(1);
    expect(config.docTypes).toHaveLength(2);
    expect(config.docTypes[0]!.name).toBe('Study Guide');
  });

  it('returns empty arrays for invalid data', () => {
    const raw = wrapEnvelope('sqTeoe', null);
    const config = parseStudioConfig(raw);
    expect(config.audioTypes).toEqual([]);
    expect(config.docTypes).toEqual([]);
  });
});

describe('parseQuota (GetOrCreateAccount)', () => {
  it('should parse free tier account info', () => {
    const raw = wrapEnvelope('ZwVcOc', [
      [null, [1, 100, 50, 500000, 1], [true], [[1]], [false, 1, 1, 1]],
    ]);
    const result = parseQuota(raw);
    expect(result.planType).toBe(1);
    expect(result.notebookLimit).toBe(100);
    expect(result.sourceLimit).toBe(50);
    expect(result.sourceWordLimit).toBe(500000);
    expect(result.isPlus).toBe(false);
  });

  it('should parse plus tier account info', () => {
    const raw = wrapEnvelope('ZwVcOc', [
      [null, [6, 500, 600, 500000, 3], [true], [[1]], [true, 1, 3, 3]],
    ]);
    const result = parseQuota(raw);
    expect(result.planType).toBe(6);
    expect(result.notebookLimit).toBe(500);
    expect(result.sourceLimit).toBe(600);
    expect(result.sourceWordLimit).toBe(500000);
    expect(result.isPlus).toBe(true);
  });
});

describe('parseResearchResults', () => {
  it('extracts completed research results', () => {
    // entry = [researchId, meta, ts1, ts2]
    // meta = [notebookId, [query,1], innerStatus, results, completedStatus]
    const raw = wrapEnvelope('e3bVqc', [[
      ['research-uuid', ['notebook-uuid', ['quantum computing', 1], 1,
        [
          ['https://example.com/article1', 'Quantum Computing 2026', 'Latest breakthroughs', 1],
          ['https://example.com/article2', 'Qubits Explained', 'How qubits work', 1],
        ],
        2,
      ], [1774210380, 566237000], [1774210371, 553385000]],
    ]]);
    const { status, results } = parseResearchResults(raw);
    expect(status).toBe(2);
    expect(results).toHaveLength(2);
    expect(results[0]!.url).toBe('https://example.com/article1');
    expect(results[0]!.title).toBe('Quantum Computing 2026');
    expect(results[0]!.description).toBe('Latest breakthroughs');
    expect(results[1]!.url).toBe('https://example.com/article2');
  });

  it('returns pending status when research is not complete', () => {
    const raw = wrapEnvelope('e3bVqc', [[
      ['research-uuid', ['notebook-uuid', ['query', 1], 1, null, 1], [1774210371, 553385000], [1774210371, 553385000]],
    ]]);
    const { status, results } = parseResearchResults(raw);
    expect(status).toBe(1); // meta[4]=1 means pending
    expect(results).toHaveLength(0);
  });

  it('returns empty for invalid data', () => {
    const raw = wrapEnvelope('e3bVqc', null);
    const { status, results } = parseResearchResults(raw);
    expect(status).toBe(0);
    expect(results).toHaveLength(0);
  });
});
