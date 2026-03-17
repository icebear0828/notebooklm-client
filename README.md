# notebooklm-client

[English](#english) | [中文](#中文)

---

<a id="english"></a>

Standalone CLI & library for Google's [NotebookLM](https://notebooklm.google.com/) — generate audio podcasts, analyze content, manage notebooks, and chat.

## Requirements

- **Node.js 20+**
- **Google Chrome** — only needed for first-time login
- A Google account with NotebookLM access

## Install

```bash
npm i notebooklm-client
```

Or from source:

```bash
git clone https://github.com/icebear0828/notebooklm-client.git && cd notebooklm-client
npm install
npm run build
```

## Quick Start

### 1. Login (one-time)

```bash
npx notebooklm export-session
# Opens Chrome → log in to Google → done
```

### 2. Use

```bash
# List notebooks
npx notebooklm list --transport auto

# Generate audio podcast from a URL
npx notebooklm audio --transport auto --url "https://en.wikipedia.org/wiki/TypeScript" -o ./output -l en

# Generate audio podcast from a topic
npx notebooklm audio --transport auto --topic "quantum computing" -o ./output

# Analyze content
npx notebooklm analyze --transport auto --url "https://example.com/paper.pdf" --question "What are the key findings?"

# Chat with a notebook
npx notebooklm chat <notebook-id> --transport auto --question "Summarize this"

# Show notebook details
npx notebooklm detail <notebook-id> --transport auto

# Diagnose issues
npx notebooklm diagnose
```

## CLI Reference

### Shared options

```
  --transport <mode>       auto | browser (default: browser)
  --home <dir>             Config directory (default: ~/.notebooklm)
  --session-path <path>    Custom session file path
  --headless               Run browser without visible window
  --chrome-path <path>     Chrome executable path
```

### Commands

| Command | Description |
|---------|-------------|
| `export-session` | Login via browser and save session |
| `list` | List all notebooks |
| `detail <id>` | Show notebook title and sources |
| `chat <id> --question "..."` | Chat with a notebook |
| `audio` | Generate audio podcast |
| `analyze` | Analyze content with a question |
| `diagnose` | Generate diagnostic report for troubleshooting |

### `audio` options

```
  --url <url>              Source URL
  --text <text>            Source text content
  --topic <topic>          Research topic (web search)
  --research-mode <mode>   fast or deep (default: fast)
  -o, --output <dir>       Output directory (required)
  -l, --language <lang>    Audio language (default: en)
  --custom-prompt <prompt> Custom generation prompt
  --keep-notebook          Keep notebook after completion
```

## Multi-Account

Use different config directories for different Google accounts:

```bash
# Default account
npx notebooklm list --transport auto

# Work account
npx notebooklm --home ~/.notebooklm-work list --transport auto

# Or via environment variable
NOTEBOOKLM_HOME=~/.notebooklm-work npx notebooklm list --transport auto
```

## Library API

```typescript
import { NotebookClient } from 'notebooklm-client';

const client = new NotebookClient();
await client.connect({ transport: 'auto' });

// List notebooks
const notebooks = await client.listNotebooks();

// Create notebook and add sources
const { notebookId } = await client.createNotebook();
await client.addUrlSource(notebookId, 'https://example.com');
await client.addTextSource(notebookId, 'Title', 'Content...');

// Chat
const detail = await client.getNotebookDetail(notebookId);
const { text } = await client.sendChat(notebookId, 'Summarize', detail.sources.map(s => s.id));

// Check available features and quota
const config = await client.getStudioConfig(notebookId);
const quota = await client.getQuota();

// Generate artifacts (audio, slides, docs — types fetched dynamically)
const audioType = config.audioTypes.find(t => t.name === 'Deep Dive');
await client.generateArtifact(notebookId, audioType.id, sourceIds, { language: 'en' });

await client.disconnect();
```

### Full API

```typescript
// Lifecycle
await client.connect(options)
await client.disconnect()
await client.exportSession(path?)
client.getTransportMode()

// Notebooks
await client.listNotebooks()                          // → NotebookInfo[]
await client.createNotebook()                         // → { notebookId }
await client.getNotebookDetail(notebookId)            // → { title, sources }
await client.deleteNotebook(notebookId)

// Sources
await client.addUrlSource(notebookId, url)            // → { sourceId, title }
await client.addTextSource(notebookId, title, text)   // → { sourceId, title }
await client.createWebSearch(notebookId, query, mode) // → { researchId }
await client.getSourceSummary(sourceId)               // → { summary }
await client.deleteSource(sourceId)

// Chat
await client.sendChat(notebookId, message, sourceIds) // → { text, threadId }
await client.deleteChatThread(threadId)

// Studio (dynamic — always fetch types from server)
await client.getStudioConfig(notebookId)              // → StudioConfig
await client.getQuota()                               // → QuotaInfo

// Artifacts
await client.generateArtifact(notebookId, type, sourceIds, options)
await client.getArtifacts(notebookId)                 // → ArtifactInfo[]
await client.downloadAudio(downloadUrl, outputDir)    // → filePath
await client.deleteArtifact(artifactId)

// High-level workflows
await client.runAudioOverview(options, onProgress?)   // → { audioPath, notebookUrl }
await client.runAnalyze(options, onProgress?)          // → { answer, notebookUrl }
```

## Docker

```bash
docker build -t notebooklm .
docker run -v ~/.notebooklm:/root/.notebooklm notebooklm list --transport auto
```

## Agent Skill

Install the `/notecraft` skill for Claude Code or Codex:

```bash
npx notebooklm skill install              # Install for current user
npx notebooklm skill install --scope project  # Install for current project
npx notebooklm skill status               # Check install status
npx notebooklm skill uninstall            # Remove
```

After installing, use `/notecraft` in your agent to automate NotebookLM tasks.

## Troubleshooting

Run `npx notebooklm diagnose` and paste the output when [reporting issues](https://github.com/icebear0828/notebooklm-client/issues).

Common issues:
- **"No session available"** → Run `npx notebooklm export-session`
- **"Session expired"** → Tokens auto-refresh; if still fails, re-run `export-session`
- **Audio generation fails** → Check quota with the library's `getQuota()` method

## License

MIT

---

<a id="中文"></a>

# notebooklm-client（中文文档）

Google [NotebookLM](https://notebooklm.google.com/) 的独立 CLI 和编程库 —— 生成音频播客、分析内容、管理笔记本、对话。

## 环境要求

- **Node.js 20+**
- **Google Chrome** —— 仅首次登录需要
- 一个有 NotebookLM 访问权限的 Google 账号

## 安装

```bash
npm i notebooklm-client
```

或从源码安装：

```bash
git clone https://github.com/icebear0828/notebooklm-client.git && cd notebooklm-client
npm install
npm run build
```

## 快速开始

### 1. 登录（一次性）

```bash
npx notebooklm export-session
# 打开 Chrome → 登录 Google 账号 → 完成
```

### 2. 使用

```bash
# 列出笔记本
npx notebooklm list --transport auto

# 从 URL 生成音频播客
npx notebooklm audio --transport auto --url "https://zh.wikipedia.org/wiki/TypeScript" -o ./output -l zh

# 从话题生成音频播客
npx notebooklm audio --transport auto --topic "量子计算" -o ./output

# 分析内容
npx notebooklm analyze --transport auto --url "https://example.com/paper.pdf" --question "主要发现是什么？"

# 与笔记本对话
npx notebooklm chat <notebook-id> --transport auto --question "帮我总结一下"

# 查看笔记本详情
npx notebooklm detail <notebook-id> --transport auto

# 诊断问题
npx notebooklm diagnose
```

## CLI 参考

### 通用选项

```
  --transport <mode>       auto | browser（默认 browser）
  --home <dir>             配置目录（默认 ~/.notebooklm）
  --session-path <path>    自定义 session 文件路径
  --headless               无头模式（不显示浏览器窗口）
  --chrome-path <path>     Chrome 可执行文件路径
```

### 命令

| 命令 | 说明 |
|------|------|
| `export-session` | 通过浏览器登录并保存 session |
| `list` | 列出所有笔记本 |
| `detail <id>` | 显示笔记本标题和来源 |
| `chat <id> --question "..."` | 与笔记本对话 |
| `audio` | 生成音频播客 |
| `analyze` | 分析内容并回答问题 |
| `diagnose` | 生成诊断报告（用于提交 issue） |

### `audio` 选项

```
  --url <url>              素材 URL
  --text <text>            素材文本内容
  --topic <topic>          研究话题（网页搜索）
  --research-mode <mode>   fast 或 deep（默认 fast）
  -o, --output <dir>       输出目录（必填）
  -l, --language <lang>    音频语言（默认 en）
  --custom-prompt <prompt> 自定义生成提示词
  --keep-notebook          完成后保留笔记本
```

## 多账号

不同 Google 账号使用不同配置目录：

```bash
# 默认账号
npx notebooklm list --transport auto

# 工作账号
npx notebooklm --home ~/.notebooklm-work list --transport auto

# 或通过环境变量
NOTEBOOKLM_HOME=~/.notebooklm-work npx notebooklm list --transport auto
```

## 编程 API

```typescript
import { NotebookClient } from 'notebooklm-client';

const client = new NotebookClient();
await client.connect({ transport: 'auto' });

// 列出笔记本
const notebooks = await client.listNotebooks();

// 创建笔记本并添加来源
const { notebookId } = await client.createNotebook();
await client.addUrlSource(notebookId, 'https://example.com');
await client.addTextSource(notebookId, '标题', '内容...');

// 对话
const detail = await client.getNotebookDetail(notebookId);
const { text } = await client.sendChat(notebookId, '帮我总结', detail.sources.map(s => s.id));

// 查看可用功能和配额
const config = await client.getStudioConfig(notebookId);
const quota = await client.getQuota();

// 生成产物（音频、幻灯片、文档 —— 类型从服务端动态获取）
const audioType = config.audioTypes.find(t => t.name === 'Deep Dive');
await client.generateArtifact(notebookId, audioType.id, sourceIds, { language: 'zh' });

await client.disconnect();
```

### 完整 API

```typescript
// 生命周期
await client.connect(options)
await client.disconnect()
await client.exportSession(path?)
client.getTransportMode()

// 笔记本
await client.listNotebooks()                          // → NotebookInfo[]
await client.createNotebook()                         // → { notebookId }
await client.getNotebookDetail(notebookId)            // → { title, sources }
await client.deleteNotebook(notebookId)

// 来源
await client.addUrlSource(notebookId, url)            // → { sourceId, title }
await client.addTextSource(notebookId, title, text)   // → { sourceId, title }
await client.createWebSearch(notebookId, query, mode) // → { researchId }
await client.getSourceSummary(sourceId)               // → { summary }
await client.deleteSource(sourceId)

// 对话
await client.sendChat(notebookId, message, sourceIds) // → { text, threadId }
await client.deleteChatThread(threadId)

// Studio（动态 —— 始终从服务端获取类型）
await client.getStudioConfig(notebookId)              // → StudioConfig
await client.getQuota()                               // → QuotaInfo

// 产物
await client.generateArtifact(notebookId, type, sourceIds, options)
await client.getArtifacts(notebookId)                 // → ArtifactInfo[]
await client.downloadAudio(downloadUrl, outputDir)    // → filePath
await client.deleteArtifact(artifactId)

// 高级工作流
await client.runAudioOverview(options, onProgress?)   // → { audioPath, notebookUrl }
await client.runAnalyze(options, onProgress?)          // → { answer, notebookUrl }
```

## Docker

```bash
docker build -t notebooklm .
docker run -v ~/.notebooklm:/root/.notebooklm notebooklm list --transport auto
```

## Agent Skill

安装 `/notecraft` skill 到 Claude Code 或 Codex：

```bash
npx notebooklm skill install              # 安装到当前用户
npx notebooklm skill install --scope project  # 安装到当前项目
npx notebooklm skill status               # 查看安装状态
npx notebooklm skill uninstall            # 卸载
```

安装后在 agent 中使用 `/notecraft` 即可自动化 NotebookLM 操作。

## 故障排除

运行 `npx notebooklm diagnose`，将输出贴到 [issue](https://github.com/icebear0828/notebooklm-client/issues) 中。

常见问题：
- **"No session available"** → 运行 `npx notebooklm export-session`
- **"Session expired"** → Token 会自动刷新；如果仍然失败，重新运行 `export-session`
- **音频生成失败** → 通过 `getQuota()` 检查配额

## 许可证

MIT

---

## Changelog / 更新日志

### v0.2.0 (2026-03-16)

- `--transport auto` mode with automatic best-engine selection
- Auto-installed optimized HTTP engine on `npm install`
- Dynamic studio config: `getStudioConfig()` fetches available types from server
- Quota API: `getQuota()` checks remaining generation limits
- Multi-account support: `--home` flag and `NOTEBOOKLM_HOME` env var
- `diagnose` command for troubleshooting
- Docker support (amd64/arm64)

---

- `--transport auto` 模式，自动选择最佳引擎
- `npm install` 时自动安装优化 HTTP 引擎
- 动态 Studio 配置：`getStudioConfig()` 从服务端获取可用类型
- 配额 API：`getQuota()` 查询剩余生成次数
- 多账号支持：`--home` 参数和 `NOTEBOOKLM_HOME` 环境变量
- `diagnose` 诊断命令
- Docker 支持（amd64/arm64）

### v0.1.0 (2026-03-16)

- Full NotebookLM API: notebooks, sources, chat, audio generation
- Browser and headless modes
- Session persistence with auto token refresh
- CLI with all core commands

---

- 完整 NotebookLM API：笔记本、来源、对话、音频生成
- 浏览器和无头模式
- Session 持久化 + token 自动刷新
- CLI 包含所有核心命令
