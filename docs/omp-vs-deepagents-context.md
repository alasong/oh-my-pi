# omp vs LangChain Deep Agents — 上下文管理能力对比（证据版）

> 方法：RPD 递归 PDCA（12 节点：10 研究维度 + 1 综合评审），逐能力给证据（omp 源码行号 / Deep Agents 官方文档节名），证据经机器验证（grep 确认引用符号存在于目标文件）。
>
> 证据强度：omp 侧全部本仓库源码可复现；Deep Agents 侧以官方 `docs.langchain.com/oss/python/deepagents/context-engineering.md` 与 `customization.md` 原文为准，未做源码级核验。
>
> 日期：2026-08-23 · 对照对象：omp（oh-my-pi coding-agent）vs LangChain Deep Agents（`langchain-ai/deepagents`，含终端版 dcode）

---

## 总表

| # | 能力 | omp | LangChain Deep Agents | 关键差异 |
|---|---|---|---|---|
| 1 | 自动压缩 | ✅ 默认开，阈值可配 | ✅ **默认开**（裸栈#3），可配 | 都默认开；omp 配置面更宽 |
| 2 | 压缩方法 | ✅ 4 种可配序：remote/soft/handoff/snapcompact | 单一：LLM 摘要 | omp 独有 snapcompact（无 LLM 位图）+ remote（服务端原生压缩） |
| 3 | 大工具输出 | ✅ 落盘 `artifact://` | ✅ offload >20k 写盘 | **两者都落盘**；差异在链接协议与阈值 |
| 4 | 手动触发 | ✅ `/compact soft\|remote\|snapcompact` 内置 | ⚠ `compact_conversation` 需 middleware，默认关 | omp 内置；DA 可选 |
| 5 | 上下文隔离 | ✅ task + subagent | ✅ SubAgentMiddleware 裸栈#2 | 都有 |
| 6 | 长期记忆 | ✅ memory://root + 提取/整合 | ✅ `/memories/` LangGraph Store 跨线程 | 机制不同，都有持久层 |
| 7 | 技能加载 | autoload 全量注入 body | ✅ 渐进披露 frontmatter 按需 | DA 更省 token |
| 8 | 可观测性 | ✅ 状态栏仪表 50/70/90% + 类别分解 + `/context` | ❌ 无 | omp 独有 |
| 9 | 冷启动开销 | ≈10.9k token（实测） | 未给基线 | omp 已知被治理 |
| 10 | 提示词缓存 | ✅ 字节稳定系统指令 | ✅ Anthropic/Bedrock 常驻 5m TTL | 都有 |
| 11 | 计费级窗口治理 | ✅ extendedContext（GPT-5.6 272K 溢价） | ❌ 无 | omp 独有 |
| 12 | 修剪启发式 | ✅ supersedeReads / dropUseless | ❌ 未文档化 | omp 独有 |

---

## 逐维度证据

### 1. 自动压缩

- **omp**：`packages/coding-agent/src/config/settings-schema.ts` — `compaction.enabled`（默认 true）、`thresholdPercent`/`thresholdTokens`（默认 -1 用 reserve 推导）、`reserveTokens`、`keepRecentTokens`（默认 20000）、`midTurnEnabled`、`idleEnabled`/`idleThresholdTokens`/`idleTimeoutSeconds`、`autoContinue`。阈值解析在 `packages/agent/src/compaction/compaction.ts` `shouldAttemptCompaction`/`resolveThresholdTokens`（L338-386）。
- **Deep Agents**：`customization.md`「Bare stack」第 3 项 = `SummarizationMiddleware`（只传 model 即有，**默认开**）。`context-engineering.md`「Summarization」：默认 85% `max_input_tokens` 触发、保留 10%、回退 170k/6 条；`SummarizationMiddleware` 支持 `trigger=("tokens",N)|("fraction",P)|列表 OR`、`keep=("messages",N)` 自定义。
- **差异**：都默认开；omp 的配置面（方法序/mid-turn/idle/reserve/autoContinue）比 DA 的 trigger/keep 更宽。

### 2. 压缩方法种类

- **omp**：`packages/coding-agent/src/session/compaction-methods.ts` — `COMPACTION_METHOD_CHOICES`、`DEFAULT_COMPACTION_METHOD_ORDER`、`STRATEGY_BY_COMPACTION_METHOD`（remote/soft/handoff/snapcompact）。其中 snapcompact 为无 LLM 位图归档（`packages/snapcompact/README.md`：文本渲染成密集 PNG 帧，vision 模型直接读回，无 LLM 调用、确定性、按 provider 调形状）；remote 为 OpenAI-compatible 服务端原生压缩。
- **Deep Agents**：单一 LLM 摘要（`SummarizationMiddleware`，`context-engineering.md`「Summarization」）。
- **差异**：omp 4 方法 + 无 LLM 位图 + 服务端原生；DA 只有 LLM 摘要一种。

### 3. 大工具输出处理（落盘）

- **omp**：`packages/coding-agent/src/exec/bash-executor.ts:555-571` — 原生 minimizer 重写输出后，**无损原样持久化为 session artifact**，消息拼 `[raw output: artifact://<id>]` footer；`packages/coding-agent/src/session/streaming-output.ts` — artifact 捕获默认无损（`ARTIFACT_DEFAULT_MAX_BYTES=0` 不封顶），超限才 head+tail 带 `[ARTIFACT TRUNCATED]` 提示；`tools/read.ts` + `internal-urls/artifact-protocol.ts:118` — 大文件落 artifact，8MB 内可内联、超了须用选择器 `artifact://<id>:1-3000`；`session/agent-session.ts:1973` — 异步结果 `Bun.write(artifactPath)` + `Full output: artifact://<id>`；`session/session-maintenance.ts:649` — shake 压缩区可经 artifact 恢复。
- **Deep Agents**：`context-engineering.md`「Offloading」— 工具调用入/出 >20k token 写文件系统 backend，替换为路径引用 + 前 10 行预览，可 grep 回读。
- **差异**：**两者都落盘**。此前分析误判 omp「不落盘」已修正——omp 用 `artifact://` 内部协议 + minimizer 自动压缩 + 无损保留 + 8MB 选择器门限；DA 用显式 >20k 阈值 + 文件系统路径引用。

### 4. 手动触发

- **omp**：`packages/coding-agent/src/session/compact-modes.ts` — `/compact soft|remote|snapcompact` 子命令，内置 slash command。
- **Deep Agents**：`context-engineering.md`「On-demand compaction tool」— `compact_conversation` 工具，需手动传 `create_summarization_tool_middleware`，**默认关**；「Adding the compaction tool does not disable automatic summarization」。
- **差异**：omp 内置；DA 可选 middleware。

### 5. 上下文隔离

- **omp**：`task` 工具 + subagent（`packages/agent/src/task/executor.ts`）。
- **Deep Agents**：`customization.md`「Bare stack」第 2 项 = `SubAgentMiddleware`（general-purpose subagent 默认添加）。
- **差异**：都有，主 agent 只收最终报告。

### 6. 长期记忆

- **omp**：`memory://root` 内存抽象 + 提取/整合（`prompts/system/memory-extraction-system.md`、`memory-consolidation-system.md`）。
- **Deep Agents**：`context-engineering.md`「Long-term memory」— `/memories/` via `CompositeBackend` → LangGraph Store 跨线程持久。
- **差异**：机制不同，都有持久层。

### 7. 技能加载

- **omp**：`packages/coding-agent/src/extensibility/skills.ts` `buildSkillPromptMessage` — autoload 注入完整 body（`autoloadTemplate`）。
- **Deep Agents**：`context-engineering.md`「Skills」—「reads frontmatter at startup, then loads full skill content only when relevant」（渐进披露）。
- **差异**：DA 渐进披露更省 token；omp autoload 全量 body 是冷启动最大可变头。

### 8. 可观测性

- **omp**：`packages/coding-agent/src/modes/utils/context-usage.ts`（类别分解 + 20×10 网格 + 图例渲染 `renderContextUsage`）、`modes/components/status-line/context-thresholds.ts`（warning 50% / purple 70% / error 90% 分档）、`/context` 命令。
- **Deep Agents**：无此级仪表。
- **差异**：omp 独有。

### 9. 冷启动开销

- **omp**：`packages/coding-agent/scripts/measure-prompt-tokens.ts` 实测 — system prompt 2458 + system context 126 + 核心工具 schema 8281 ≈ **10.9k token 固定基线**；真实冷启动由 context files + autoload skills + MCP 主导，可到数万。有 `NULL_PROMPT` 逃生口 + 5s prep deadline 治理。
- **Deep Agents**：官方文档未给基线数字。

### 10. 提示词缓存

- **omp**：`system-prompt.ts` — 字节稳定系统指令，compaction 保持稳定前缀。
- **Deep Agents**：`customization.md`「Full stack」第 10 项 — `AnthropicPromptCachingMiddleware`/`BedrockPromptCachingMiddleware` 常驻，默认 5m TTL。
- **差异**：都有。

### 11. 计费级窗口治理

- **omp**：`settings-schema.ts` `extendedContext` —「use premium long-context windows on models that bill extra past a threshold (e.g. GPT-5.6 1M 2x above 272K)」；关闭则封顶标准价窗口，压缩在跨入溢价前触发。
- **Deep Agents**：无明确计费级开关。

### 12. 修剪启发式

- **omp**：`settings-schema.ts` `compaction.supersedeReads` / `dropUseless` — 丢弃被后续覆盖的读、无用输出。
- **Deep Agents**：未文档化。

---

## 结论

1. **机制丰富度与控制面：omp 明显胜出**。snapcompact（无 LLM 位图压缩）、投机/异步压缩、空闲压缩、用量仪表、计费级窗口开关、修剪启发式——Deep Agents 均无。
2. **Deep Agents 独有 3 项**，值得 omp 借鉴：大输出 offload 路径引用、技能渐进披露、双轨摘要（in-context 摘要 + 文件系统原文保留）。
3. **已澄清定案的两处误判**：
   - Deep Agents 自动摘要**默认开**（bare stack 常驻，非默认关）；默认关的只是按需 `compact_conversation` 工具。
   - 两者**都落盘**（omp `artifact://` vs DA offload），差异在链接协议与阈值，不在有没有。
4. **定位**：omp 是「给用户更多旋钮」的深度可调型；Deep Agents 是「开箱即用 + 框架化」的 SDK。追求长会话精确控制成本与可见度选 omp；零配置少操心选 DA。

---

## 证据定位速查

| 侧 | 文件 / 文档 |
|---|---|
| omp | `packages/coding-agent/src/session/compaction-methods.ts`、`config/settings-schema.ts`、`session/compact-modes.ts`、`exec/bash-executor.ts`、`session/streaming-output.ts`、`tools/read.ts`、`internal-urls/artifact-protocol.ts`、`modes/utils/context-usage.ts`、`modes/components/status-line/context-thresholds.ts`、`extensibility/skills.ts`、`scripts/measure-prompt-tokens.ts`、`packages/snapcompact/README.md`、`packages/agent/src/compaction/compaction.ts` |
| Deep Agents | `docs.langchain.com/oss/python/deepagents/context-engineering.md`（offload/summarization/on-demand/isolation/memory/skills）、`customization.md`（bare stack / full stack / middleware） |
