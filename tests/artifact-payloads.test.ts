import { describe, it, expect } from 'vitest';
import {
  buildArtifactPayload,
  buildAudioPayload,
  buildReportPayload,
  buildVideoPayload,
  buildQuizPayload,
  buildFlashcardsPayload,
  buildInfographicPayload,
  buildSlideDeckPayload,
  buildDataTablePayload,
  REPORT_TEMPLATES,
} from '../src/artifact-payloads.js';

const sidsTriple = [[['sid1']], [['sid2']]];
const sidsDouble = [['sid1'], ['sid2']];

describe('buildAudioPayload', () => {
  it('should build correct payload with defaults', () => {
    const result = buildAudioPayload(sidsTriple, sidsDouble, {
      type: 'audio',
      language: 'en',
    });
    expect(result).toEqual([
      null, null, 1, sidsTriple, null, null,
      [null, [null, null, null, sidsDouble, 'en', null, 1]],
    ]);
  });

  it('should map instructions, format and length', () => {
    const result = buildAudioPayload(sidsTriple, sidsDouble, {
      type: 'audio',
      language: 'ja',
      instructions: 'Focus on AI trends',
      format: 'debate',
      length: 'long',
    });
    expect(result).toEqual([
      null, null, 1, sidsTriple, null, null,
      [null, ['Focus on AI trends', 3, null, sidsDouble, 'ja', null, 4]],
    ]);
  });

  it('should map all format values', () => {
    const formats = { deep_dive: 1, brief: 2, critique: 3, debate: 4 } as const;
    for (const [name, code] of Object.entries(formats)) {
      const result = buildAudioPayload(sidsTriple, sidsDouble, {
        type: 'audio',
        language: 'en',
        format: name as 'deep_dive' | 'brief' | 'critique' | 'debate',
      });
      expect(result[6]).toEqual([null, [null, null, null, sidsDouble, 'en', null, code]]);
    }
  });

  it('should map all length values', () => {
    const lengths = { short: 1, default: 2, long: 3 } as const;
    for (const [name, code] of Object.entries(lengths)) {
      const result = buildAudioPayload(sidsTriple, sidsDouble, {
        type: 'audio',
        language: 'en',
        length: name as 'short' | 'default' | 'long',
      });
      const inner = (result[6] as unknown[])[1] as unknown[];
      expect(inner[1]).toBe(code);
    }
  });
});

describe('buildReportPayload', () => {
  it('should build briefing_doc payload with template defaults', () => {
    const result = buildReportPayload(sidsTriple, sidsDouble, {
      type: 'report',
      language: 'en',
    });
    const tmpl = REPORT_TEMPLATES.briefing_doc;
    expect(result).toEqual([
      null, null, 2, sidsTriple, null, null, null,
      [null, [tmpl.title, tmpl.description, null, sidsDouble, 'en', tmpl.prompt, null, true]],
    ]);
  });

  it('should append extra instructions to template prompt', () => {
    const result = buildReportPayload(sidsTriple, sidsDouble, {
      type: 'report',
      template: 'study_guide',
      instructions: 'Include diagrams',
      language: 'zh',
    });
    const tmpl = REPORT_TEMPLATES.study_guide;
    const inner = (result[7] as unknown[])[1] as unknown[];
    expect(inner[0]).toBe(tmpl.title);
    expect(inner[1]).toBe(tmpl.description);
    expect(inner[4]).toBe('zh');
    expect(inner[5]).toBe(`${tmpl.prompt}\n\nInclude diagrams`);
  });

  it('should use custom template with user prompt', () => {
    const result = buildReportPayload(sidsTriple, sidsDouble, {
      type: 'report',
      template: 'custom',
      instructions: 'Write a SWOT analysis',
      language: 'en',
    });
    const inner = (result[7] as unknown[])[1] as unknown[];
    expect(inner[0]).toBe('Custom Report');
    expect(inner[5]).toBe('Write a SWOT analysis');
  });

  it('should use custom template default prompt when no instructions', () => {
    const result = buildReportPayload(sidsTriple, sidsDouble, {
      type: 'report',
      template: 'custom',
      language: 'en',
    });
    const inner = (result[7] as unknown[])[1] as unknown[];
    expect(inner[5]).toBe(REPORT_TEMPLATES.custom.prompt);
  });
});

describe('buildVideoPayload', () => {
  it('should build correct payload with defaults', () => {
    const result = buildVideoPayload(sidsTriple, sidsDouble, {
      type: 'video',
      language: 'en',
    });
    expect(result).toEqual([
      null, null, 3, sidsTriple, null, null, null, null,
      [null, null, [sidsDouble, 'en', null, null, null, null]],
    ]);
  });

  it('should map instructions, format and style', () => {
    const result = buildVideoPayload(sidsTriple, sidsDouble, {
      type: 'video',
      language: 'en',
      instructions: 'Make it fun',
      format: 'cinematic',
      style: 'anime',
    });
    const inner = (result[8] as unknown[])[2] as unknown[];
    expect(inner[0]).toEqual(sidsDouble);
    expect(inner[1]).toBe('en');
    expect(inner[2]).toBe('Make it fun');
    expect(inner[4]).toBe(3); // cinematic
    expect(inner[5]).toBe(6); // anime
  });

  it('should map all style values', () => {
    const styles = { auto: 1, classic: 3, whiteboard: 4, kawaii: 5, anime: 6, watercolor: 7, retro_print: 8 } as const;
    for (const [name, code] of Object.entries(styles)) {
      const result = buildVideoPayload(sidsTriple, sidsDouble, {
        type: 'video',
        language: 'en',
        style: name as keyof typeof styles,
      });
      const inner = (result[8] as unknown[])[2] as unknown[];
      expect(inner[5]).toBe(code);
    }
  });
});

describe('buildQuizPayload', () => {
  it('should build correct payload with defaults', () => {
    const result = buildQuizPayload(sidsTriple, sidsDouble, {
      type: 'quiz',
    });
    expect(result).toEqual([
      null, null, 4, sidsTriple, null, null, null, null, null,
      [null, [2, null, null, null, null, null, null, [null, null]]],
    ]);
  });

  it('should map instructions, quantity and difficulty', () => {
    const result = buildQuizPayload(sidsTriple, sidsDouble, {
      type: 'quiz',
      instructions: 'Focus on chapter 3',
      quantity: 'fewer',
      difficulty: 'hard',
    });
    const inner = (result[9] as unknown[])[1] as unknown[];
    expect(inner[0]).toBe(2); // variant = quiz
    expect(inner[2]).toBe('Focus on chapter 3');
    expect(inner[7]).toEqual([1, 3]); // [fewer=1, hard=3]
  });
});

describe('buildFlashcardsPayload', () => {
  it('should build correct payload with defaults', () => {
    const result = buildFlashcardsPayload(sidsTriple, sidsDouble, {
      type: 'flashcards',
    });
    expect(result).toEqual([
      null, null, 4, sidsTriple, null, null, null, null, null,
      [null, [1, null, null, null, null, null, [null, null]]],
    ]);
  });

  it('should map instructions with reversed difficulty/quantity order', () => {
    const result = buildFlashcardsPayload(sidsTriple, sidsDouble, {
      type: 'flashcards',
      instructions: 'Key terms only',
      quantity: 'standard',
      difficulty: 'easy',
    });
    const inner = (result[9] as unknown[])[1] as unknown[];
    expect(inner[0]).toBe(1); // variant = flashcards
    expect(inner[2]).toBe('Key terms only');
    // Flashcards: [difficulty, quantity] — reversed from quiz!
    expect(inner[6]).toEqual([1, 2]); // [easy=1, standard=2]
  });
});

describe('buildInfographicPayload', () => {
  it('should build correct payload with defaults', () => {
    const result = buildInfographicPayload(sidsTriple, sidsDouble, {
      type: 'infographic',
      language: 'en',
    });
    // 14 nulls after sidsTriple, then the config
    expect(result[0]).toBeNull();
    expect(result[2]).toBe(7);
    expect(result[3]).toEqual(sidsTriple);
    expect(result[14]).toEqual([[null, 'en', null, null, null, null]]);
  });

  it('should map all options', () => {
    const result = buildInfographicPayload(sidsTriple, sidsDouble, {
      type: 'infographic',
      language: 'ja',
      instructions: 'Use bright colors',
      orientation: 'portrait',
      detail: 'detailed',
      style: 'bento_grid',
    });
    const config = (result[14] as unknown[][])[0] as unknown[];
    expect(config[0]).toBe('Use bright colors');
    expect(config[1]).toBe('ja');
    expect(config[3]).toBe(2); // portrait
    expect(config[4]).toBe(3); // detailed
    expect(config[5]).toBe(4); // bento_grid
  });

  it('should map all style values', () => {
    const styles = { sketch_note: 2, professional: 3, bento_grid: 4 } as const;
    for (const [name, code] of Object.entries(styles)) {
      const result = buildInfographicPayload(sidsTriple, sidsDouble, {
        type: 'infographic',
        language: 'en',
        style: name as keyof typeof styles,
      });
      const config = (result[14] as unknown[][])[0] as unknown[];
      expect(config[5]).toBe(code);
    }
  });
});

describe('buildSlideDeckPayload', () => {
  it('should build correct payload with defaults', () => {
    const result = buildSlideDeckPayload(sidsTriple, sidsDouble, {
      type: 'slide_deck',
      language: 'en',
    });
    expect(result[0]).toBeNull();
    expect(result[2]).toBe(8);
    expect(result[3]).toEqual(sidsTriple);
    expect(result[16]).toEqual([[null, 'en', null, null]]);
  });

  it('should map all options', () => {
    const result = buildSlideDeckPayload(sidsTriple, sidsDouble, {
      type: 'slide_deck',
      language: 'ko',
      instructions: 'Keep it concise',
      format: 'presenter',
      length: 'short',
    });
    const config = (result[16] as unknown[][])[0] as unknown[];
    expect(config[0]).toBe('Keep it concise');
    expect(config[1]).toBe('ko');
    expect(config[2]).toBe(2); // presenter
    expect(config[3]).toBe(2); // short
  });
});

describe('buildDataTablePayload', () => {
  it('should build correct payload with defaults', () => {
    const result = buildDataTablePayload(sidsTriple, sidsDouble, {
      type: 'data_table',
      language: 'en',
    });
    expect(result[0]).toBeNull();
    expect(result[2]).toBe(9);
    expect(result[3]).toEqual(sidsTriple);
    // After sidsTriple: 14 nulls, then config at index 18
    expect(result[18]).toEqual([null, [null, 'en']]);
  });

  it('should map instructions', () => {
    const result = buildDataTablePayload(sidsTriple, sidsDouble, {
      type: 'data_table',
      language: 'zh',
      instructions: 'Compare pricing by region',
    });
    const config = (result[18] as unknown[])[1] as unknown[];
    expect(config[0]).toBe('Compare pricing by region');
    expect(config[1]).toBe('zh');
  });
});

describe('buildArtifactPayload (dispatcher)', () => {
  it('should dispatch audio type correctly', () => {
    const result = buildArtifactPayload(sidsTriple, sidsDouble, {
      type: 'audio',
      language: 'en',
    });
    expect(result[2]).toBe(1);
  });

  it('should dispatch report type correctly', () => {
    const result = buildArtifactPayload(sidsTriple, sidsDouble, {
      type: 'report',
      language: 'en',
    });
    expect(result[2]).toBe(2);
  });

  it('should dispatch video type correctly', () => {
    const result = buildArtifactPayload(sidsTriple, sidsDouble, {
      type: 'video',
      language: 'en',
    });
    expect(result[2]).toBe(3);
  });

  it('should dispatch quiz type correctly', () => {
    const result = buildArtifactPayload(sidsTriple, sidsDouble, {
      type: 'quiz',
    });
    expect(result[2]).toBe(4);
  });

  it('should dispatch flashcards type correctly', () => {
    const result = buildArtifactPayload(sidsTriple, sidsDouble, {
      type: 'flashcards',
    });
    expect(result[2]).toBe(4);
  });

  it('should dispatch infographic type correctly', () => {
    const result = buildArtifactPayload(sidsTriple, sidsDouble, {
      type: 'infographic',
      language: 'en',
    });
    expect(result[2]).toBe(7);
  });

  it('should dispatch slide_deck type correctly', () => {
    const result = buildArtifactPayload(sidsTriple, sidsDouble, {
      type: 'slide_deck',
      language: 'en',
    });
    expect(result[2]).toBe(8);
  });

  it('should dispatch data_table type correctly', () => {
    const result = buildArtifactPayload(sidsTriple, sidsDouble, {
      type: 'data_table',
      language: 'en',
    });
    expect(result[2]).toBe(9);
  });
});
