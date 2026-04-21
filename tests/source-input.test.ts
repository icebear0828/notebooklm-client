import { describe, it, expect } from 'vitest';
import { buildSourceInput, validateSourceInputOpts } from '../src/commands/source-input.js';

describe('validateSourceInputOpts', () => {
  it('rejects when no source flag is given', () => {
    expect(() => validateSourceInputOpts({})).toThrow(/exactly one/);
  });

  it('rejects when multiple source flags are given', () => {
    expect(() => validateSourceInputOpts({ url: 'https://example.com', file: '/tmp/a.pdf' })).toThrow(/exactly one/);
    expect(() => validateSourceInputOpts({ text: 'hello', topic: 'ai' })).toThrow(/exactly one/);
  });

  it('rejects empty text', () => {
    expect(() => validateSourceInputOpts({ text: '' })).toThrow(/must not be empty/);
    expect(() => validateSourceInputOpts({ text: '   \n\t' })).toThrow(/must not be empty/);
  });
});

describe('buildSourceInput', () => {
  it('builds a url source', () => {
    expect(buildSourceInput({ url: 'https://example.com' })).toEqual({
      type: 'url',
      url: 'https://example.com',
    });
  });

  it('builds a text source', () => {
    expect(buildSourceInput({ text: 'hello' })).toEqual({
      type: 'text',
      text: 'hello',
    });
  });

  it('builds a file source', () => {
    expect(buildSourceInput({ file: '/tmp/a.pdf' })).toEqual({
      type: 'file',
      filePath: '/tmp/a.pdf',
    });
  });

  it('builds a research source with default mode', () => {
    expect(buildSourceInput({ topic: 'quantum computing' })).toEqual({
      type: 'research',
      topic: 'quantum computing',
      researchMode: 'fast',
    });
  });

  it('builds a research source with explicit mode', () => {
    expect(buildSourceInput({ topic: 'quantum computing', researchMode: 'deep' })).toEqual({
      type: 'research',
      topic: 'quantum computing',
      researchMode: 'deep',
    });
  });
});
