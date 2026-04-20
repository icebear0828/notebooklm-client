---
name: notecraft
description: "Google NotebookLM automation. Create notebooks, add sources, generate podcasts/videos/slides/flashcards, chat, deep research. Activates on intent like create a podcast, research topic, summarize URL."
user-invocable: true
allowed-tools: Bash, Read, Write
argument-hint: "[research|podcast|analyze|chat] [args...]"
---

# NotebookLM

Automate Google NotebookLM via CLI. Generate audio podcasts, reports, slides, quizzes, videos, infographics, data tables, flashcards, analyze content, manage notebooks, and chat.

## Setup

```bash
npm i notebooklm-client
npx notebooklm export-session   # One-time: opens Chrome, log in to Google
npx notebooklm list --transport auto  # Verify
```

## When This Skill Activates

Recognize requests like:
- "Create a podcast about [topic]"
- "Research [topic] in depth"
- "Summarize this URL"
- "Generate a report / study guide / blog post"
- "Generate flashcards / slides / quiz"
- "Create an infographic / data table / video"
- "Chat with my notebook"
- "What notebooks do I have?"
- "Add this PDF to my [company/topic] notebook"
- "Attach this URL to notebook X"

## CLI Commands

All commands use `--transport auto` for headless mode.

| Task | Command |
|------|---------|
| List notebooks | `npx notebooklm list --transport auto` |
| Notebook details | `npx notebooklm detail <id> --transport auto` |
| Add source to existing notebook | `npx notebooklm source add <id> --transport auto --file ./paper.pdf` |
| Add URL to existing notebook | `npx notebooklm source add <id> --transport auto --url "https://..."` |
| Delete notebooks | `npx notebooklm delete <id...> --transport auto` |
| Chat | `npx notebooklm chat <id> --transport auto --question "..."` |
| Podcast from URL | `npx notebooklm audio --transport auto --url "https://..." -o /tmp/audio -l en` |
| Podcast (debate, short) | `npx notebooklm audio --transport auto --topic "AI" -o /tmp/audio --format debate --length short` |
| Report (study guide) | `npx notebooklm report --transport auto --url "https://..." -o /tmp/report --template study_guide` |
| Report (custom) | `npx notebooklm report --transport auto --url "https://..." -o /tmp/report --template custom --instructions "Write a SWOT analysis"` |
| Slides | `npx notebooklm slides --transport auto --url "https://..." -o /tmp/slides --format presenter` |
| Video | `npx notebooklm video --transport auto --url "https://..." -o /tmp/video --format explainer --style whiteboard` |
| Quiz | `npx notebooklm quiz --transport auto --url "https://..." -o /tmp/quiz --difficulty medium` |
| Flashcards | `npx notebooklm flashcards --transport auto --url "https://..." -o /tmp/flashcards` |
| Infographic | `npx notebooklm infographic --transport auto --url "https://..." -o /tmp/infographic --style professional` |
| Data table | `npx notebooklm data-table --transport auto --url "https://..." -o /tmp/table --instructions "Compare by category"` |
| Analyze content | `npx notebooklm analyze --transport auto --url "https://..." --question "Summarize"` |
| Diagnose issues | `npx notebooklm diagnose` |
| Import session | `npx notebooklm import-session <file-or-json>` |

### Source options (shared by all generation commands)

```
--url <url>              Source URL
--text <text>            Source text
--file <path>            Local file (pdf, txt, md, docx, csv, pptx, epub, mp3, wav, etc.)
--topic <topic>          Research topic (web search)
--research-mode <mode>   fast | deep (default: fast)
```

### Generation command options

| Command | Key options |
|---------|------------|
| `audio` | `--format` (deep_dive/brief/critique/debate), `--length` (short/default/long), `--instructions`, `-l`, `--keep-notebook` |
| `report` | `--template` (briefing_doc/study_guide/blog_post/custom), `--instructions`, `-l` |
| `video` | `--format` (explainer/brief/cinematic), `--style` (auto/classic/whiteboard/kawaii/anime/watercolor/retro_print), `--instructions`, `-l` |
| `quiz` | `--instructions`, `--quantity` (fewer/standard), `--difficulty` (easy/medium/hard) |
| `flashcards` | `--instructions`, `--quantity`, `--difficulty` |
| `infographic` | `--orientation` (landscape/portrait/square), `--detail` (concise/standard/detailed), `--style` (sketch_note/professional/bento_grid), `--instructions`, `-l` |
| `slides` | `--format` (detailed/presenter), `--length` (default/short), `--instructions`, `-l` |
| `data-table` | `--instructions` (describe table structure), `-l` |

All generation commands require `-o, --output <dir>`.

## Multi-Account

```bash
npx notebooklm --home ~/.notebooklm-work list --transport auto
# or
NOTEBOOKLM_HOME=~/.notebooklm-work npx notebooklm list --transport auto
```

## Autonomy Rules

**Run automatically:** `list`, `detail`, `diagnose`

**Ask before running:** generation commands (long-running, creates notebook), `source add` (modifies user's notebook), `delete` (irreversible)

## Common Workflows

### Quick podcast from URL
```bash
npx notebooklm audio --transport auto --url "https://example.com/article" -o ./output -l en
```

### Research a topic (deep, debate format)
```bash
npx notebooklm audio --transport auto --topic "quantum computing" --research-mode deep -o ./output --format debate
```

### Generate a study guide
```bash
npx notebooklm report --transport auto --url "https://example.com/paper.pdf" -o ./output --template study_guide --instructions "Focus on key formulas"
```

### Generate slides from a topic
```bash
npx notebooklm slides --transport auto --topic "machine learning basics" -o ./output --format presenter --length short
```

### Quiz from an article
```bash
npx notebooklm quiz --transport auto --url "https://example.com/article" -o ./output --difficulty hard --quantity standard
```

### Analyze and ask questions
```bash
npx notebooklm analyze --transport auto --url "https://example.com/paper.pdf" --question "What are the key findings?"
```

### Chat with existing notebook
```bash
npx notebooklm list --transport auto
npx notebooklm chat <notebook-id> --transport auto --question "Summarize the main points"
```

### Add new material to an existing notebook
```bash
npx notebooklm source add <notebook-id> --transport auto --file ./new-report.pdf
npx notebooklm source add <notebook-id> --transport auto --url "https://static.cninfo.com.cn/finalpage/2026-04-16/1225107391.PDF"
```
Use this when the user wants to extend a long-running topic/company notebook with
a fresh document rather than creating a new throwaway notebook.

## Error Handling

| Error | Action |
|-------|--------|
| "No session available" | `npx notebooklm export-session` |
| "Session expired" | Auto-refreshes; if fails, re-export |
| "Quota exceeded" | Daily limit hit — wait or upgrade |
| "Rate limited" | Wait a few minutes, retry |
| "Audio download returned login page" | Re-run `npx notebooklm export-session` to refresh cookies |

## Known Limits

- Audio generation takes 5-10 minutes
- Daily generation limits exist per type (audio, video, slides, etc.) — no API to check remaining
- Studio types are dynamic — Google may add/remove types anytime
- Session auto-refreshes; re-export if auth errors persist
- **Download requires re-export after update** — if you updated notebooklm-client, re-run `export-session` to get domain-scoped cookies for CDN downloads
