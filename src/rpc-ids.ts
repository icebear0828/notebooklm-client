/**
 * NotebookLM batchexecute RPC identifiers — captured from live traffic.
 */

export const NB_RPC = {
  CREATE_NOTEBOOK: 'CCqFvf',
  LIST_NOTEBOOKS: 'wXbhsf',
  GET_NOTEBOOK: 'rLM1Ne',
  DELETE_NOTEBOOK: 'WWINqb',

  ADD_SOURCE: 'izAoDd',
  CREATE_WEB_SEARCH: 'Ljjv0c',
  IMPORT_RESEARCH: 'LBwxtb',
  LIST_SOURCES: 'hPTbtc',
  GET_SOURCE_CONTENT: 'hizoJc',
  GET_SOURCE_SUMMARY: 'tr032e',
  DELETE_SOURCE: 'tGMBJ',

  GENERATE_ARTIFACT: 'R7cb6c',
  GET_ARTIFACTS_FILTERED: 'gArtLc',
  GET_ALL_ARTIFACTS: 'e3bVqc',
  GET_STUDIO_CONFIG: 'sqTeoe',
  DELETE_ARTIFACT: 'V5N4be',
  REPORT_PLAY_PROGRESS: 'Fxmvse',

  DELETE_CHAT_THREAD: 'J7Gthc',

  GET_COLLABORATORS: 'JFMDGd',
  GET_NOTEBOOK_SUMMARY: 'VfAZjd',
  GET_RECOMMENDED_TOPICS: 'otmP3b',
  GET_QUOTA: 'ZwVcOc',
  GET_UI_CONFIG: 'ozz5Z',
  LIST_NOTES: 'khqZz',
  HEARTBEAT: 'cFji9',
} as const;

export const ARTIFACT_TYPE = {
  AUDIO_DEEP_DIVE: 1,
  AUDIO_BRIEF: 2,
  AUDIO_CRITIQUE: 3,
  AUDIO_DEBATE: 4,
  FLASHCARDS: 4,
} as const;

export const NB_URLS = {
  BASE: 'https://notebooklm.google.com',
  DASHBOARD: 'https://notebooklm.google.com/',
  BATCH_EXECUTE: 'https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute',
  CHAT_STREAM: 'https://notebooklm.google.com/_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1.LabsTailwindOrchestrationService/GenerateFreeFormStreamed',
} as const;

export const DEFAULT_USER_CONFIG = [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[2, 1, 3]]] as const;

export const PLATFORM_WEB = [2] as const;
