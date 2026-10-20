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
  COPY_NOTEBOOK: 'te3DCe',
  REMOVE_RECENTLY_VIEWED: 'fejl7e',

  // ── Sources ──
  ADD_SOURCE: 'izAoDd',
  ADD_SOURCES_ASYNC: 'X1snv',
  ADD_SOURCE_FILE: 'o4cbdc',
  GET_SOURCE_CONTENT: 'hizoJc',
  GET_SOURCE_SUMMARY: 'tr032e',
  DELETE_SOURCE: 'tGMBJ',
  REFRESH_SOURCE: 'FLmJqe',
  CHECK_SOURCE_FRESHNESS: 'yR9Yof',
  UPDATE_SOURCE: 'b7Wfje',
  APPEND_SOURCE: 'QsNTEd',
  COPY_SOURCES: 'R27wvc',
  RETRIEVE_RELEVANT_CHUNKS: 'ASU5Oe',

  // ── Collections & Labels ──
  CREATE_LABEL: 'agX4Bc',
  LIST_LABELS: 'I3xc3c',
  UPDATE_LABEL: 'le8sX',
  DELETE_LABEL: 'GyzE7e',

  // ── Research ──
  CREATE_WEB_SEARCH: 'Ljjv0c',
  CREATE_DEEP_RESEARCH: 'QA9ei',
  POLL_RESEARCH: 'e3bVqc',
  IMPORT_RESEARCH: 'LBwxtb',
  DISCOVER_SOURCES: 'Es3dTe',
  CANCEL_RESEARCH: 'Zbrupe',

  // ── Artifacts ──
  GENERATE_ARTIFACT: 'R7cb6c',
  GET_ARTIFACTS_FILTERED: 'gArtLc',
  DELETE_ARTIFACT: 'V5N4be',
  RENAME_ARTIFACT: 'rc3d8d',
  GET_INTERACTIVE_HTML: 'v9rmvd',
  EXPORT_ARTIFACT: 'Krh3pd',
  SHARE_ARTIFACT: 'RGP97b',
  REVISE_SLIDE: 'KmcKPe',
  RETRY_ARTIFACT: 'Rytqqe',
  COPY_ARTIFACTS: 'mKDdke',
  GET_SUGGESTED_REPORTS: 'ciyUvf',
  GET_STUDIO_CONFIG: 'sqTeoe',

  // ── Notes & Mind Maps ──
  CREATE_NOTE: 'CYK0Xb',
  GET_NOTES: 'cFji9',
  GENERATE_MIND_MAP: 'yyryJe',
  UPDATE_NOTE: 'cYAfTb',
  DELETE_NOTE: 'AH0mwd',

  // ── Chat ──
  LIST_CHAT_THREADS: 'hPTbtc',
  GET_CONVERSATION_TURNS: 'khqZz',
  DELETE_CHAT_THREAD: 'J7Gthc',
  GET_CHAT_SESSION_STATUS: 'oXwmh',
  CANCEL_GENERATION: 'XgrPMd',
  SUGGEST_NEXT_STEPS: 'OcvKNc',

  // ── Sharing ──
  GET_SHARE_STATUS: 'JFMDGd',
  SHARE_NOTEBOOK: 'QDyure',

  // ── Settings / Account / Quota ──
  GET_ACCOUNT_INFO: 'ZwVcOc',
  SET_USER_SETTINGS: 'hT54vc',
  GET_ACCOUNT: 'SatQRc',
  LIST_QUOTA_SUMMARY: 'EylDcb',
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
  ROTATE_COOKIES: 'https://accounts.google.com/RotateCookies',
} as const;

export const DEFAULT_USER_CONFIG = [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[2, 1, 3]]] as const;

export const PLATFORM_WEB = [2] as const;
