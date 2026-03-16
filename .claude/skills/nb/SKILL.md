---
name: nb
description: Complete API for Google NotebookLM — create notebooks, add sources, generate podcasts/slides/flashcards, chat, deep research. Activates on /nb or intent like "create a podcast about X", "research topic Y", "summarize this URL"
user-invocable: true
allowed-tools: Bash, Read, Write
argument-hint: [research|podcast|analyze|chat|studio] [args...]
---

# NotebookLM Automation

Complete programmatic access to Google NotebookLM. Create notebooks, add sources (URLs, text, web search), chat with content, generate all artifact types (audio podcasts, slides, flashcards, docs), and download results.

**Project path:** `/Users/c/NotebookLM`

## Prerequisites

**First-time setup:**
```bash
cd /Users/c/NotebookLM
npm install    # Auto-installs curl-impersonate for Chrome TLS fingerprint
npm run build
```

**Authentication (one-time per account):**
```bash
npx notebooklm export-session
# Opens Chrome → log in to Google → session saved to ~/.notebooklm/session.json
```

**Verify:**
```bash
npx notebooklm list --transport auto
```

If any command fails with session/auth errors, re-run `npx notebooklm export-session`.

## Multi-Account / Parallel Agents

Use `NOTEBOOKLM_HOME` environment variable or `--home` flag for account isolation:

```bash
# Default account
npx notebooklm list --transport auto

# Work account
NOTEBOOKLM_HOME=~/.notebooklm-work npx notebooklm list --transport auto

# Or via CLI flag
npx notebooklm --home ~/.notebooklm-work list --transport auto

# Parallel agents: each gets its own home directory
NOTEBOOKLM_HOME=/tmp/agent-1 npx notebooklm list --transport auto
NOTEBOOKLM_HOME=/tmp/agent-2 npx notebooklm list --transport auto
```

Each home directory contains: `session.json`, `chrome-profile/`, `rpc-ids.json`.

## When This Skill Activates

**Explicit:** User says `/nb`, "use notebooklm", or mentions the tool by name.

**Intent detection:** Recognize requests like:
- "Create a podcast about [topic]"
- "Research [topic] in depth"
- "Summarize this URL/document"
- "Generate flashcards for studying"
- "Turn this into an audio overview"
- "Create slides from my research"
- "What notebooks do I have?"
- "Chat with my notebook about [topic]"
- "Check my NotebookLM quota"

## Autonomy Rules

**Run automatically (no confirmation needed):**
- `npx notebooklm list` — list notebooks
- `npx notebooklm detail <id>` — show notebook details
- tsx scripts calling: `getQuota()`, `getStudioConfig()`, `listNotebooks()`, `getNotebookDetail()`, `getSourceSummary()`

**Ask before running:**
- `npx notebooklm audio` — long-running, consumes quota
- tsx scripts calling: `generateArtifact()` — long-running, may fail with rate limits
- tsx scripts calling: `deleteNotebook()`, `deleteSource()`, `deleteArtifact()` — destructive
- tsx scripts calling: `downloadAudio()` — writes to filesystem

## Quick Reference

### CLI Commands

All commands require `--transport auto` for headless mode (recommended).

| Task | Command |
|------|---------|
| List notebooks | `npx notebooklm list --transport auto` |
| Notebook details | `npx notebooklm detail <id> --transport auto` |
| Chat | `npx notebooklm chat <id> --transport auto --question "..."` |
| Generate podcast (from URL) | `npx notebooklm audio --transport auto --url "https://..." -o /tmp/audio -l en` |
| Generate podcast (from topic) | `npx notebooklm audio --transport auto --topic "Minecraft" -o /tmp/audio` |
| Generate podcast (from text) | `npx notebooklm audio --transport auto --text "content..." -o /tmp/audio` |
| Analyze content | `npx notebooklm analyze --transport auto --url "https://..." --question "Summarize"` |
| Export session | `npx notebooklm export-session` |

**All commands also accept:** `--home <dir>` for multi-account, `--session-path <path>` for custom session file.

### Library API via tsx Scripts

For operations not covered by CLI, write a tsx script:

```typescript
#!/usr/bin/env npx tsx
import { NotebookClient } from '/Users/c/NotebookLM/src/client.js';

async function main() {
  const client = new NotebookClient();
  await client.connect({ transport: 'auto' });
  try {
    // Your operations here
  } finally {
    await client.disconnect();
  }
}
main().catch(console.error);
```

Save to `/tmp/nb-<task>.ts`, run with `npx tsx /tmp/nb-<task>.ts`.

**Full API methods:**

| Task | Code |
|------|------|
| Check quota | `await client.getQuota()` → `{ audioRemaining, audioLimit, notebookLimit, sourceWordLimit }` |
| Studio config | `await client.getStudioConfig(notebookId)` → `{ audioTypes, slideTypes, docTypes }` |
| Create notebook | `await client.createNotebook()` → `{ notebookId }` |
| Delete notebook | `await client.deleteNotebook(notebookId)` |
| Add URL source | `await client.addUrlSource(notebookId, url)` → `{ sourceId, title }` |
| Add text source | `await client.addTextSource(notebookId, title, content)` → `{ sourceId, title }` |
| Web search | `await client.createWebSearch(notebookId, query, 'deep')` → `{ researchId }` |
| Get source summary | `await client.getSourceSummary(sourceId)` → `{ summary }` |
| Delete source | `await client.deleteSource(sourceId)` |
| Chat | `await client.sendChat(notebookId, message, sourceIds)` → `{ text, threadId }` |
| Generate artifact | `await client.generateArtifact(notebookId, typeId, sourceIds, { language, customPrompt })` → `{ artifactId, title }` |
| List artifacts | `await client.getArtifacts(notebookId)` → `ArtifactInfo[]` |
| Download audio | `await client.downloadAudio(downloadUrl, outputDir)` → filePath |
| Delete artifact | `await client.deleteArtifact(artifactId)` |

## Generation Types (Dynamic)

**IMPORTANT:** Always call `getStudioConfig(notebookId)` to get the current list of available types. Do NOT hardcode type IDs — Google may add new types (video, music, etc.) at any time.

**Current known types (may change):**

| Category | Types | Generate with |
|----------|-------|---------------|
| Audio | Deep Dive (1), Brief (2), Critique (3), Debate (4) | `generateArtifact(id, typeId, sources, { language })` |
| Slides | Detailed Deck (1), Presenter Slides (2) | `generateArtifact(id, typeId, sources)` |
| Docs | Briefing Doc, Study Guide, Blog Post | `generateArtifact(id, typeId, sources)` |

**Check available types:**
```typescript
const config = await client.getStudioConfig(notebookId);
console.log('Audio:', config.audioTypes);   // [{id:1, name:"Deep Dive", description:"..."}, ...]
console.log('Slides:', config.slideTypes);
console.log('Docs:', config.docTypes);
```

## Common Workflows

### Research → Podcast → Chat (Full Pipeline)

**Time:** 10-20 minutes total

```typescript
// 1. Create notebook
const { notebookId } = await client.createNotebook();

// 2. Deep web search
await client.createWebSearch(notebookId, 'Minecraft history and impact', 'deep');

// 3. Wait for sources to be ready
for (let i = 0; i < 30; i++) {
  const detail = await client.getNotebookDetail(notebookId);
  if (detail.sources.length > 0 && detail.sources.every(s => s.wordCount && s.wordCount > 0)) break;
  await new Promise(r => setTimeout(r, 5000));
}

// 4. Get source summaries
const detail = await client.getNotebookDetail(notebookId);
for (const source of detail.sources) {
  const { summary } = await client.getSourceSummary(source.id);
  console.log(`${source.title}: ${summary.slice(0, 200)}`);
}

// 5. Comprehensive analysis via chat
const sourceIds = detail.sources.map(s => s.id);
const { text } = await client.sendChat(notebookId, 'Provide a comprehensive analysis of all sources', sourceIds);
console.log(text);

// 6. Generate podcast (confirm with user first!)
const config = await client.getStudioConfig(notebookId);
const deepDive = config.audioTypes.find(t => t.name === 'Deep Dive');
if (deepDive) {
  const { artifactId } = await client.generateArtifact(notebookId, deepDive.id, sourceIds, { language: 'en' });
  // Poll for completion...
}
```

**After research completes, suggest next steps:**
- "Generate a podcast: `/nb podcast <notebookId>`"
- "Generate slides: `/nb studio <notebookId> slides`"
- "Continue chatting: `/nb chat <notebookId> <question>`"

### Quick Analysis

```bash
npx notebooklm analyze --transport auto --url "https://example.com/paper.pdf" --question "What are the key findings?"
```

### Bulk Source Import

```typescript
const { notebookId } = await client.createNotebook();

const urls = [
  'https://example.com/article1',
  'https://example.com/article2',
  'https://example.com/article3',
];

for (const url of urls) {
  const { sourceId, title } = await client.addUrlSource(notebookId, url);
  console.log(`Added: ${title} (${sourceId})`);
}
```

### Check Quota Before Generating

```typescript
const quota = await client.getQuota();
console.log(`Audio remaining: ${quota.audioRemaining}`);
if (quota.audioRemaining <= 0) {
  console.log('No audio quota remaining. Try again later or upgrade.');
  return;
}
```

## Output Style

**Progress updates:** Brief status for each step:
- "Creating notebook..."
- "Adding source: https://example.com..."
- "Waiting for sources to process..."
- "Generating audio (Deep Dive, en)... this takes 5-10 minutes"

**After notebook creation:** Always output the notebook ID so user can reference it in follow-up commands.

**After long operations:** Report the result (file path, notebook URL) and suggest next steps.

## Error Handling

| Error | Cause | Action |
|-------|-------|--------|
| "No session available" | Not logged in | Run `npx notebooklm export-session` |
| "Session expired" | Token expired | Auto-refreshes; if fails, re-run export-session |
| "HTTP 401/400" | Auth invalid | Re-run `npx notebooklm export-session` |
| `UserDisplayableError [[null,[[1]]]]` | Quota exhausted | Inform user to wait or upgrade |
| Empty artifactId from generateArtifact | Generation failed | Check quota with `getQuota()` first |
| "curl-impersonate binary not found" | Not installed | Run `npm run setup` or use `--transport http` |
| RPC parse errors | Google changed API | Check `~/.notebooklm/rpc-ids.json` for overrides |

**On failure, offer the user a choice:**
1. Retry the operation
2. Skip and continue
3. Investigate the error

## Known Limitations

- **Audio generation requires quota** — check with `getQuota()` before starting
- **Audio generation takes 5-10 minutes** — do NOT poll more than once per 15 seconds
- **Session cookies last weeks**, but CSRF tokens expire every 1-2 hours (auto-refreshed)
- **Transport auto-detection:** curl-impersonate (100% fingerprint) → tls-client (99%) → undici (~40%)
- **Rate limiting:** Google may throttle artifact generation. Wait 5-10 minutes and retry.
- **Studio types are dynamic** — always fetch with `getStudioConfig()`, never assume fixed types

## Processing Times

| Operation | Typical Time |
|-----------|-------------|
| Source processing | 10-60 seconds |
| Web search (fast) | 30 seconds - 2 minutes |
| Web search (deep) | 2-5 minutes |
| Audio generation | 5-10 minutes |
| Chat response | 3-10 seconds |
| Flashcards/Slides | 1-5 minutes |

## Troubleshooting

```bash
npx notebooklm --help                    # All commands
npx notebooklm list --transport auto      # Verify auth works
npx notebooklm --home /tmp/test list --transport auto  # Test with different account
```

**Re-authenticate:** `npx notebooklm export-session`
**Force re-install curl-impersonate:** `npm run setup`
**Check version:** See `package.json` version field
