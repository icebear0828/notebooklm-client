import type { ResearchMode, SourceInput } from '../types.js';

export interface SourceInputOpts {
  url?: string;
  text?: string;
  file?: string;
  topic?: string;
  researchMode?: string;
}

export function validateSourceInputOpts(opts: SourceInputOpts): void {
  const provided = [opts.url, opts.text, opts.file, opts.topic].filter((value) => value !== undefined).length;
  if (provided !== 1) {
    throw new Error('Specify exactly one of --url, --text, --file, or --topic');
  }
  if (opts.text !== undefined && opts.text.trim().length === 0) {
    throw new Error('--text must not be empty');
  }
}

export function buildSourceInput(opts: SourceInputOpts): SourceInput {
  validateSourceInputOpts(opts);
  if (opts.url !== undefined) return { type: 'url', url: opts.url };
  if (opts.text !== undefined) return { type: 'text', text: opts.text };
  if (opts.file !== undefined) return { type: 'file', filePath: opts.file };
  if (opts.topic === undefined) {
    throw new Error('Specify exactly one of --url, --text, --file, or --topic');
  }
  return {
    type: 'research',
    topic: opts.topic,
    researchMode: resolveResearchMode(opts.researchMode),
  };
}

function resolveResearchMode(mode?: string): ResearchMode {
  return mode === 'deep' ? 'deep' : 'fast';
}
