export interface SourceAddOpts {
  file?: string;
  url?: string;
  text?: string;
  title?: string;
}

export interface SourceAddClient {
  addFileSource(notebookId: string, filePath: string): Promise<{ sourceId: string; title: string }>;
  addUrlSource(notebookId: string, url: string): Promise<{ sourceId: string; title: string }>;
  addTextSource(notebookId: string, title: string, content: string): Promise<{ sourceId: string; title: string }>;
}

export function validateSourceAddOpts(opts: SourceAddOpts): void {
  const provided = [opts.file, opts.url, opts.text].filter((v) => v !== undefined).length;
  if (provided !== 1) {
    throw new Error('Specify exactly one of --file, --url, or --text');
  }
  if (opts.text !== undefined && opts.text.trim().length === 0) {
    throw new Error('--text must not be empty');
  }
  if (opts.title !== undefined && opts.text === undefined) {
    throw new Error('--title only applies to --text');
  }
}

export async function runSourceAdd(
  client: SourceAddClient,
  notebookId: string,
  opts: SourceAddOpts,
): Promise<{ sourceId: string; title: string }> {
  validateSourceAddOpts(opts);
  if (opts.file !== undefined) {
    return client.addFileSource(notebookId, opts.file);
  }
  if (opts.url !== undefined) {
    return client.addUrlSource(notebookId, opts.url);
  }
  return client.addTextSource(notebookId, opts.title ?? 'Pasted Text', opts.text as string);
}
