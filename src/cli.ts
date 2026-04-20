#!/usr/bin/env node

/**
 * NotebookLM CLI — generate podcasts, analyze content, and more.
 */

import { Command } from 'commander';
import { NotebookClient } from './client.js';
import type { TransportMode } from './client.js';
import { setHomeDir } from './paths.js';
import type { SourceInput, WorkflowProgress } from './types.js';
import { ARTIFACT_TYPE } from './rpc-ids.js';

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
    .option('--chrome-path <path>', 'Path to Chrome executable')
    .option('--proxy <url>', 'Proxy URL (http/socks5/socks5h, or set HTTPS_PROXY env)');
}

function resolveProxy(opts: { proxy?: string }): string | undefined {
  return opts.proxy
    ?? process.env['HTTPS_PROXY'] ?? process.env['https_proxy']
    ?? process.env['ALL_PROXY'] ?? process.env['all_proxy']
    ?? undefined;
}

function addSourceOptions(cmd: Command): Command {
  return cmd
    .option('--url <url>', 'Source URL')
    .option('--text <text>', 'Source text content')
    .option('--file <path>', 'Local file path (pdf, txt, md, docx, csv, pptx, epub, mp3, wav, etc.)')
    .option('--topic <topic>', 'Research topic')
    .option('--research-mode <mode>', 'Research mode: fast or deep', 'fast');
}

function buildSource(opts: { url?: string; text?: string; file?: string; topic?: string; researchMode?: string }): SourceInput {
  if (opts.url) return { type: 'url', url: opts.url };
  if (opts.text) return { type: 'text', text: opts.text };
  if (opts.file) return { type: 'file', filePath: opts.file };
  if (opts.topic) return { type: 'research', topic: opts.topic, researchMode: (opts.researchMode as 'fast' | 'deep') ?? 'fast' };
  throw new Error('Must specify --url, --text, --file, or --topic');
}

async function withClient(
  opts: { transport?: string; sessionPath?: string; curlPath?: string; profile?: string; headless?: boolean; chromePath?: string; proxy?: string },
  fn: (client: NotebookClient) => Promise<void>,
): Promise<void> {
  const proxy = resolveProxy(opts);
  const client = new NotebookClient();
  try {
    await client.connect({
      transport: (opts.transport as TransportMode) ?? 'browser',
      sessionPath: opts.sessionPath,
      curlBinaryPath: opts.curlPath,
      profileDir: opts.profile,
      headless: opts.headless,
      executablePath: opts.chromePath,
      proxy,
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
    const proxy = resolveProxy(opts);
    const client = new NotebookClient();
    try {
      await client.connect({
        transport: 'browser',
        profileDir: opts.profile,
        headless: opts.headless,
        executablePath: opts.chromePath,
        proxy,
      });
      const path = await client.exportSession(opts.output);
      console.log(path);
      console.error('Session exported. You can now use --transport http');
    } finally {
      await client.disconnect();
    }
  });

program.addCommand(exportSessionCmd);

// ── Import-Session Command ──

const importSessionCmd = new Command('import-session')
  .description('Import a session from a JSON file or string')
  .argument('<source>', 'Path to session.json file, or inline JSON string')
  .action(async (source: string) => {
    const { existsSync, readFileSync } = await import('node:fs');
    const { saveSession } = await import('./session-store.js');

    let raw: string;
    if (existsSync(source)) {
      raw = readFileSync(source, 'utf-8');
    } else {
      raw = source;
    }

    let session: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // Support both raw session object and wrapped { session: {...} } format
      session = (parsed['session'] as Record<string, unknown>) ?? parsed;
    } catch {
      console.error('Error: Invalid JSON. Provide a session.json file path or a JSON string.');
      process.exit(1);
    }

    if (!session['at'] || !session['cookies']) {
      console.error('Error: Session must contain at least "at" and "cookies" fields.');
      console.error('Expected format: {"at":"...","bl":"...","fsid":"...","cookies":"...","userAgent":"..."}');
      process.exit(1);
    }

    const dest = await saveSession(session as never, program.opts().home ? undefined : undefined);
    console.log(`Session imported to ${dest}`);

    // Verify
    try {
      const proxy = resolveProxy({});
      const client = new NotebookClient();
      await client.connect({ transport: 'auto', session: session as never, proxy });
      const notebooks = await client.listNotebooks();
      console.error(`Verified: ${notebooks.length} notebooks accessible`);
      await client.disconnect();
    } catch (err) {
      console.error(`Warning: Session imported but verification failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

program.addCommand(importSessionCmd);

// ── Refresh-Session Command ──

const refreshSessionCmd = new Command('refresh-session')
  .description('Refresh session tokens using existing cookies (no browser needed)')
  .action(async () => {
    const { loadSession, refreshTokens } = await import('./session-store.js');

    const session = await loadSession();
    if (!session) {
      console.error('Error: No session found. Run `export-session` first.');
      process.exit(1);
    }

    const proxy = resolveProxy({});
    try {
      const refreshed = await refreshTokens(session, undefined, proxy);
      console.log(`Session refreshed (at=${refreshed.at.slice(0, 30)}...)`);

      // Verify
      const client = new NotebookClient();
      await client.connect({ transport: 'auto', session: refreshed, proxy });
      const notebooks = await client.listNotebooks();
      console.error(`Verified: ${notebooks.length} notebooks accessible`);
      await client.disconnect();
    } catch (err) {
      console.error(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error('Cookies may be expired. Re-run `export-session` to log in again.');
      process.exit(1);
    }
  });

program.addCommand(refreshSessionCmd);

// ── Audio Command ──

const audioCmd = new Command('audio')
  .description('Generate an audio podcast from source material');

addBrowserOptions(addSourceOptions(audioCmd))
  .requiredOption('-o, --output <dir>', 'Output directory')
  .option('-l, --language <lang>', 'Audio language', 'en')
  .option('--custom-prompt <prompt>', 'Custom generation prompt (alias: --instructions)')
  .option('--instructions <text>', 'Custom generation instructions')
  .option('--format <fmt>', 'Audio format: deep_dive | brief | critique | debate')
  .option('--length <len>', 'Audio length: short | default | long')
  .option('--keep-notebook', 'Do not delete the notebook after completion')
  .action(async (opts) => {
    const source = buildSource(opts);
    await withClient(opts, async (client) => {
      const result = await client.runAudioOverview(
        {
          source,
          outputDir: opts.output,
          language: opts.language,
          instructions: opts.instructions,
          customPrompt: opts.customPrompt,
          format: opts.format,
          length: opts.length,
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

// ── Report Command ──

const reportCmd = new Command('report')
  .description('Generate a report (briefing doc, study guide, blog post, or custom)');

addBrowserOptions(addSourceOptions(reportCmd))
  .requiredOption('-o, --output <dir>', 'Output directory')
  .option('--template <t>', 'Report template: briefing_doc | study_guide | blog_post | custom', 'briefing_doc')
  .option('--instructions <text>', 'Custom instructions (appended to template, or full prompt for custom)')
  .option('-l, --language <lang>', 'Output language', 'en')
  .action(async (opts) => {
    const source = buildSource(opts);
    await withClient(opts, async (client) => {
      const result = await client.runReport(
        {
          source,
          outputDir: opts.output,
          template: opts.template,
          instructions: opts.instructions,
          language: opts.language,
        },
        progressLogger,
      );
      console.log(result.markdownPath);
      console.error(`Notebook: ${result.notebookUrl}`);
    });
  });

program.addCommand(reportCmd);

// ── Video Command ──

const videoCmd = new Command('video')
  .description('Generate a video overview');

addBrowserOptions(addSourceOptions(videoCmd))
  .requiredOption('-o, --output <dir>', 'Output directory')
  .option('--format <fmt>', 'Video format: explainer | brief | cinematic')
  .option('--style <s>', 'Video style: auto | classic | whiteboard | kawaii | anime | watercolor | retro_print')
  .option('--instructions <text>', 'Custom instructions')
  .option('-l, --language <lang>', 'Output language', 'en')
  .action(async (opts) => {
    const source = buildSource(opts);
    await withClient(opts, async (client) => {
      const result = await client.runVideo(
        {
          source,
          outputDir: opts.output,
          format: opts.format,
          style: opts.style,
          instructions: opts.instructions,
          language: opts.language,
        },
        progressLogger,
      );
      console.log(result.videoUrl);
      console.error(`Notebook: ${result.notebookUrl}`);
    });
  });

program.addCommand(videoCmd);

// ── Quiz Command ──

const quizCmd = new Command('quiz')
  .description('Generate a quiz');

addBrowserOptions(addSourceOptions(quizCmd))
  .requiredOption('-o, --output <dir>', 'Output directory')
  .option('--instructions <text>', 'Custom instructions')
  .option('-l, --language <lang>', 'Output language', 'en')
  .option('--quantity <q>', 'Quiz quantity: fewer | standard')
  .option('--difficulty <d>', 'Quiz difficulty: easy | medium | hard')
  .action(async (opts) => {
    const source = buildSource(opts);
    await withClient(opts, async (client) => {
      const result = await client.runQuiz(
        {
          source,
          outputDir: opts.output,
          instructions: opts.instructions,
          language: opts.language,
          quantity: opts.quantity,
          difficulty: opts.difficulty,
        },
        progressLogger,
      );
      console.log(result.htmlPath);
      console.error(`Notebook: ${result.notebookUrl}`);
    });
  });

program.addCommand(quizCmd);

// ── Flashcards Command ──

const flashcardsCmd = new Command('flashcards')
  .description('Generate flashcards');

addBrowserOptions(addSourceOptions(flashcardsCmd))
  .requiredOption('-o, --output <dir>', 'Output directory')
  .option('--instructions <text>', 'Custom instructions')
  .option('-l, --language <lang>', 'Output language', 'en')
  .option('--quantity <q>', 'Flashcard quantity: fewer | standard')
  .option('--difficulty <d>', 'Flashcard difficulty: easy | medium | hard')
  .action(async (opts) => {
    const source = buildSource(opts);
    await withClient(opts, async (client) => {
      const result = await client.runFlashcards(
        {
          source,
          outputDir: opts.output,
          instructions: opts.instructions,
          language: opts.language,
          quantity: opts.quantity,
          difficulty: opts.difficulty,
        },
        progressLogger,
      );
      console.log(result.htmlPath);
      console.error(`Notebook: ${result.notebookUrl}`);
    });
  });

program.addCommand(flashcardsCmd);

// ── Infographic Command ──

const infographicCmd = new Command('infographic')
  .description('Generate an infographic');

addBrowserOptions(addSourceOptions(infographicCmd))
  .requiredOption('-o, --output <dir>', 'Output directory')
  .option('--instructions <text>', 'Custom instructions')
  .option('-l, --language <lang>', 'Output language', 'en')
  .option('--orientation <o>', 'Orientation: landscape | portrait | square')
  .option('--detail <d>', 'Detail level: concise | standard | detailed')
  .option('--style <s>', 'Style: sketch_note | professional | bento_grid')
  .action(async (opts) => {
    const source = buildSource(opts);
    await withClient(opts, async (client) => {
      const result = await client.runInfographic(
        {
          source,
          outputDir: opts.output,
          instructions: opts.instructions,
          language: opts.language,
          orientation: opts.orientation,
          detail: opts.detail,
          style: opts.style,
        },
        progressLogger,
      );
      console.log(result.imagePath);
      console.error(`Notebook: ${result.notebookUrl}`);
    });
  });

program.addCommand(infographicCmd);

// ── Slides Command ──

const slidesCmd = new Command('slides')
  .description('Generate a slide deck');

addBrowserOptions(addSourceOptions(slidesCmd))
  .requiredOption('-o, --output <dir>', 'Output directory')
  .option('--instructions <text>', 'Custom instructions')
  .option('-l, --language <lang>', 'Output language', 'en')
  .option('--format <fmt>', 'Slide format: detailed | presenter')
  .option('--length <len>', 'Slide length: default | short')
  .action(async (opts) => {
    const source = buildSource(opts);
    await withClient(opts, async (client) => {
      const result = await client.runSlideDeck(
        {
          source,
          outputDir: opts.output,
          instructions: opts.instructions,
          language: opts.language,
          format: opts.format,
          length: opts.length,
        },
        progressLogger,
      );
      console.log(result.pptxPath);
      if (result.pdfPath) console.log(result.pdfPath);
      console.error(`Notebook: ${result.notebookUrl}`);
    });
  });

program.addCommand(slidesCmd);

// ── Data Table Command ──

const dataTableCmd = new Command('data-table')
  .description('Generate a data table');

addBrowserOptions(addSourceOptions(dataTableCmd))
  .requiredOption('-o, --output <dir>', 'Output directory')
  .option('--instructions <text>', 'Custom instructions (describe desired table structure)')
  .option('-l, --language <lang>', 'Output language', 'en')
  .action(async (opts) => {
    const source = buildSource(opts);
    await withClient(opts, async (client) => {
      const result = await client.runDataTable(
        {
          source,
          outputDir: opts.output,
          instructions: opts.instructions,
          language: opts.language,
        },
        progressLogger,
      );
      console.log(result.csvPath);
      console.error(`Notebook: ${result.notebookUrl}`);
    });
  });

program.addCommand(dataTableCmd);

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

const ARTIFACT_TYPE_LABEL: Record<number, string> = {
  [ARTIFACT_TYPE.AUDIO]: 'audio',
  [ARTIFACT_TYPE.REPORT]: 'report',
  [ARTIFACT_TYPE.VIDEO]: 'video',
  [ARTIFACT_TYPE.QUIZ]: 'quiz',
  [ARTIFACT_TYPE.MIND_MAP]: 'mind-map',
  [ARTIFACT_TYPE.INFOGRAPHIC]: 'infographic',
  [ARTIFACT_TYPE.SLIDE_DECK]: 'slides',
  [ARTIFACT_TYPE.DATA_TABLE]: 'data-table',
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m${s > 0 ? `${s}s` : ''}` : `${s}s`;
}

const detailCmd = new Command('detail')
  .description('Show notebook details')
  .argument('<notebook-id>', 'Notebook ID');

addBrowserOptions(detailCmd)
  .action(async (notebookId: string, opts) => {
    await withClient(opts, async (client) => {
      const [detail, artifacts] = await Promise.all([
        client.getNotebookDetail(notebookId),
        client.getArtifacts(notebookId).catch(() => []),
      ]);
      console.log(`Title: ${detail.title}`);
      console.log(`Sources (${detail.sources.length}):`);
      for (const src of detail.sources) {
        const words = src.wordCount !== undefined ? ` [${src.wordCount} words]` : '';
        const url = src.url ? ` ${src.url}` : '';
        console.log(`  ${src.id}  ${src.title}${words}${url}`);
      }
      if (artifacts.length > 0) {
        console.log(`Studio (${artifacts.length}):`);
        for (const a of artifacts) {
          const typeName = ARTIFACT_TYPE_LABEL[a.type] ?? `type:${a.type}`;
          const duration = a.durationSeconds !== undefined ? ` [${formatDuration(a.durationSeconds)}]` : '';
          console.log(`  ${a.id}  [${typeName}] ${a.title}${duration}`);
        }
      }
    });
  });

program.addCommand(detailCmd);

// ── Source Management ──

const sourceCmd = new Command('source')
  .description('Manage notebook sources');

const sourceAddCmd = new Command('add')
  .description('Add a source (file, URL, or text) to an existing notebook')
  .argument('<notebook-id>', 'Notebook ID');

addBrowserOptions(sourceAddCmd)
  .option('--file <path>', 'Local file path (pdf, txt, md, docx, csv, pptx, epub, mp3, wav, etc.)')
  .option('--url <url>', 'Source URL')
  .option('--text <content>', 'Source text content')
  .option('--title <title>', 'Title for text source (default: "Pasted Text")')
  .action(async (notebookId: string, opts) => {
    const provided = [opts.file, opts.url, opts.text].filter((v) => v !== undefined).length;
    if (provided !== 1) {
      throw new Error('Specify exactly one of --file, --url, or --text');
    }
    if (opts.text !== undefined && opts.text.length === 0) {
      throw new Error('--text must not be empty');
    }
    if (opts.title !== undefined && opts.text === undefined) {
      throw new Error('--title only applies to --text');
    }
    await withClient(opts, async (client) => {
      let result: { sourceId: string; title: string };
      if (opts.file !== undefined) {
        result = await client.addFileSource(notebookId, opts.file);
      } else if (opts.url !== undefined) {
        result = await client.addUrlSource(notebookId, opts.url);
      } else {
        result = await client.addTextSource(notebookId, opts.title ?? 'Pasted Text', opts.text);
      }
      console.log(`Added: ${result.sourceId}  ${result.title}`);
    });
  });

sourceCmd.addCommand(sourceAddCmd);
program.addCommand(sourceCmd);

// ── Delete Command ──

const deleteCmd = new Command('delete')
  .description('Delete one or more notebooks')
  .argument('<notebook-ids...>', 'Notebook IDs to delete');

addBrowserOptions(deleteCmd)
  .action(async (notebookIds: string[], opts) => {
    await withClient(opts, async (client) => {
      for (const id of notebookIds) {
        await client.deleteNotebook(id);
        console.log(`Deleted: ${id}`);
      }
    });
  });

program.addCommand(deleteCmd);

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

// ── Diagnose Command ──

const diagnoseCmd = new Command('diagnose')
  .description('Generate a diagnostic report for troubleshooting (attach to GitHub issues)')
  .action(async () => {
    const { existsSync, readFileSync, statSync } = await import('node:fs');
    const { getHomeDir, getSessionPath, getProfileDir, getRpcIdsPath } = await import('./paths.js');
    const { CurlTransport } = await import('./transport-curl.js');
    const { TlsClientTransport } = await import('./transport-tlsclient.js');
    const { platform, arch, release } = await import('node:os');

    const home = getHomeDir();
    const sessionPath = getSessionPath();
    const profileDir = getProfileDir();
    const rpcIdsPath = getRpcIdsPath();

    console.log('=== NotebookLM Diagnostic Report ===\n');

    // System
    console.log(`Platform:    ${platform()}-${arch()}`);
    console.log(`OS:          ${release()}`);
    console.log(`Node:        ${process.version}`);
    console.log(`Home dir:    ${home}`);
    console.log('');

    // Session
    const hasSession = existsSync(sessionPath);
    console.log(`Session:     ${hasSession ? 'EXISTS' : 'MISSING'}`);
    if (hasSession) {
      const stat = statSync(sessionPath);
      const ageMs = Date.now() - stat.mtimeMs;
      const ageMin = Math.round(ageMs / 60000);
      console.log(`  Age:       ${ageMin} minutes`);
      try {
        const raw = JSON.parse(readFileSync(sessionPath, 'utf-8')) as Record<string, unknown>;
        const session = raw['session'] as Record<string, string> | undefined;
        console.log(`  Has AT:    ${!!session?.['at']}`);
        console.log(`  Has BL:    ${!!session?.['bl']}`);
        console.log(`  Has Cookies: ${!!session?.['cookies']}`);
        console.log(`  Language:  ${session?.['language'] ?? 'not set'}`);
      } catch {
        console.log('  Parse:     FAILED');
      }
    }
    console.log('');

    // Chrome profile
    console.log(`Profile:     ${existsSync(profileDir) ? 'EXISTS' : 'MISSING'}`);

    // RPC overrides
    const hasRpcOverrides = existsSync(rpcIdsPath);
    console.log(`RPC IDs:     ${hasRpcOverrides ? 'HAS OVERRIDES' : 'using defaults'}`);
    if (hasRpcOverrides) {
      try {
        const overrides = JSON.parse(readFileSync(rpcIdsPath, 'utf-8')) as Record<string, string>;
        console.log(`  Overrides: ${JSON.stringify(overrides)}`);
      } catch {
        console.log('  Parse:     FAILED');
      }
    }
    console.log('');

    // Transport tiers
    const hasCurl = await CurlTransport.isAvailable();
    const hasTlsClient = await TlsClientTransport.isAvailable();
    console.log('Transport tiers:');
    console.log(`  Tier 1 (curl-impersonate): ${hasCurl ? 'AVAILABLE' : 'not found'}`);
    console.log(`  Tier 2 (tls-client):       ${hasTlsClient ? 'AVAILABLE' : 'not installed'}`);
    console.log(`  Tier 3 (undici):           AVAILABLE (built-in)`);
    console.log(`  Auto-select:               ${hasCurl ? 'curl-impersonate' : hasTlsClient ? 'tls-client' : 'undici'}`);
    console.log('');

    // Connectivity test
    if (hasSession) {
      const proxy = resolveProxy({});
      console.log(`Proxy:       ${proxy ?? 'none'}`);
      console.log('API test:');
      const client = new NotebookClient();
      try {
        await client.connect({ transport: 'auto', proxy });
        const notebooks = await client.listNotebooks();
        console.log(`  Status:    OK (${notebooks.length} notebooks)`);
        try {
          const account = await client.getAccountInfo();
          console.log(`  Plan:      ${account.isPlus ? 'Plus' : 'Free'} (type=${account.planType})`);
          console.log(`  Notebooks: max ${account.notebookLimit}`);
          console.log(`  Sources:   max ${account.sourceLimit}/notebook`);
          console.log(`  Words:     max ${account.sourceWordLimit}/source`);
        } catch {
          console.log('  Account:   FAILED');
        }
      } catch (err) {
        console.log(`  Status:    FAILED`);
        console.log(`  Error:     ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        await client.disconnect();
      }
    } else {
      console.log('API test:    SKIPPED (no session)');
    }

    console.log('\n=== End Report ===');
    console.log('Paste this output when reporting issues at:');
    console.log('https://github.com/icebear0828/notebooklm-client/issues');
  });

program.addCommand(diagnoseCmd);

// ── Skill Management ──

const SKILL_TARGETS = [
  { key: 'claude', label: 'Claude Code', path: ['.claude', 'skills', 'notecraft', 'SKILL.md'] },
  { key: 'agents', label: 'Codex / Agents', path: ['.agents', 'skills', 'notecraft', 'SKILL.md'] },
] as const;

async function getSkillSource(): Promise<{ content: string; version: string }> {
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  const content = readFileSync(join(pkgDir, 'SKILL.md'), 'utf-8');
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')) as { version: string };
  return { content, version: pkg.version };
}

async function resolveSkillPath(target: typeof SKILL_TARGETS[number], scope: string): Promise<string> {
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');
  const root = scope === 'user' ? homedir() : process.cwd();
  return join(root, ...target.path);
}

const skillCmd = new Command('skill')
  .description('Manage NotebookLM agent skill');

skillCmd.addCommand(
  new Command('install')
    .description('Install skill into Claude Code and Codex directories')
    .option('--scope <scope>', 'user or project', 'user')
    .option('--target <target>', 'claude, agents, or all', 'all')
    .action(async (opts) => {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      const { content, version } = await getSkillSource();
      const stamped = content.replace(/^---\n/, `---\n# notecraft v${version}\n`);
      const targets = opts.target === 'all' ? SKILL_TARGETS : SKILL_TARGETS.filter(t => t.key === opts.target);

      for (const target of targets) {
        const dest = await resolveSkillPath(target, opts.scope);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, stamped, 'utf-8');
        console.log(`Installed: ${dest} (${target.label})`);
      }
      console.log('\nRestart your agent to activate /nb command.');
    }),
);

skillCmd.addCommand(
  new Command('uninstall')
    .description('Remove skill from agent directories')
    .option('--scope <scope>', 'user or project', 'user')
    .option('--target <target>', 'claude, agents, or all', 'all')
    .action(async (opts) => {
      const { existsSync, unlinkSync, rmdirSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      const targets = opts.target === 'all' ? SKILL_TARGETS : SKILL_TARGETS.filter(t => t.key === opts.target);
      let removed = 0;

      for (const target of targets) {
        const dest = await resolveSkillPath(target, opts.scope);
        if (!existsSync(dest)) continue;
        unlinkSync(dest);
        // Clean empty parent dirs
        try { rmdirSync(dirname(dest)); } catch { /* not empty */ }
        console.log(`Removed: ${dest} (${target.label})`);
        removed++;
      }
      if (removed === 0) console.log('Skill not installed.');
    }),
);

skillCmd.addCommand(
  new Command('status')
    .description('Check installed skill status')
    .option('--scope <scope>', 'user or project', 'user')
    .action(async (opts) => {
      const { existsSync, readFileSync } = await import('node:fs');
      const { version } = await getSkillSource();
      console.log(`CLI version: ${version}`);

      for (const target of SKILL_TARGETS) {
        const dest = await resolveSkillPath(target, opts.scope);
        const installed = existsSync(dest);
        const status = installed ? 'INSTALLED' : 'not installed';
        console.log(`${target.label}: ${status}`);
        console.log(`  Path: ${dest}`);
        if (installed) {
          const content = readFileSync(dest, 'utf-8');
          const match = /notecraft v([\d.]+)/.exec(content);
          const skillVersion = match?.[1] ?? 'unknown';
          console.log(`  Version: ${skillVersion}`);
          if (skillVersion !== version) {
            console.log('  ⚠ Version mismatch — run: npx notebooklm skill install');
          }
        }
      }
    }),
);

program.addCommand(skillCmd);

// ── Run ──

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
