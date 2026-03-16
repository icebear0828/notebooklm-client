/**
 * Google Boq envelope parser — shared format used by NotebookLM and Gemini.
 *
 * Response format:
 *   )]}'          ← anti-XSSI prefix
 *   LENGTH
 *   [["wrb.fr","RPC_ID","INNER_JSON_STRING",...]]
 */

/**
 * Strip the anti-XSSI safety prefix from response.
 */
export function stripSafetyPrefix(raw: string): string {
  const stripped = raw.replace(/^\s*\)]\}'\s*\n?/, '');
  return stripped.trim();
}

/**
 * Extract JSON envelope arrays from the length-prefixed response body.
 * Each chunk is preceded by a line containing its byte length.
 */
export function extractJsonChunks(body: string): unknown[][] {
  const chunks: unknown[][] = [];
  const lines = body.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]?.trim();
    if (!line) {
      i++;
      continue;
    }

    if (/^\d+$/.test(line)) {
      const length = parseInt(line, 10);

      // Boq chunks are typically single-line: try next line first
      const nextLine = lines[i + 1];
      if (nextLine?.trim()) {
        try {
          const parsed = JSON.parse(nextLine.trim()) as unknown[];
          chunks.push(parsed);
          i += 2;
          continue;
        } catch {
          // Not single-line JSON, fall through to accumulation
        }
      }

      // Multi-line fallback: collect lines up to the byte length
      let jsonStr = '';
      let j = i + 1;
      while (j < lines.length && jsonStr.length < length) {
        jsonStr += (jsonStr ? '\n' : '') + lines[j];
        j++;
      }

      if (jsonStr.trim()) {
        try {
          const parsed = JSON.parse(jsonStr) as unknown[];
          chunks.push(parsed);
        } catch {
          // Not valid JSON, skip
        }
      }
      i = j;
    } else {
      try {
        const parsed = JSON.parse(line) as unknown[];
        chunks.push(parsed);
      } catch {
        // Skip non-JSON lines
      }
      i++;
    }
  }

  return chunks;
}

/**
 * Parse wrb.fr envelopes from a raw Boq response.
 * Returns the parsed inner JSON arrays.
 */
export function parseEnvelopes(raw: string): unknown[][] {
  const stripped = stripSafetyPrefix(raw);
  const chunks = extractJsonChunks(stripped);
  const results: unknown[][] = [];

  for (const chunk of chunks) {
    if (!Array.isArray(chunk)) continue;
    for (const env of chunk) {
      if (!Array.isArray(env) || env[0] !== 'wrb.fr') continue;
      if (typeof env[2] === 'string') {
        try {
          const parsed = JSON.parse(env[2]) as unknown[];
          if (Array.isArray(parsed)) results.push(parsed);
        } catch { /* skip malformed */ }
      }
    }
  }
  return results;
}
