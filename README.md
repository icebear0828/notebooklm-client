# notebooklm-client

[English](#english) | [中文](#中文)

---

<a id="english"></a>

Standalone CLI & library for Google's [NotebookLM](https://notebooklm.google.com/) — generate audio podcasts, analyze content, manage notebooks, and chat, all via reverse-engineered Boq RPC.

## Requirements

- **Node.js 20+**
- **Google Chrome** (auto-detected on macOS / Linux / Windows) — only needed for initial login
- A Google account with NotebookLM access

## Install

```bash
git clone https://github.com/icebear0828/notebooklm-client.git && cd notebooklm-client
npm install    # auto-downloads curl-impersonate for your platform
npm run build
```

`npm install` automatically downloads [curl-impersonate](https://github.com/lexiforest/curl-impersonate) (BoringSSL-based curl with 100% Chrome TLS fingerprint) for macOS/Linux/Windows.

## How It Runs

There are three ways to use this client. Choose based on your needs:

### 1. Pure HTTP (`--transport auto`, recommended)

**No browser process at all.** Requests go directly from Node.js to Google's servers. Session (cookies + tokens) is loaded from a file exported during a one-time browser login.

```
Node.js → curl-impersonate/undici → Google NotebookLM API
```

- Lightweight (~20MB RAM), fast, suitable for servers/CI/automation
- Requires a one-time `export-session` (opens Chrome once to log in)
- After that, no Chrome needed — tokens auto-refresh via cookies

### 2. Headless Browser (`--transport browser --headless`)

**Chrome runs in the background** (no visible window). All requests go through Chrome's real network stack.

```
Node.js → Puppeteer → Chrome (hidden) → Google NotebookLM API
```

- 100% authentic TLS fingerprint (it's a real browser)
- Heavy (~300MB RAM), slower
- Use when pure HTTP gets blocked by Google

### 3. Headed Browser (`--transport browser`)

**Chrome opens visibly.** Same as headless but you can see and interact with the browser window.

```
Node.js → Puppeteer → Chrome (visible) → Google NotebookLM API
```

- Required for first-time login (`export-session`)
- Useful for debugging (see what the browser is doing)

### Transport Tiers (Pure HTTP detail)

When using `--transport auto`, the client picks the best available HTTP engine:

| Tier | Engine | TLS Fingerprint | Platforms | Requires |
|------|--------|----------------|-----------|----------|
| 1 | **curl-impersonate** | 100% Chrome (BoringSSL) | macOS, Linux, Windows | Auto-installed |
| 2 | **tls-client** | 99% Chrome (Go uTLS) | All | `npm i tlsclientwrapper` |
| 3 | **undici** | ~40% (OpenSSL) | All | Built-in |

**Recommended workflow:**
1. `npm install` — curl-impersonate auto-installed (tier 1 ready)
2. `npx notebooklm export-session` — one-time browser login (headed, visible)
3. `npx notebooklm list --transport auto` — pure HTTP, no browser

## Quick Start

### 1. Export session (one-time, needs Chrome)

```bash
npx notebooklm export-session
# Opens Chrome → log in to Google → session saved to ~/.notebooklm/session.json
```

### 2. Use auto mode (recommended, no browser needed)

```bash
# List notebooks
npx notebooklm list --transport auto

# Generate audio podcast
npx notebooklm audio --transport auto --url "https://en.wikipedia.org/wiki/TypeScript" -o /tmp/audio -l en

# Analyze content
npx notebooklm analyze --transport auto --url "https://example.com/paper.pdf" --question "What are the key findings?"

# Chat with existing notebook
npx notebooklm chat <notebook-id> --transport auto --question "Summarize this"
```

### 3. Or use browser mode directly (no export needed)

```bash
npx notebooklm audio --url "https://en.wikipedia.org/wiki/TypeScript" -o /tmp/audio
```

## CLI Reference

All commands accept these shared options:

```
Transport options:
  --transport <mode>       auto | browser | curl-impersonate | tls-client | http (default: browser)
  --session-path <path>    Session file path for non-browser modes
  --curl-path <path>       Path to curl-impersonate binary (auto-detected)

Browser options (ignored in non-browser modes):
  --profile <dir>          Chrome profile directory (default: ~/.notebooklm/chrome-profile)
  --headless               Run browser in headless mode
  --chrome-path <path>     Chrome executable path
```

### `notebooklm export-session`

Launch browser, log in to Google, and export session for headless modes.

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
npx notebooklm audio --transport auto --url "https://example.com/article" -o ./output -l zh
npx notebooklm audio --transport auto --topic "quantum computing" --research-mode deep -o ./output
npx notebooklm audio --transport auto --text "Your content here..." -o ./output
```

### `notebooklm analyze`

Analyze source material with a question.

```bash
npx notebooklm analyze --transport auto --url "https://example.com" --question "What are the key findings?"
```

### `notebooklm list`

List all notebooks in your account.

```bash
npx notebooklm list --transport auto
```

### `notebooklm detail <notebook-id>`

Show notebook title and sources.

```bash
npx notebooklm detail abc-123 --transport auto
```

### `notebooklm chat <notebook-id>`

Chat with an existing notebook.

```bash
npx notebooklm chat abc-123 --transport auto --question "Summarize the main points"
npx notebooklm chat abc-123 --transport auto --question "Explain section 3" --source-ids "src-1,src-2"
```

## Library API

### Auto mode (recommended)

```typescript
import { NotebookClient } from 'notebooklm-client';

const client = new NotebookClient();
await client.connect({ transport: 'auto' });
// Auto-detects best transport: curl-impersonate → tls-client → undici
// Loads session from ~/.notebooklm/session.json

// Dynamic studio configuration — no hardcoded types
const config = await client.getStudioConfig(notebookId);
// config.audioTypes   → [{id:1, name:"Deep Dive"}, {id:2, name:"Brief"}, ...]
// config.slideTypes   → [{id:1, name:"Detailed Deck"}, ...]
// config.docTypes     → [{name:"Briefing Doc"}, {name:"Study Guide"}, ...]

// Check quota before generating
const quota = await client.getQuota();
// quota.audioRemaining → remaining audio generations

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

const sessionPath = await client.exportSession();
// Session auto-saved on connect too

await client.disconnect();
```

### Provide session directly (no file)

```typescript
const client = new NotebookClient();
await client.connect({
  transport: 'auto',
  session: {
    at: 'csrf-token',
    bl: 'boq_labs-tailwind-frontend_...',
    fsid: '...',
    cookies: 'SID=...; HSID=...; SSID=...',
    userAgent: 'Mozilla/5.0 ...',
    language: 'en',
  },
});
```

### Full API reference

```typescript
// ── Lifecycle ──
await client.connect(options)        // Connect (auto | browser | curl-impersonate | tls-client | http)
await client.disconnect()            // Clean up
await client.exportSession(path?)    // Export session to file (browser mode only)
client.getTransportMode()            // Returns actual transport tier used
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

// ── Studio (dynamic) ──
await client.getStudioConfig(notebookId)              // → StudioConfig (audio/slide/doc types)
await client.getQuota()                               // → QuotaInfo (remaining limits)

// ── Artifacts (audio, slides, docs, etc.) ──
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
import { saveSession, loadSession, hasValidSession, refreshTokens } from 'notebooklm-client';

await saveSession(session, '/path/to/session.json');
const session = await loadSession('/path/to/session.json');
const valid = await hasValidSession('/path/to/session.json', 2 * 60 * 60 * 1000); // 2h max age

// Refresh tokens without browser (uses long-lived cookies)
const refreshed = await refreshTokens(oldSession, '/path/to/session.json');
```

## Docker

For guaranteed tier 1 fingerprint on any platform:

```bash
docker build -t notebooklm .
docker run -v ~/.notebooklm:/root/.notebooklm notebooklm list --transport auto
```

Or with docker-compose:

```bash
docker compose run notebooklm list --transport auto
docker compose run notebooklm audio --transport auto --url "https://example.com" -o /output
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
- **Language** (`hl`) auto-detected from browser locale

**Transport tiers** differ only in how the HTTP request reaches Google:
- **Tier 1 (curl-impersonate)**: BoringSSL → identical Chrome TLS ClientHello + HTTP/2 fingerprint
- **Tier 2 (tls-client)**: Go uTLS → near-identical JA3/JA4 + HTTP/2 Akamai fingerprint
- **Tier 3 (undici)**: Node.js OpenSSL → Chrome cipher list, but different extension order

Studio configuration (available audio types, slide types, doc types) and quota are **fetched dynamically** from the server — no hardcoded artifact types.

Chat uses a separate streaming endpoint (`GenerateFreeFormStreamed`).

## Testing

```bash
# Unit tests (65 tests)
npm test

# E2E tests against real API (18 tests, requires valid session)
npm run test:e2e
```

## Config

| File | Purpose |
|------|---------|
| `~/.notebooklm/chrome-profile` | Chrome persistent login profile |
| `~/.notebooklm/session.json` | Exported session (tokens auto-refresh via cookies) |
| `~/.notebooklm/rpc-ids.json` | RPC ID overrides (when Google updates IDs) |
| `bin/curl-impersonate` | Auto-installed curl-impersonate binary |

## License

MIT

---

<a id="中文"></a>

# notebooklm-client（中文文档）

Google [NotebookLM](https://notebooklm.google.com/) 的独立 CLI 和编程库 —— 通过逆向 Boq RPC 协议实现音频播客生成、内容分析、笔记本管理和对话功能。

## 环境要求

- **Node.js 20+**
- **Google Chrome**（自动检测 macOS / Linux / Windows）—— 仅首次登录需要
- 一个有 NotebookLM 访问权限的 Google 账号

## 安装

```bash
git clone https://github.com/icebear0828/notebooklm-client.git && cd notebooklm-client
npm install    # 自动下载 curl-impersonate
npm run build
```

`npm install` 会自动下载 [curl-impersonate](https://github.com/lexiforest/curl-impersonate)（基于 BoringSSL 的 curl，100% Chrome TLS 指纹）。

## 运行方式

三种运行方式，按需选择：

### 1. 纯 HTTP 模式（`--transport auto`，推荐）

**完全不启动浏览器。** Node.js 直接向 Google 服务器发请求。Session（cookies + tokens）从一次性浏览器登录导出的文件中加载。

```
Node.js → curl-impersonate/undici → Google NotebookLM API
```

- 轻量（~20MB 内存）、快速，适合服务器/CI/自动化
- 需要一次性 `export-session`（打开 Chrome 登录一次）
- 之后无需 Chrome，token 通过 cookies 自动刷新

### 2. 无头浏览器（`--transport browser --headless`）

**Chrome 在后台运行**（无可见窗口），所有请求走 Chrome 真实网络栈。

```
Node.js → Puppeteer → Chrome（隐藏）→ Google NotebookLM API
```

- 100% 真实 TLS 指纹（就是真浏览器）
- 重（~300MB 内存）、较慢
- 当纯 HTTP 模式被 Google 拦截时使用

### 3. 有头浏览器（`--transport browser`）

**Chrome 可见窗口打开。** 与无头模式相同，但可以看到浏览器界面。

```
Node.js → Puppeteer → Chrome（可见）→ Google NotebookLM API
```

- 首次登录（`export-session`）必须用这个
- 调试时有用（可以看到浏览器在做什么）

### 传输层级（纯 HTTP 细节）

使用 `--transport auto` 时，客户端自动选择最佳 HTTP 引擎：

| 层级 | 引擎 | TLS 指纹匹配度 | 平台 | 依赖 |
|------|------|---------------|------|------|
| 1 | **curl-impersonate** | 100%（BoringSSL） | macOS, Linux, Windows | 自动安装 |
| 2 | **tls-client** | 99%（Go uTLS） | 全平台 | `npm i tlsclientwrapper` |
| 3 | **undici** | ~40%（OpenSSL） | 全平台 | 内置 |

**推荐流程：**
1. `npm install` — curl-impersonate 自动安装（tier 1 就绪）
2. `npx notebooklm export-session` — 一次性浏览器登录（有头，可见窗口）
3. `npx notebooklm list --transport auto` — 纯 HTTP，无需浏览器

## 快速开始

### 1. 导出 session（一次性操作，需要 Chrome）

```bash
npx notebooklm export-session
# 打开 Chrome → 登录 Google 账号 → session 保存到 ~/.notebooklm/session.json
```

### 2. 使用 auto 模式（推荐，无需浏览器）

```bash
# 列出所有笔记本
npx notebooklm list --transport auto

# 生成音频播客
npx notebooklm audio --transport auto --url "https://zh.wikipedia.org/wiki/TypeScript" -o /tmp/audio -l zh

# 分析内容
npx notebooklm analyze --transport auto --url "https://example.com/paper.pdf" --question "主要发现是什么？"

# 与已有笔记本对话
npx notebooklm chat <notebook-id> --transport auto --question "帮我总结一下"
```

### 3. 或者直接使用浏览器模式（无需导出）

```bash
npx notebooklm audio --url "https://example.com/article" -o /tmp/audio
```

## CLI 命令参考

所有命令共享以下选项：

```
传输选项：
  --transport <mode>       auto | browser | curl-impersonate | tls-client | http（默认 browser）
  --session-path <path>    非浏览器模式的 session 文件路径
  --curl-path <path>       curl-impersonate 二进制路径（自动检测）

浏览器选项（非浏览器模式下忽略）：
  --profile <dir>          Chrome 配置目录（默认 ~/.notebooklm/chrome-profile）
  --headless               无头模式运行浏览器
  --chrome-path <path>     Chrome 可执行文件路径
```

### `notebooklm export-session`

启动浏览器，登录 Google，导出 session 供无头模式使用。

```bash
npx notebooklm export-session
npx notebooklm export-session -o /path/to/session.json
```

### `notebooklm audio`

从素材生成音频播客。

```
选项：
  --url <url>              素材 URL
  --text <text>            素材文本内容
  --topic <topic>          研究主题（创建网页搜索）
  --research-mode <mode>   fast 或 deep（默认 fast）
  -o, --output <dir>       输出目录（必填）
  -l, --language <lang>    音频语言（默认 en）
  --custom-prompt <prompt> 自定义生成提示词
  --keep-notebook          完成后不删除笔记本
```

```bash
npx notebooklm audio --transport auto --url "https://example.com/article" -o ./output -l zh
npx notebooklm audio --transport auto --topic "量子计算" --research-mode deep -o ./output
```

### `notebooklm analyze`

对素材提出问题进行分析。

```bash
npx notebooklm analyze --transport auto --url "https://example.com" --question "核心观点是什么？"
```

### `notebooklm list` / `detail` / `chat`

```bash
npx notebooklm list --transport auto
npx notebooklm detail abc-123 --transport auto
npx notebooklm chat abc-123 --transport auto --question "总结要点"
```

## 编程 API

### Auto 模式（推荐）

```typescript
import { NotebookClient } from 'notebooklm-client';

const client = new NotebookClient();
await client.connect({ transport: 'auto' });
// 自动检测最佳传输层：curl-impersonate → tls-client → undici
// 自动从 ~/.notebooklm/session.json 加载 session

// 动态获取 Studio 配置 —— 不硬编码任何类型
const config = await client.getStudioConfig(notebookId);
// config.audioTypes   → [{id:1, name:"Deep Dive"}, {id:2, name:"Brief"}, ...]
// config.slideTypes   → [{id:1, name:"Detailed Deck"}, ...]
// config.docTypes     → [{name:"Briefing Doc"}, {name:"Study Guide"}, ...]

// 生成前检查配额
const quota = await client.getQuota();
// quota.audioRemaining → 剩余音频生成次数

const notebooks = await client.listNotebooks();
const { notebookId } = await client.createNotebook();
await client.addUrlSource(notebookId, 'https://example.com');
const detail = await client.getNotebookDetail(notebookId);
const { text } = await client.sendChat(notebookId, '帮我总结', detail.sources.map(s => s.id));

await client.disconnect();
```

### 直接传入 session（不读文件）

```typescript
const client = new NotebookClient();
await client.connect({
  transport: 'auto',
  session: {
    at: 'csrf-token',
    bl: 'boq_labs-tailwind-frontend_...',
    fsid: '...',
    cookies: 'SID=...; HSID=...; SSID=...',
    userAgent: 'Mozilla/5.0 ...',
    language: 'zh',
  },
});
```

### 完整 API 参考

```typescript
// ── 生命周期 ──
await client.connect(options)        // 连接（auto | browser | curl-impersonate | tls-client | http）
await client.disconnect()            // 断开并清理资源
await client.exportSession(path?)    // 导出 session 到文件（仅浏览器模式）
client.getTransportMode()            // 返回实际使用的传输层
client.getSession()                  // 获取 session 信息
client.getRpcSession()               // 获取原始 RPC session 数据

// ── 笔记本 ──
await client.listNotebooks()                          // → NotebookInfo[]
await client.createNotebook()                         // → { notebookId }
await client.getNotebookDetail(notebookId)            // → { title, sources }
await client.deleteNotebook(notebookId)               // → void

// ── 素材来源 ──
await client.addUrlSource(notebookId, url)            // → { sourceId, title }
await client.addTextSource(notebookId, title, text)   // → { sourceId, title }
await client.createWebSearch(notebookId, query, mode) // → { researchId }
await client.getSourceSummary(sourceId)               // → { summary }
await client.deleteSource(sourceId)                   // → void

// ── 对话 ──
await client.sendChat(notebookId, message, sourceIds) // → { text, threadId }
await client.deleteChatThread(threadId)               // → void

// ── Studio（动态） ──
await client.getStudioConfig(notebookId)              // → StudioConfig（音频/幻灯片/文档类型）
await client.getQuota()                               // → QuotaInfo（剩余配额）

// ── 产物（音频、幻灯片、文档等） ──
await client.generateArtifact(notebookId, type, sourceIds, options) // → { artifactId, title }
await client.getArtifacts(notebookId)                 // → ArtifactInfo[]
await client.downloadAudio(downloadUrl, outputDir)    // → filePath
await client.deleteArtifact(artifactId)               // → void

// ── 高级工作流 ──
await client.runAudioOverview(options, onProgress?)   // → { audioPath, notebookUrl }
await client.runAnalyze(options, onProgress?)          // → { answer, notebookUrl }
await client.runMindMap(options, onProgress?)           // → { imagePath, notebookUrl }
await client.runFlashcards(options, onProgress?)        // → { cards, notebookUrl }
```

### Session 持久化工具

```typescript
import { saveSession, loadSession, hasValidSession, refreshTokens } from 'notebooklm-client';

await saveSession(session, '/path/to/session.json');
const session = await loadSession('/path/to/session.json');
const valid = await hasValidSession('/path/to/session.json', 2 * 60 * 60 * 1000); // 2 小时有效期

// 无需浏览器刷新 token（使用长期 cookie 获取新的 CSRF token）
const refreshed = await refreshTokens(oldSession, '/path/to/session.json');
```

## Docker

全平台保证 tier 1 指纹：

```bash
docker build -t notebooklm .
docker run -v ~/.notebooklm:/root/.notebooklm notebooklm list --transport auto
```

或使用 docker-compose：

```bash
docker compose run notebooklm list --transport auto
docker compose run notebooklm audio --transport auto --url "https://example.com" -o /output
```

## 工作原理

NotebookLM 使用 Google 的 **Boq** RPC 框架（与 Gemini 相同），所有操作通过：

```
POST https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute
```

每个请求包含：
- **RPC ID**（如 `CCqFvf` 对应创建笔记本）
- **Payload**：嵌套 JSON 数组
- **CSRF token**（`SNlM0e`）：从 `WIZ_global_data` 提取
- **Session cookies**（包括通过 CDP 提取的 HttpOnly cookie）
- **语言**（`hl`）：从浏览器 locale 自动检测

**传输层级**仅影响 HTTP 请求如何到达 Google：
- **Tier 1（curl-impersonate）**：BoringSSL → 完全一致的 Chrome TLS ClientHello + HTTP/2 指纹
- **Tier 2（tls-client）**：Go uTLS → 近乎一致的 JA3/JA4 + HTTP/2 Akamai 指纹
- **Tier 3（undici）**：Node.js OpenSSL → Chrome cipher 列表，但 extension 顺序不同

Studio 配置（可用的音频类型、幻灯片类型、文档类型）和配额从服务端**动态获取**，不硬编码任何 artifact 类型。

对话使用独立的流式端点（`GenerateFreeFormStreamed`）。

## 测试

```bash
# 单元测试（65 个）
npm test

# E2E 测试（18 个，需要有效 session）
npm run test:e2e
```

## 配置文件

| 文件 | 用途 |
|------|------|
| `~/.notebooklm/chrome-profile` | Chrome 持久登录配置 |
| `~/.notebooklm/session.json` | 导出的 session（token 通过 cookie 自动刷新） |
| `~/.notebooklm/rpc-ids.json` | RPC ID 覆盖配置（Google 更新 ID 时使用） |
| `bin/curl-impersonate` | 自动安装的 curl-impersonate 二进制 |

## 许可证

MIT

---

## Changelog / 更新日志

### v0.2.0 (2026-03-16)

- 3-tier TLS fingerprint transport: curl-impersonate (100%) → tls-client (99%) → undici (~40%)
- `--transport auto` mode with runtime tier detection
- curl-impersonate auto-installed on `npm install` (lexiforest fork, BoringSSL, all platforms)
- Dynamic studio config: `getStudioConfig()` fetches audio/slide/doc types from server
- Quota API: `getQuota()` checks remaining generation limits
- Dynamic `hl` language parameter from browser locale / HTML
- Docker support with multi-arch Dockerfile (amd64/arm64)
- 65 unit tests + 18 E2E tests

---

- 3 层 TLS 指纹传输体系：curl-impersonate (100%) → tls-client (99%) → undici (~40%)
- `--transport auto` 模式，运行时自动检测最佳传输层
- curl-impersonate 在 `npm install` 时自动安装（lexiforest fork，BoringSSL，全平台）
- 动态 Studio 配置：`getStudioConfig()` 从服务端获取音频/幻灯片/文档类型
- 配额 API：`getQuota()` 查询剩余生成次数
- `hl` 语言参数从浏览器 locale / HTML 动态检测
- Docker 支持，多架构 Dockerfile（amd64/arm64）
- 65 个单元测试 + 18 个 E2E 测试

### v0.1.0 (2026-03-16)

- Boq RPC protocol reverse-engineering (`batchexecute` + `GenerateFreeFormStreamed`)
- Two transport modes: Browser (Puppeteer) and pure HTTP (undici + Chrome TLS fingerprint)
- Session persistence with auto token refresh — no browser needed after initial login
- Full API: notebooks CRUD, sources (URL/text/web search), chat (multi-turn), artifacts (audio/flashcards)
- Audio download with HTTP 302 redirect following
- Anti-detection: fingerprint spoofing, webdriver hiding, canvas noise, WebGL masking
- CLI with all commands supporting `--transport http`
- 55 unit tests + 18 E2E tests (all passing)

---

- Boq RPC 协议逆向（`batchexecute` + `GenerateFreeFormStreamed` 流式端点）
- 双传输模式：浏览器模式（Puppeteer）和纯 HTTP 模式（undici + Chrome TLS 指纹）
- Session 持久化 + token 自动刷新 —— 首次登录后无需再开浏览器
- 完整 API：笔记本增删查、素材来源（URL/文本/网页搜索）、多轮对话、产物（音频/闪卡）
- 音频下载支持 HTTP 302 重定向跟随
- 反检测：指纹伪造、webdriver 隐藏、canvas 噪声、WebGL 参数掩码
- CLI 所有命令支持 `--transport http`
- 55 个单元测试 + 18 个 E2E 测试（全部通过）
