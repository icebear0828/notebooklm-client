import { describe, it, expect } from 'vitest';
import { NB_RPC, NB_URLS } from '../src/rpc-ids.js';

describe('NB_RPC', () => {
  it('contains valid and non-empty RPC strings', () => {
    for (const [key, value] of Object.entries(NB_RPC)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
      expect(key).toMatch(/^[A-Z_]+$/);
    }
  });

  it('includes newly supported upstream RPCs', () => {
    // Account and Quota
    expect(NB_RPC.GET_ACCOUNT).toBe('SatQRc');
    expect(NB_RPC.LIST_QUOTA_SUMMARY).toBe('EylDcb');

    // Notebooks
    expect(NB_RPC.COPY_NOTEBOOK).toBe('te3DCe');

    // Sources
    expect(NB_RPC.ADD_SOURCES_ASYNC).toBe('X1snv');
    expect(NB_RPC.APPEND_SOURCE).toBe('QsNTEd');
    expect(NB_RPC.COPY_SOURCES).toBe('R27wvc');
    expect(NB_RPC.RETRIEVE_RELEVANT_CHUNKS).toBe('ASU5Oe');

    // Labels & Collections
    expect(NB_RPC.CREATE_LABEL).toBe('agX4Bc');
    expect(NB_RPC.LIST_LABELS).toBe('I3xc3c');
    expect(NB_RPC.UPDATE_LABEL).toBe('le8sX');
    expect(NB_RPC.DELETE_LABEL).toBe('GyzE7e');

    // Artifacts
    expect(NB_RPC.RETRY_ARTIFACT).toBe('Rytqqe');
    expect(NB_RPC.COPY_ARTIFACTS).toBe('mKDdke');

    // Chat and Research
    expect(NB_RPC.CANCEL_RESEARCH).toBe('Zbrupe');
    expect(NB_RPC.DISCOVER_SOURCES).toBe('Es3dTe');
    expect(NB_RPC.GET_CHAT_SESSION_STATUS).toBe('oXwmh');
    expect(NB_RPC.CANCEL_GENERATION).toBe('XgrPMd');
    expect(NB_RPC.SUGGEST_NEXT_STEPS).toBe('OcvKNc');
  });

  it('includes RotateCookies in NB_URLS', () => {
    expect(NB_URLS.ROTATE_COOKIES).toBe('https://accounts.google.com/RotateCookies');
  });
});
