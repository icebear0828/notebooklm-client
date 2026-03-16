#!/usr/bin/env node

/**
 * NotebookLM CLI — generate podcasts, analyze content, and more.
 */

import { Command } from 'commander';
import { NotebookClient } from './client.js';
import type { TransportMode } from './client.js';
import { setHomeDir } from './paths.js';
import type { SourceInput, WorkflowProgress } from './types.js';

const program = new Command();

program
  .name('notebooklm')
  .description('Standalone NotebookLM client — generate podcasts, flashcards, mind maps via Google NotebookLM')
  .version('0.2.0')
  .option('--home <dir>', 'Config directory (default: ~/.notebooklm, or NOTEBOOKLM_HOME env)')
  .hook('preAction', () => {
    const home = program.opts().home as string | undefined;
    if (home) setHomeDir(home);
  });

// ── Shared Options ──

function addBrowserOptions(cmd: Command): Command {
  return cmd
    .option('--transport <mode>', 'Transport: browser | auto | curl-impersonate | tls-client | http (default: browser)')
    .option('--session-path <path>', 'Session file path for non-browser modes')
    .option('--curl-path <path>', 'Path to curl-impersonate binary')
    .option('--profile <dir>', 'Chrome profile directory (default: ~/.notebooklm/chrome-profile)')
    .option('--headless', 'Run in headless mode')
    .option('--chrome-path <path>', 'Path to Chrome executable');
}

function addSourceOptions(cmd: Command): Command {
  return cmd
    .option('--url <url>', 'Source URL')
    .option('--text <text>', 'Source text content')
    .option('--topic <topic>', 'Research topic')
    .option('--research-mode <mode>', 'Research mode: fast or deep', 'fast');
}

function buildSource(opts: { url?: string; text?: string; topic?: string; researchMode?: string }): SourceInput {
  if (opts.url) return { type: 'url', url: opts.url };
  if (opts.text) return { type: 'text', text: opts.text };
  if (opts.topic) return { type: 'research', topic: opts.topic, researchMode: (opts.researchMode as 'fast' | 'deep') ?? 'fast' };
  throw new Error('Must specify --url, --text, or --topic');
}

async function withClient(
  opts: { transport?: string; sessionPath?: string; curlPath?: string; profile?: string; headless?: boolean; chromePath?: string },
  fn: (client: NotebookClient) => Promise<void>,
): Promise<void> {
  const client = new NotebookClient();
  try {
    await client.connect({
      transport: (opts.transport as TransportMode) ?? 'browser',
      sessionPath: opts.sessionPath,
      curlBinaryPath: opts.curlPath,
      profileDir: opts.profile,
      headless: opts.headless,
      executablePath: opts.chromePath,
    });
    await fn(client);
  } finally {
    await client.disconnect();
  }
}

function progressLogger(p: WorkflowProgress): void {
  console.error(`[${p.status}] ${p.message}`);
}

// ── Export-Session Command ──

const exportSessionCmd = new Command('export-session')
  .description('Launch browser, log in, and export session for HTTP mode');

addBrowserOptions(exportSessionCmd)
  .option('-o, --output <path>', 'Output session file path')
  .action(async (opts) => {
    const client = new NotebookClient();
    try {
      await client.connect({
        transport: 'browser',
        profileDir: opts.profile,
        headless: opts.headless,
        executablePath: opts.chromePath,
      });
      const path = await client.exportSession(opts.output);
      console.log(path);
      console.error('Session exported. You can now use --transport http');
    } finally {
      await client.disconnect();
    }
  });

program.addCommand(exportSessionCmd);

// ── Audio Command ──

const audioCmd = new Command('audio')
  .description('Generate an audio podcast from source material');

addBrowserOptions(addSourceOptions(audioCmd))
  .requiredOption('-o, --output <dir>', 'Output directory')
  .option('-l, --language <lang>', 'Audio language', 'en')
  .option('--custom-prompt <prompt>', 'Custom generation prompt')
  .option('--keep-notebook', 'Do not delete the notebook after completion')
  .action(async (opts) => {
    const source = buildSource(opts);
    await withClient(opts, async (client) => {
      const result = await client.runAudioOverview(
        {
          source,
          outputDir: opts.output,
          language: opts.language,
          customPrompt: opts.customPrompt,
        },
        progressLogger,
      );
      // Output result path to stdout (machine-readable)
      console.log(result.audioPath);
      console.error(`Notebook: ${result.notebookUrl}`);
    });
  });

program.addCommand(audioCmd);

// ── Analyze Command ──

const analyzeCmd = new Command('analyze')
  .description('Analyze source material with a question');

addBrowserOptions(addSourceOptions(analyzeCmd))
  .requiredOption('--question <q>', 'Question to ask about the source')
  .action(async (opts) => {
    const source = buildSource(opts);
    await withClient(opts, async (client) => {
      const result = await client.runAnalyze(
        { source, question: opts.question },
        progressLogger,
      );
      console.log(result.answer);
      console.error(`Notebook: ${result.notebookUrl}`);
    });
  });

program.addCommand(analyzeCmd);

// ── List Command ──

const listCmd = new Command('list')
  .description('List all notebooks');

addBrowserOptions(listCmd)
  .action(async (opts) => {
    await withClient(opts, async (client) => {
      const notebooks = await client.listNotebooks();
      if (notebooks.length === 0) {
        console.error('No notebooks found.');
        return;
      }
      for (const nb of notebooks) {
        const sources = nb.sourceCount !== undefined ? ` (${nb.sourceCount} sources)` : '';
        console.log(`${nb.id}  ${nb.title}${sources}`);
      }
    });
  });

program.addCommand(listCmd);

// ── Detail Command ──

const detailCmd = new Command('detail')
  .description('Show notebook details')
  .argument('<notebook-id>', 'Notebook ID');

addBrowserOptions(detailCmd)
  .action(async (notebookId: string, opts) => {
    await withClient(opts, async (client) => {
      const detail = await client.getNotebookDetail(notebookId);
      console.log(`Title: ${detail.title}`);
      console.log(`Sources (${detail.sources.length}):`);
      for (const src of detail.sources) {
        const words = src.wordCount !== undefined ? ` [${src.wordCount} words]` : '';
        const url = src.url ? ` ${src.url}` : '';
        console.log(`  ${src.id}  ${src.title}${words}${url}`);
      }
    });
  });

program.addCommand(detailCmd);

// ── Chat Command ──

const chatCmd = new Command('chat')
  .description('Chat with a notebook')
  .argument('<notebook-id>', 'Notebook ID');

addBrowserOptions(chatCmd)
  .requiredOption('--question <q>', 'Question to ask')
  .option('--source-ids <ids>', 'Comma-separated source IDs (default: all)')
  .action(async (notebookId: string, opts) => {
    await withClient(opts, async (client) => {
      const detail = await client.getNotebookDetail(notebookId);
      const sourceIds = opts.sourceIds
        ? (opts.sourceIds as string).split(',')
        : detail.sources.map((s) => s.id);

      const result = await client.sendChat(notebookId, opts.question, sourceIds);
      console.log(result.text);
    });
  });

program.addCommand(chatCmd);

// ── Run ──

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
