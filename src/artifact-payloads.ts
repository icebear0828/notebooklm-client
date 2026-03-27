/**
 * Artifact payload builders for NotebookLM batchexecute RPC.
 *
 * Each artifact type has a unique positional array structure.
 * These builders produce the inner config array (the 3rd element of the
 * top-level RPC params — the outer wrapper is handled by client.ts).
 */

import type {
  ArtifactGenerateOptions,
  AudioArtifactOptions,
  ReportArtifactOptions,
  VideoArtifactOptions,
  QuizArtifactOptions,
  FlashcardsArtifactOptions,
  InfographicArtifactOptions,
  SlideDeckArtifactOptions,
  DataTableArtifactOptions,
  AudioStyleFormat,
  AudioLength,
  VideoFormat,
  VideoStyle,
  ReportTemplate,
  QuizQuantity,
  QuizDifficulty,
  InfographicOrientation,
  InfographicDetail,
  InfographicStyle,
  SlideDeckFormat,
  SlideDeckLength,
} from './types.js';

// ── Enum Code Maps ──

const AUDIO_FORMAT_CODE: Record<AudioStyleFormat, number> = {
  deep_dive: 1, brief: 2, critique: 3, debate: 4,
};

const AUDIO_LENGTH_CODE: Record<AudioLength, number> = {
  short: 1, default: 2, long: 3,
};

const VIDEO_FORMAT_CODE: Record<VideoFormat, number> = {
  explainer: 1, brief: 2, cinematic: 3,
};

const VIDEO_STYLE_CODE: Record<VideoStyle, number> = {
  auto: 1, classic: 3, whiteboard: 4, kawaii: 5, anime: 6, watercolor: 7, retro_print: 8,
};

const QUIZ_QUANTITY_CODE: Record<QuizQuantity, number> = {
  fewer: 1, standard: 2,
};

const QUIZ_DIFFICULTY_CODE: Record<QuizDifficulty, number> = {
  easy: 1, medium: 2, hard: 3,
};

const INFOGRAPHIC_ORIENTATION_CODE: Record<InfographicOrientation, number> = {
  landscape: 1, portrait: 2, square: 3,
};

const INFOGRAPHIC_DETAIL_CODE: Record<InfographicDetail, number> = {
  concise: 1, standard: 2, detailed: 3,
};

const INFOGRAPHIC_STYLE_CODE: Record<InfographicStyle, number> = {
  sketch_note: 2, professional: 3, bento_grid: 4,
};

const SLIDE_FORMAT_CODE: Record<SlideDeckFormat, number> = {
  detailed: 1, presenter: 2,
};

const SLIDE_LENGTH_CODE: Record<SlideDeckLength, number> = {
  default: 1, short: 2,
};

// ── Report Templates ──

export const REPORT_TEMPLATES: Record<ReportTemplate, { title: string; description: string; prompt: string }> = {
  briefing_doc: {
    title: 'Briefing Doc',
    description: 'Key insights and important quotes',
    prompt: 'Create a comprehensive briefing document that includes an Executive Summary, detailed analysis of key themes, important quotes with context, and actionable insights.',
  },
  study_guide: {
    title: 'Study Guide',
    description: 'Short-answer quiz, essay questions, glossary',
    prompt: 'Create a comprehensive study guide that includes key concepts, short-answer practice questions, essay prompts for deeper exploration, and a glossary of important terms.',
  },
  blog_post: {
    title: 'Blog Post',
    description: 'Insightful takeaways in readable article format',
    prompt: 'Write an engaging blog post that presents the key insights in an accessible, reader-friendly format. Include an attention-grabbing introduction, well-organized sections, and a compelling conclusion with takeaways.',
  },
  custom: {
    title: 'Custom Report',
    description: 'Custom format',
    prompt: 'Create a report based on the provided sources.',
  },
};

// ── Payload Builders ──

type SidsTriple = string[][][];
type SidsDouble = string[][];

export function buildAudioPayload(
  sidsTriple: SidsTriple,
  sidsDouble: SidsDouble,
  opts: AudioArtifactOptions,
): unknown[] {
  const instructions = opts.instructions ?? null;
  const lengthCode = opts.length ? AUDIO_LENGTH_CODE[opts.length] : null;
  const formatCode = opts.format ? AUDIO_FORMAT_CODE[opts.format] : AUDIO_FORMAT_CODE.deep_dive;

  return [
    null, null, 1, sidsTriple, null, null,
    [null, [instructions, lengthCode, null, sidsDouble, opts.language ?? 'en', null, formatCode]],
  ];
}

export function buildReportPayload(
  sidsTriple: SidsTriple,
  sidsDouble: SidsDouble,
  opts: ReportArtifactOptions,
): unknown[] {
  const template = opts.template ?? 'briefing_doc';
  const tmpl = REPORT_TEMPLATES[template];

  let prompt: string;
  if (template === 'custom') {
    prompt = opts.instructions ?? tmpl.prompt;
  } else {
    prompt = opts.instructions ? `${tmpl.prompt}\n\n${opts.instructions}` : tmpl.prompt;
  }

  return [
    null, null, 2, sidsTriple, null, null, null,
    [null, [tmpl.title, tmpl.description, null, sidsDouble, opts.language ?? 'en', prompt, null, true]],
  ];
}

export function buildVideoPayload(
  sidsTriple: SidsTriple,
  sidsDouble: SidsDouble,
  opts: VideoArtifactOptions,
): unknown[] {
  const instructions = opts.instructions ?? null;
  const formatCode = opts.format ? VIDEO_FORMAT_CODE[opts.format] : null;
  const styleCode = opts.style ? VIDEO_STYLE_CODE[opts.style] : null;

  return [
    null, null, 3, sidsTriple, null, null, null, null,
    [null, null, [sidsDouble, opts.language ?? 'en', instructions, null, formatCode, styleCode]],
  ];
}

export function buildQuizPayload(
  sidsTriple: SidsTriple,
  _sidsDouble: SidsDouble,
  opts: QuizArtifactOptions,
): unknown[] {
  const instructions = opts.instructions ?? null;
  const quantityCode = opts.quantity ? QUIZ_QUANTITY_CODE[opts.quantity] : null;
  const difficultyCode = opts.difficulty ? QUIZ_DIFFICULTY_CODE[opts.difficulty] : null;

  return [
    null, null, 4, sidsTriple, null, null, null, null, null,
    [null, [2, null, instructions, null, null, null, null, [quantityCode, difficultyCode]]],
  ];
}

export function buildFlashcardsPayload(
  sidsTriple: SidsTriple,
  _sidsDouble: SidsDouble,
  opts: FlashcardsArtifactOptions,
): unknown[] {
  const instructions = opts.instructions ?? null;
  const quantityCode = opts.quantity ? QUIZ_QUANTITY_CODE[opts.quantity] : null;
  const difficultyCode = opts.difficulty ? QUIZ_DIFFICULTY_CODE[opts.difficulty] : null;

  // Flashcards: [difficulty, quantity] — reversed from quiz!
  return [
    null, null, 4, sidsTriple, null, null, null, null, null,
    [null, [1, null, instructions, null, null, null, [difficultyCode, quantityCode]]],
  ];
}

export function buildInfographicPayload(
  sidsTriple: SidsTriple,
  _sidsDouble: SidsDouble,
  opts: InfographicArtifactOptions,
): unknown[] {
  const instructions = opts.instructions ?? null;
  const orientationCode = opts.orientation ? INFOGRAPHIC_ORIENTATION_CODE[opts.orientation] : null;
  const detailCode = opts.detail ? INFOGRAPHIC_DETAIL_CODE[opts.detail] : null;
  const styleCode = opts.style ? INFOGRAPHIC_STYLE_CODE[opts.style] : null;

  // type 7: 10 nulls between sidsTriple and the config
  return [
    null, null, 7, sidsTriple,
    null, null, null, null, null, null, null, null, null, null,
    [[instructions, opts.language ?? 'en', null, orientationCode, detailCode, styleCode]],
  ];
}

export function buildSlideDeckPayload(
  sidsTriple: SidsTriple,
  _sidsDouble: SidsDouble,
  opts: SlideDeckArtifactOptions,
): unknown[] {
  const instructions = opts.instructions ?? null;
  const formatCode = opts.format ? SLIDE_FORMAT_CODE[opts.format] : null;
  const lengthCode = opts.length ? SLIDE_LENGTH_CODE[opts.length] : null;

  // type 8: 12 nulls between sidsTriple and the config (index 16)
  return [
    null, null, 8, sidsTriple,
    null, null, null, null, null, null, null, null, null, null, null, null,
    [[instructions, opts.language ?? 'en', formatCode, lengthCode]],
  ];
}

export function buildDataTablePayload(
  sidsTriple: SidsTriple,
  _sidsDouble: SidsDouble,
  opts: DataTableArtifactOptions,
): unknown[] {
  const instructions = opts.instructions ?? null;

  // type 9: 14 nulls between sidsTriple and the config (index 18)
  return [
    null, null, 9, sidsTriple,
    null, null, null, null, null, null, null, null, null, null, null, null, null, null,
    [null, [instructions, opts.language ?? 'en']],
  ];
}

/** Dispatch to the correct payload builder based on artifact type. */
export function buildArtifactPayload(
  sidsTriple: SidsTriple,
  sidsDouble: SidsDouble,
  opts: ArtifactGenerateOptions,
): unknown[] {
  switch (opts.type) {
    case 'audio':
      return buildAudioPayload(sidsTriple, sidsDouble, opts);
    case 'report':
      return buildReportPayload(sidsTriple, sidsDouble, opts);
    case 'video':
      return buildVideoPayload(sidsTriple, sidsDouble, opts);
    case 'quiz':
      return buildQuizPayload(sidsTriple, sidsDouble, opts);
    case 'flashcards':
      return buildFlashcardsPayload(sidsTriple, sidsDouble, opts);
    case 'infographic':
      return buildInfographicPayload(sidsTriple, sidsDouble, opts);
    case 'slide_deck':
      return buildSlideDeckPayload(sidsTriple, sidsDouble, opts);
    case 'data_table':
      return buildDataTablePayload(sidsTriple, sidsDouble, opts);
  }
}
