# notebooklm-client

Standalone CLI & library for Google's [NotebookLM](https://notebooklm.google.com/) — generate audio podcasts, analyze content, manage notebooks, and chat, all via reverse-engineered Boq RPC.

## Requirements

- **Node.js 20+**
- **Google Chrome** (auto-detected on macOS / Linux / Windows) — only needed for initial login
- A Google account with NotebookLM access

## Install

```bash
git clone <repo-url> && cd notebooklm-client
npm install
npm run build
```

## Transport Modes

The client supports two transport modes:

| | Browser (default) | HTTP |
|---|---|---|
| How it works | Launches Chrome, runs `fetch()` inside browser context | Direct Node.js HTTP via undici |
| TLS fingerprint | Authentic Chrome | Chrome-like (cipher list + sigalgs) |
| Requires Chrome | Yes (always) | Only for initial login |
| Speed | Slower (browser overhead) | Faster |
| Resource usage | ~300MB (Chrome process) | ~20MB |

**Recommended workflow:** Use browser mode once to log in and export a session, then switch to HTTP mode for all subsequent calls.

## Quick Start

### 1. Export session (one-time, needs Chrome)

```bash
npx notebooklm export-session
# Opens Chrome → log in to Google → session saved to ~/.notebooklm/session.json
```

### 2. Use HTTP mode (no browser needed)

```bash
# List notebooks
npx notebooklm list --transport http

# Generate audio podcast
npx notebooklm audio --transport http --url "https://en.wikipedia.org/wiki/TypeScript" -o /tmp/audio -l en

# Analyze content
npx notebooklm analyze --transport http --url "https://example.com/paper.pdf" --question "What are the key findings?"

# Chat with existing notebook
npx notebooklm chat <notebook-id> --transport http --question "Summarize this"
```

### 3. Or use browser mode directly (no export needed)

```bash
# First run opens Chrome for Google login (cookies persist in ~/.notebooklm/chrome-profile)
npx notebooklm audio --url "https://en.wikipedia.org/wiki/TypeScript" -o /tmp/audio
```

## CLI Reference

All commands accept these shared options:

```
Transport options:
  --transport <mode>       Transport mode: browser or http (default: browser)
  --session-path <path>    Session file path for HTTP mode

Browser options (ignored in HTTP mode):
  --profile <dir>          Chrome profile directory (default: ~/.notebooklm/chrome-profile)
  --headless               Run browser in headless mode
  --chrome-path <path>     Chrome executable path
```

### `notebooklm export-session`

Launch browser, log in to Google, and export session for HTTP mode.

```bash
npx notebooklm export-session
npx notebooklm export-session -o /path/to/session.json
```

### `notebooklm audio`

Generate an audio podcast from source material.

```
Options:
  --url <url>              Source URL
  --text <text>            Source text content
  --topic <topic>          Research topic (creates web search)
  --research-mode <mode>   fast or deep (default: fast)
  -o, --output <dir>       Output directory (required)
  -l, --language <lang>    Audio language (default: en)
  --custom-prompt <prompt> Custom generation prompt
  --keep-notebook          Don't delete notebook after completion
```

```bash
npx notebooklm audio --transport http --url "https://example.com/article" -o ./output -l zh
npx notebooklm audio --transport http --topic "quantum computing" --research-mode deep -o ./output
npx notebooklm audio --transport http --text "Your content here..." -o ./output
```

### `notebooklm analyze`

Analyze source material with a question.

```
Options:
  --url/--text/--topic     Source (one required)
  --question <q>           Question to ask (required)
```

```bash
npx notebooklm analyze --transport http --url "https://example.com" --question "What are the key findings?"
```

### `notebooklm list`

List all notebooks in your account.

```bash
npx notebooklm list --transport http
```

### `notebooklm detail <notebook-id>`

Show notebook title and sources.

```bash
npx notebooklm detail abc-123 --transport http
```

### `notebooklm chat <notebook-id>`

Chat with an existing notebook.

```
Options:
  --question <q>           Question (required)
  --source-ids <ids>       Comma-separated source IDs (default: all)
```

```bash
npx notebooklm chat abc-123 --transport http --question "Summarize the main points"
npx notebooklm chat abc-123 --transport http --question "Explain section 3" --source-ids "src-1,src-2"
```

## Library API

### HTTP mode (recommended)

```typescript
import { NotebookClient } from 'notebooklm-client';

const client = new NotebookClient();
await client.connect({ transport: 'http' });
// Loads session from ~/.notebooklm/session.json automatically

const notebooks = await client.listNotebooks();
const { notebookId } = await client.createNotebook();
await client.addUrlSource(notebookId, 'https://example.com');
const detail = await client.getNotebookDetail(notebookId);
const { text } = await client.sendChat(notebookId, 'Summarize', detail.sources.map(s => s.id));

await client.disconnect();
```

### Browser mode

```typescript
const client = new NotebookClient();
await client.connect({ transport: 'browser', headless: true });

// Same API as HTTP mode, plus:
// - Auto-saves session on connect
// - Can export session for later HTTP use
const sessionPath = await client.exportSession();

await client.disconnect();
```

### Provide session directly (no file)

```typescript
import { NotebookClient } from 'notebooklm-client';
import type { NotebookRpcSession } from 'notebooklm-client';

const session: NotebookRpcSession = {
  at: 'csrf-token',
  bl: 'boq_labs-tailwind-frontend_...',
  fsid: '...',
  cookies: 'SID=...; HSID=...; SSID=...',
  userAgent: 'Mozilla/5.0 ...',
};

const client = new NotebookClient();
await client.connect({ transport: 'http', session });
```

### Full API reference

```typescript
// ── Lifecycle ──
await client.connect(options)        // Connect (browser or http)
await client.disconnect()            // Clean up
await client.exportSession(path?)    // Export session to file (browser mode only)
client.getTransportMode()            // Returns 'browser' | 'http'
client.getSession()                  // Get session info
client.getRpcSession()               // Get raw RPC session data

// ── Notebooks ──
await client.listNotebooks()                          // → NotebookInfo[]
await client.createNotebook()                         // → { notebookId }
await client.getNotebookDetail(notebookId)            // → { title, sources }
await client.deleteNotebook(notebookId)               // → void

// ── Sources ──
await client.addUrlSource(notebookId, url)            // → { sourceId, title }
await client.addTextSource(notebookId, title, text)   // → { sourceId, title }
await client.createWebSearch(notebookId, query, mode) // → { researchId }
await client.getSourceSummary(sourceId)               // → { summary }
await client.deleteSource(sourceId)                   // → void

// ── Chat ──
await client.sendChat(notebookId, message, sourceIds) // → { text, threadId }
await client.deleteChatThread(threadId)               // → void

// ── Artifacts (audio, flashcards, etc.) ──
await client.generateArtifact(notebookId, type, sourceIds, options) // → { artifactId, title }
await client.getArtifacts(notebookId)                 // → ArtifactInfo[]
await client.downloadAudio(downloadUrl, outputDir)    // → filePath
await client.deleteArtifact(artifactId)               // → void

// ── High-level Workflows ──
await client.runAudioOverview(options, onProgress?)   // → { audioPath, notebookUrl }
await client.runAnalyze(options, onProgress?)          // → { answer, notebookUrl }
await client.runMindMap(options, onProgress?)           // → { imagePath, notebookUrl }
await client.runFlashcards(options, onProgress?)        // → { cards, notebookUrl }
```

### Session persistence utilities

```typescript
import { saveSession, loadSession, hasValidSession } from 'notebooklm-client';

await saveSession(session, '/path/to/session.json');
const session = await loadSession('/path/to/session.json');
const valid = await hasValidSession('/path/to/session.json', 2 * 60 * 60 * 1000); // 2h max age
```

## How it works

NotebookLM uses Google's **Boq** RPC framework (same as Gemini). All operations go through:

```
POST https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute
```

Each request contains:
- **RPC ID** (e.g., `CCqFvf` for create notebook)
- **Payload** as nested JSON arrays
- **CSRF token** (`SNlM0e`) extracted from `WIZ_global_data`
- **Session cookies** (including HttpOnly cookies extracted via CDP)

**Browser mode** launches Chrome with anti-detection, runs `fetch()` inside the browser context for authentic TLS fingerprints.

**HTTP mode** sends requests directly from Node.js using undici with Chrome-like TLS configuration (cipher suite order, signature algorithms, ALPN). Session data (cookies + tokens) is exported from a prior browser session.

Chat uses a separate streaming endpoint (`GenerateFreeFormStreamed`).

## Testing

```bash
# Unit tests
npm test

# E2E tests (requires valid session — run export-session first)
npm run test:e2e
```

## Config

- **Chrome profile**: `~/.notebooklm/chrome-profile` (persistent login)
- **Session file**: `~/.notebooklm/session.json` (exported for HTTP mode, 2h validity)
- **RPC ID overrides**: `~/.notebooklm/rpc-ids.json` (for when Google updates RPC IDs)

## License

MIT
