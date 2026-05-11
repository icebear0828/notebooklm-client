import { describe, expect, it } from 'vitest';
import { createNotebook } from '../src/api.js';
import { NB_RPC } from '../src/rpc-ids.js';
import type { RpcCaller } from '../src/download.js';

function wrapEnvelope(rpcId: string, inner: unknown): string {
  return ")]}'\n999\n" + JSON.stringify([['wrb.fr', rpcId, JSON.stringify(inner), null]]);
}

function emptyCreateResponse(): string {
  return [
    ")]}'",
    '105',
    JSON.stringify([['wrb.fr', 'CCqFvf', null, null, null, [3], 'generic']]),
    '25',
    JSON.stringify([['e', 4, null, null, 141]]),
  ].join('\n');
}

describe('createNotebook', () => {
  it('falls back to list diff when create response omits notebook ID', async () => {
    const calls: string[] = [];
    const callRpc: RpcCaller = async (rpcId) => {
      calls.push(rpcId);
      if (rpcId === NB_RPC.LIST_NOTEBOOKS && calls.length === 1) {
        return wrapEnvelope(NB_RPC.LIST_NOTEBOOKS, [
          [['Existing', [], '11111111-1111-1111-1111-111111111111']],
        ]);
      }
      if (rpcId === NB_RPC.CREATE_NOTEBOOK) {
        return emptyCreateResponse();
      }
      if (rpcId === NB_RPC.LIST_NOTEBOOKS) {
        return wrapEnvelope(NB_RPC.LIST_NOTEBOOKS, [
          [
            ['Untitled notebook', [], '22222222-2222-2222-2222-222222222222'],
            ['Existing', [], '11111111-1111-1111-1111-111111111111'],
          ],
        ]);
      }
      throw new Error(`unexpected rpc ${rpcId}`);
    };

    await expect(createNotebook(callRpc)).resolves.toEqual({
      notebookId: '22222222-2222-2222-2222-222222222222',
    });
    expect(calls).toEqual([
      NB_RPC.LIST_NOTEBOOKS,
      NB_RPC.CREATE_NOTEBOOK,
      NB_RPC.LIST_NOTEBOOKS,
    ]);
  });
});
