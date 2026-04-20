import { describe, it, expect, vi } from 'vitest';
import {
  runSourceAdd,
  validateSourceAddOpts,
  type SourceAddClient,
  type SourceAddOpts,
} from '../src/commands/source-add.js';

function makeClient(): SourceAddClient & {
  addFileSource: ReturnType<typeof vi.fn>;
  addUrlSource: ReturnType<typeof vi.fn>;
  addTextSource: ReturnType<typeof vi.fn>;
} {
  return {
    addFileSource: vi.fn().mockResolvedValue({ sourceId: 'file-1', title: 'file.pdf' }),
    addUrlSource: vi.fn().mockResolvedValue({ sourceId: 'url-1', title: 'Example' }),
    addTextSource: vi.fn().mockResolvedValue({ sourceId: 'text-1', title: 'Pasted Text' }),
  };
}

describe('validateSourceAddOpts', () => {
  it('rejects when no flag given', () => {
    expect(() => validateSourceAddOpts({})).toThrow(/exactly one/);
  });

  it('rejects when two flags given', () => {
    expect(() => validateSourceAddOpts({ file: 'a.pdf', url: 'https://x' })).toThrow(/exactly one/);
  });

  it('rejects when all three flags given', () => {
    expect(() => validateSourceAddOpts({ file: 'a.pdf', url: 'https://x', text: 'hi' })).toThrow(
      /exactly one/,
    );
  });

  it('accepts a single flag', () => {
    expect(() => validateSourceAddOpts({ file: 'a.pdf' })).not.toThrow();
    expect(() => validateSourceAddOpts({ url: 'https://x' })).not.toThrow();
    expect(() => validateSourceAddOpts({ text: 'hello' })).not.toThrow();
  });

  it('rejects empty text', () => {
    expect(() => validateSourceAddOpts({ text: '' })).toThrow(/must not be empty/);
  });

  it('rejects whitespace-only text', () => {
    expect(() => validateSourceAddOpts({ text: '   \n\t' })).toThrow(/must not be empty/);
  });

  it('rejects --title without --text', () => {
    expect(() => validateSourceAddOpts({ file: 'a.pdf', title: 'My Note' })).toThrow(
      /--title only applies to --text/,
    );
  });

  it('accepts --title with --text', () => {
    expect(() => validateSourceAddOpts({ text: 'hello', title: 'My Note' })).not.toThrow();
  });
});

describe('runSourceAdd dispatch', () => {
  it('dispatches --file to addFileSource', async () => {
    const client = makeClient();
    const result = await runSourceAdd(client, 'nb-1', { file: '/tmp/a.pdf' });
    expect(client.addFileSource).toHaveBeenCalledWith('nb-1', '/tmp/a.pdf');
    expect(client.addUrlSource).not.toHaveBeenCalled();
    expect(client.addTextSource).not.toHaveBeenCalled();
    expect(result).toEqual({ sourceId: 'file-1', title: 'file.pdf' });
  });

  it('dispatches --url to addUrlSource', async () => {
    const client = makeClient();
    const result = await runSourceAdd(client, 'nb-1', { url: 'https://example.com/a.pdf' });
    expect(client.addUrlSource).toHaveBeenCalledWith('nb-1', 'https://example.com/a.pdf');
    expect(client.addFileSource).not.toHaveBeenCalled();
    expect(client.addTextSource).not.toHaveBeenCalled();
    expect(result).toEqual({ sourceId: 'url-1', title: 'Example' });
  });

  it('dispatches --text with default title', async () => {
    const client = makeClient();
    await runSourceAdd(client, 'nb-1', { text: 'hello world' });
    expect(client.addTextSource).toHaveBeenCalledWith('nb-1', 'Pasted Text', 'hello world');
  });

  it('dispatches --text with custom --title', async () => {
    const client = makeClient();
    await runSourceAdd(client, 'nb-1', { text: 'hello world', title: 'My Note' });
    expect(client.addTextSource).toHaveBeenCalledWith('nb-1', 'My Note', 'hello world');
  });

  it('validates before dispatching', async () => {
    const client = makeClient();
    await expect(runSourceAdd(client, 'nb-1', {})).rejects.toThrow(/exactly one/);
    expect(client.addFileSource).not.toHaveBeenCalled();
    expect(client.addUrlSource).not.toHaveBeenCalled();
    expect(client.addTextSource).not.toHaveBeenCalled();
  });
});
