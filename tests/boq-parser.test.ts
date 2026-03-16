import { describe, it, expect } from 'vitest';
import { stripSafetyPrefix, extractJsonChunks, parseEnvelopes } from '../src/boq-parser.js';

describe('stripSafetyPrefix', () => {
  it('strips anti-XSSI prefix', () => {
    expect(stripSafetyPrefix(")]}'\n123\n[[\"wrb.fr\"]]")).toBe('123\n[["wrb.fr"]]');
  });

  it('returns trimmed string when no prefix', () => {
    expect(stripSafetyPrefix('  hello  ')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(stripSafetyPrefix('')).toBe('');
  });
});

describe('extractJsonChunks', () => {
  it('extracts single-line chunk after length', () => {
    const body = '42\n[["wrb.fr","test","{\\"a\\":1}",null,null]]';
    const chunks = extractJsonChunks(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]![0]).toEqual(['wrb.fr', 'test', '{"a":1}', null, null]);
  });

  it('extracts multiple chunks', () => {
    const body = [
      '10',
      '[["a","b"]]',
      '10',
      '[["c","d"]]',
    ].join('\n');
    const chunks = extractJsonChunks(body);
    expect(chunks).toHaveLength(2);
  });

  it('skips non-JSON lines gracefully', () => {
    const body = 'garbage\n10\n[["wrb.fr"]]';
    const chunks = extractJsonChunks(body);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty body', () => {
    expect(extractJsonChunks('')).toEqual([]);
  });
});

describe('parseEnvelopes', () => {
  it('extracts inner JSON from wrb.fr envelopes', () => {
    const raw = ")]}'\n50\n" + JSON.stringify([['wrb.fr', 'CCqFvf', JSON.stringify(['', null, 'abc-123']), null]]);
    const envelopes = parseEnvelopes(raw);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toEqual(['', null, 'abc-123']);
  });

  it('handles multiple envelopes in one chunk', () => {
    const chunk = [
      ['wrb.fr', 'A', JSON.stringify([1, 2]), null],
      ['wrb.fr', 'B', JSON.stringify([3, 4]), null],
    ];
    const raw = ")]}'\n999\n" + JSON.stringify(chunk);
    const envelopes = parseEnvelopes(raw);
    expect(envelopes).toHaveLength(2);
    expect(envelopes[0]).toEqual([1, 2]);
    expect(envelopes[1]).toEqual([3, 4]);
  });

  it('skips non-wrb.fr entries', () => {
    const chunk = [
      ['di', 123],
      ['wrb.fr', 'X', JSON.stringify(['ok']), null],
    ];
    const raw = ")]}'\n999\n" + JSON.stringify(chunk);
    const envelopes = parseEnvelopes(raw);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toEqual(['ok']);
  });

  it('skips malformed inner JSON', () => {
    const chunk = [
      ['wrb.fr', 'X', 'not-json{{{', null],
    ];
    const raw = ")]}'\n999\n" + JSON.stringify(chunk);
    const envelopes = parseEnvelopes(raw);
    expect(envelopes).toHaveLength(0);
  });

  it('returns empty for completely invalid input', () => {
    expect(parseEnvelopes('')).toEqual([]);
    expect(parseEnvelopes('garbage')).toEqual([]);
  });
});
