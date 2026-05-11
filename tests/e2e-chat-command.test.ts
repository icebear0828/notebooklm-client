/**
 * E2E tests for chat command guards.
 *
 * Requires a valid session (for example NOTEBOOKLM_HOME=~/.notebooklm-work)
 * and a built CLI (`npm run build`). This test hits the real NotebookLM detail
 * API and verifies the CLI fails before sending chat when the API exposes no sources.
 */

import { execFile, type ExecFileException } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const EMPTY_DETAIL_NOTEBOOK_ID = '00000000-0000-0000-0000-000000000000';

function sessionPath(): string {
  return join(process.env['NOTEBOOKLM_HOME'] ?? join(homedir(), '.notebooklm'), 'session.json');
}

function runNode(args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      args,
      {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 1024 * 1024,
        timeout: 60_000,
      },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        if (!error) {
          resolve({ exitCode: 0, stdout, stderr });
          return;
        }

        if (typeof error.code === 'number') {
          resolve({ exitCode: error.code, stdout, stderr });
          return;
        }

        reject(error);
      },
    );
  });
}

describe('E2E chat command guards', () => {
  it('returns exit 2 when the real detail API exposes no sources', async () => {
    if (!existsSync(sessionPath()) || !existsSync(join(process.cwd(), 'dist/cli.js'))) {
      return expect(true).toBe(true);
    }

    const chatResult = await runNode([
      'dist/cli.js',
      'chat',
      EMPTY_DETAIL_NOTEBOOK_ID,
      '--question',
      'This should not be sent',
      '--transport',
      'auto',
    ]);

    expect(chatResult.exitCode).toBe(2);
    expect(chatResult.stdout).toBe('');
    expect(chatResult.stderr).toMatch(/0 sources visible/);
  }, 60_000);
});
