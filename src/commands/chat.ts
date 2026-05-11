import type { ChatWithCitationsResult, SourceInfo } from '../types.js';

export interface ChatCommandClient {
  getNotebookDetail(notebookId: string): Promise<{ sources: Pick<SourceInfo, 'id'>[] }>;
  sendChat(notebookId: string, question: string, sourceIds: string[]): Promise<{ text: string; threadId: string }>;
  sendChatWithCitations(notebookId: string, question: string, sourceIds: string[]): Promise<ChatWithCitationsResult>;
}

export interface ChatCommandOptions {
  question: string;
  sourceIds?: string;
  withCitations?: boolean;
}

export interface ChatCommandResult {
  exitCode: 0 | 2 | 3;
  stdout?: string;
  stderr: string[];
}

export function resolveChatSourceIds(rawSourceIds: string | undefined, detailSources: Pick<SourceInfo, 'id'>[]): string[] {
  if (rawSourceIds === undefined) {
    return detailSources.map((source) => source.id);
  }

  return rawSourceIds
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export async function runChatCommand(
  client: ChatCommandClient,
  notebookId: string,
  opts: ChatCommandOptions,
): Promise<ChatCommandResult> {
  const detail = await client.getNotebookDetail(notebookId);
  const sourceIds = resolveChatSourceIds(opts.sourceIds, detail.sources);

  if (sourceIds.length === 0) {
    return {
      exitCode: 2,
      stderr: [
        '[chat] ERROR: notebook has 0 sources visible to API.',
        '[chat] Likely cause: NotebookLM is still indexing recently uploaded files (eventual consistency, usually 2-10 min).',
        `[chat] Fix: wait a few minutes and retry, or run \`notebooklm detail ${notebookId}\` to confirm sources are indexed before chatting.`,
      ],
    };
  }

  if (opts.withCitations) {
    const result = await client.sendChatWithCitations(notebookId, opts.question, sourceIds);
    if (isEmptyText(result.text)) {
      return emptyTextResult();
    }
    return {
      exitCode: 0,
      stdout: JSON.stringify(result, null, 2),
      stderr: [],
    };
  }

  const result = await client.sendChat(notebookId, opts.question, sourceIds);
  if (isEmptyText(result.text)) {
    return emptyTextResult();
  }
  return {
    exitCode: 0,
    stdout: result.text,
    stderr: [],
  };
}

function isEmptyText(text: string): boolean {
  return text.trim() === '';
}

function emptyTextResult(): ChatCommandResult {
  return {
    exitCode: 3,
    stderr: [
      '[chat] ERROR: API returned empty text.',
      '[chat] Likely cause: stale session cookies or rate-limited account.',
      '[chat] Fix: re-run `npx notebooklm export-session` to refresh the session, then retry.',
    ],
  };
}
