/**
 * NotebookLM batchexecute RPC identifiers — captured from live traffic.
 */

export const NB_RPC = {
  // ── Notebooks ──
  CREATE_NOTEBOOK: 'CCqFvf',
  LIST_NOTEBOOKS: 'wXbhsf',
  GET_NOTEBOOK: 'rLM1Ne',
  RENAME_NOTEBOOK: 's0tc2d',
  DELETE_NOTEBOOK: 'WWINqb',
  REMOVE_RECENTLY_VIEWED: 'fejl7e',

  // ── Sources ──
  ADD_SOURCE: 'izAoDd',
  ADD_SOURCE_FILE: 'o4cbdc',
  GET_SOURCE_CONTENT: 'hizoJc',
  GET_SOURCE_SUMMARY: 'tr032e',
  DELETE_SOURCE: 'tGMBJ',
  REFRESH_SOURCE: 'FLmJqe',
  UPDATE_SOURCE: 'b7Wfje',

  // ── Research ──
  CREATE_WEB_SEARCH: 'Ljjv0c',
  CREATE_DEEP_RESEARCH: 'QA9ei',
  POLL_RESEARCH: 'e3bVqc',
  IMPORT_RESEARCH: 'LBwxtb',

  // ── Artifacts ──
  GENERATE_ARTIFACT: 'R7cb6c',
  GET_ARTIFACTS_FILTERED: 'gArtLc',
  DELETE_ARTIFACT: 'V5N4be',
  RENAME_ARTIFACT: 'rc3d8d',
  GET_INTERACTIVE_HTML: 'v9rmvd',
  EXPORT_ARTIFACT: 'Krh3pd',
  SHARE_ARTIFACT: 'RGP97b',
  GET_STUDIO_CONFIG: 'sqTeoe',

  // ── Notes & Mind Maps ──
  CREATE_NOTE: 'CYK0Xb',
  GET_NOTES: 'cFji9',
  UPDATE_NOTE: 'cYAfTb',
  DELETE_NOTE: 'AH0mwd',

  // ── Chat ──
  LIST_CHAT_THREADS: 'hPTbtc',
  DELETE_CHAT_THREAD: 'J7Gthc',

  // ── Sharing ──
  GET_SHARE_STATUS: 'JFMDGd',
  SHARE_NOTEBOOK: 'QDyure',

  // ── Settings / Account ──
  GET_ACCOUNT_INFO: 'ZwVcOc',
  SET_USER_SETTINGS: 'hT54vc',
  GET_NOTEBOOK_SUMMARY: 'VfAZjd',
  GET_RECOMMENDED_TOPICS: 'otmP3b',
  GET_UI_CONFIG: 'ozz5Z',
  REPORT_PLAY_PROGRESS: 'Fxmvse',
} as const;

export const ARTIFACT_TYPE = {
  AUDIO: 1,
  REPORT: 2,
  VIDEO: 3,
  QUIZ: 4,
  MIND_MAP: 5,
  INFOGRAPHIC: 7,
  SLIDE_DECK: 8,
  DATA_TABLE: 9,
} as const;

export const NB_URLS = {
  BASE: 'https://notebooklm.google.com',
  DASHBOARD: 'https://notebooklm.google.com/',
  BATCH_EXECUTE: 'https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute',
  CHAT_STREAM: 'https://notebooklm.google.com/_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1.LabsTailwindOrchestrationService/GenerateFreeFormStreamed',
  UPLOAD: 'https://notebooklm.google.com/upload/_/',
} as const;

export const DEFAULT_USER_CONFIG = [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[2, 1, 3]]] as const;

export const PLATFORM_WEB = [2] as const;
