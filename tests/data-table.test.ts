import { describe, it, expect } from 'vitest';
import {
  extractTableRows,
  extractDataTableCsv,
  isDataTableReady,
} from '../src/download.js';

function metaWithSection18(section18: unknown): unknown[] {
  const meta: unknown[] = Array(19).fill(null);
  meta[18] = section18;
  return meta;
}

describe('isDataTableReady', () => {
  it('rejects when meta has no section 18', () => {
    expect(isDataTableReady([])).toBe(false);
  });

  it('rejects when section 18 is not an array', () => {
    expect(isDataTableReady(metaWithSection18('not-array'))).toBe(false);
    expect(isDataTableReady(metaWithSection18(null))).toBe(false);
  });

  it('rejects an empty section (section[0] is undefined)', () => {
    expect(isDataTableReady(metaWithSection18([]))).toBe(false);
  });

  it('rejects the initial placeholder [null, [prompt, lang]]', () => {
    const meta = metaWithSection18([null, ['Render a revenue table', 'en']]);
    expect(isDataTableReady(meta)).toBe(false);
  });

  it('rejects a placeholder whose data slot is a non-array value', () => {
    const meta = metaWithSection18(['loading', ['Render a revenue table', 'en']]);
    expect(isDataTableReady(meta)).toBe(false);
  });

  it('rejects a placeholder whose data slot is an empty array', () => {
    const meta = metaWithSection18([[], ['Render a revenue table', 'en']]);
    expect(isDataTableReady(meta)).toBe(false);
  });

  it('accepts fully populated section with data node and prompt echo', () => {
    const meta = metaWithSection18([
      [['h1', 'h2'], ['a', 'b']],
      ['Render a revenue table', 'en'],
    ]);
    expect(isDataTableReady(meta)).toBe(true);
  });

  it('accepts a section whose only entry is the data node', () => {
    const meta = metaWithSection18([[['h1', 'h2']]]);
    expect(isDataTableReady(meta)).toBe(true);
  });
});

describe('extractTableRows', () => {
  it('returns no rows for an empty array', () => {
    expect(extractTableRows([])).toEqual([]);
  });

  it('treats a flat array of nulls as a row of empty cells', () => {
    expect(extractTableRows([null, null])).toEqual([['', '']]);
  });

  it('extracts a single flat row', () => {
    expect(extractTableRows([['a', 'b', 'c']])).toEqual([['a', 'b', 'c']]);
  });

  it('extracts multiple rows from a nested structure', () => {
    const input = [
      [
        ['h1', 'h2', 'h3'],
        ['r1c1', 'r1c2', 'r1c3'],
        ['r2c1', 'r2c2', 'r2c3'],
      ],
    ];
    expect(extractTableRows(input)).toEqual([
      ['h1', 'h2', 'h3'],
      ['r1c1', 'r1c2', 'r1c3'],
      ['r2c1', 'r2c2', 'r2c3'],
    ]);
  });

  it('stringifies numbers and blanks out nulls in cells', () => {
    expect(extractTableRows([['a', 1, null]])).toEqual([['a', '1', '']]);
  });
});

describe('extractDataTableCsv', () => {
  it('returns null for placeholder meta (section[0] is null)', () => {
    const meta = metaWithSection18([null, ['Render a revenue table', 'en']]);
    expect(extractDataTableCsv(meta)).toBeNull();
  });

  it('returns null when meta has no section 18', () => {
    expect(extractDataTableCsv([])).toBeNull();
  });

  it('returns null when section 18 is not an array', () => {
    expect(extractDataTableCsv(metaWithSection18('junk'))).toBeNull();
  });

  it('returns null when the data node is empty', () => {
    const meta = metaWithSection18([[], ['Render a revenue table', 'en']]);
    expect(extractDataTableCsv(meta)).toBeNull();
  });

  it('ignores the [prompt, lang] echo at section[1]', () => {
    const meta = metaWithSection18([
      [
        ['Revenue', '2024', '2025'],
        ['Product A', '100', '120'],
      ],
      ['Render revenue by product', 'en'],
    ]);
    const csv = extractDataTableCsv(meta);
    expect(csv).not.toBeNull();
    expect(csv).not.toContain('Render revenue by product');
    expect(csv).toBe('"Revenue","2024","2025"\n"Product A","100","120"');
  });

  it('escapes embedded double quotes by doubling them', () => {
    const meta = metaWithSection18([[['simple', 'with "quotes"', 'with,comma']]]);
    expect(extractDataTableCsv(meta)).toBe('"simple","with ""quotes""","with,comma"');
  });
});
