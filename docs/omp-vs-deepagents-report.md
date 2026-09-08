# omp vs DeepAgent — 能力差异比对报告

> 方法：RPD 递归 PDCA（6 节点：5 研究维度并行 + 1 综合合成），逐能力给证据（omp 源码路径 / DeepAgent 源码路径），产出经机器验证（verify 脚本确认文件存在且含关键符号）。
>
> 证据强度：omp 侧为本仓库源码可复现；DeepAgent 侧以实机安装的 SDK 0.6.10 / CLI 0.1.16 源码为准（`~/.local/share/uv/tools/deepagents-code/lib/python3.11/site-packages/`），非官方文档转述。
>
> 日期：2026-08-31 · 对照对象：omp（oh-my-pi coding-agent）vs DeepAgent（deepagents SDK 0.6.10 / CLI 0.1.16）
>
> 关联文档：单维深度对比见 `omp-vs-deepagents-context.md`（上下文/记忆维度）。

---

## 一句话结论

**omp 是深度可调、可嵌入（ACP/RPC/SDK）的自足 TS/Bun 产品；DeepAgent 是「LangGraph 之上的一层」Python SDK + 终端参考实现，强在可检查点/可远端的图执行与中间件组合。**

---

## 1. 架构与运行时

| 维度 | omp | deepagents |
|---|---|---|
| 语言/运行时 | Bun/TS 多包 monorepo（10 pkg + Rust 原生 crate pi-natives） | Python 3.11 + LangChain/LangGraph 生态 |
| 架构范式 | **显式事件流循环**（`agent-loop.ts` AgentMessage 循环 + EventStream/EventBus，控制流是显式代码，易注入任意逻辑） | **编译图状态机**（LangGraph Pregel，`DeepAgentState` DeltaChannel reducer + checkpointer 线程持久化，HITL 中断/恢复、RemoteAgent.astream 远端执行是框架内建） |
| 扩展点 | capability 发现注册表（`defineCapability/registerProvider/loadCapability`）+ 代码式扩展 + Gemini 风格 manifest；用户/项目目录驱动 | 中间件类（`wrap_model_call` 拦截每次 LLM 请求）+ BackendProtocol（7 实现，含 CompositeBackend）+ Harness/Provider profiles；SDK 编程式驱动 |
| 进程模型 | 单进程自派发 worker（线程 + IPC 子进程，`declareWorkerHostEntry` + `__omp_worker_*` argv 重入 cli.ts） | client/server 分离（Textual UI ↔ langgraph dev 子进程或 RemoteGraph 远端）；`-n` 非交互进程内直跑 |
| TUI | 自研差分渲染 TUI（精细 diff/滚动静默） | 成熟 Textual 框架（开发成本低，渲染为通用组件级） |
| 独立性 | 自成体系，零外部 agent 框架依赖 | 强依赖 LangGraph 生态，可检查点/远端/序列化是框架红利 |

**核心差异**：omp 把 agent 循环写成显式代码（易插桩任意控制流、进程内事件总线）；deepagent 把循环编码进图结构 + 中间件钩子（天然可检查点/可远端/可序列化）。

## 2. 核心编码工具链

| 能力 | omp | deepagents |
|---|---|---|
| 编辑 | 深层：hashline 哈希锚定补丁（陈旧锚点先拒）+ apply_patch/sloppy Lark 语法 + replace/patch 多模式 + **ast_grep/ast_edit AST 改写** + **LSP 诊断回灌** + 模糊匹配 | 精确 old_string/new_string 替换（唯一性校验、replace_all、EOF 特判、先读后编辑硬门），无 AST/LSP |
| 执行 | 持久 shell 会话 + PTY 交互 + 审批分层（allow/deny/prompt + 危险模式）+ 超时/后台化/会话隔离 | 一次性 `subprocess.run(shell=True)`（本地无隔离，docstring 自述 unrestricted）；隔离靠远程 sandbox（Modal/E2B）+ HITL `interrupt_on` + ShellAllowListMiddleware |
| 搜索 | ripgrep 正则（native、归档/ssh 可搜），上限/预算管控 | 刻意**字面匹配**（`rg -F` + python fallback，managed rg 14.1.1 自安装），防误匹配 |
| 调试/代码智能 | **DAP 调试器**（gdb/lldb-dap/debugpy/dlv/rdbg/js-debug-adapter）+ LSP 工具 | 无调试器/无 LSP；可选 js_eval（QuickJS 沙箱） |
| 数据源广度 | SQLite/归档/PDF/ssh/内部 URL 多源 | 文件系统 + 沙箱 |
| 独有强项 | 编辑正确性、执行控制、DAP、LSP、数据源广度 | 沙箱后端抽象（远程隔离）、HITL 审批预览（FileOpTracker diff）、AGENTS.md memory、主动 `compact_conversation` |

## 3. 上下文管理与记忆

| 机制 | omp | deepagents |
|---|---|---|
| 压缩 | 5 方法链（remote/snapcompact/handoff/shake/soft），**异步预压缩**，CompactionEntry 持久化（结构化 entry：可重渲染/注入/分支） | 85% 阈值 LLM 摘要 + keep 10%（≈20K@200K）+ `conversation_history.md` 文件 offload（20K token 阈值）；产物是事件+文件（保 checkpoint 完整、可回查原文） |
| 长期记忆 | **框架托管**：两阶段 LLM 提炼（会话→摘要→MEMORY.md/skills），作业队列/租约/去重/脱敏/注入限额；Mnemopi 本地向量图库 + Hindsight 远程记忆 | **模型自律**：AGENTS.md 唯一跨会话载体，靠 system prompt 引导模型 `edit_file` 维护 + memory_guard 保护；无提炼/合并/检索管线 |
| 会话恢复 | JSONL session 文件 + goal/mode 持久化 + resume 命令 | LangGraph SQLite checkpoint（`_context_tokens/_model_spec` channel），HITL 恢复 |

**本质差异**：omp = 框架托管记忆（后台 LLM 提炼 + 结构化检索 + 注入管控）；deepagent = 模型自律记忆（文件即记忆 + checkpoint 即状态）。深度对比见 `omp-vs-deepagents-context.md`。

## 4. 模型与提供商支持

| 维度 | omp | deepagents |
|---|---|---|
| 提供商 | **64 内置提供商 + 4365 烘焙模型**（descriptors.ts CATALOG_PROVIDERS + generate-models.ts + models.json），运行期动态拉取（2h 缓存） | 25 个注册提供商（langchain 1.3.9 枚举）；本 venv 仅预装 anthropic/openai/deepseek/google_genai 4 包，~20 可选 extras |
| 本地模型 | 发现 ollama/vllm/lm-studio/litellm/llama.cpp（含 llama-cpp 127.0.0.1:8080、vllm 8000/v1 端点） | 纯运行期 `_PROFILES` 动态发现 + Ollama `/api/tags`+`/api/show` 实时探测 |
| 思考控制 | **ThinkingConfig 一等公民**：effort/budget/google-level/anthropic-adaptive/anthropic-budget-effort 5 模式、6 级 effort、effortRouting 逐档换 wire 模型 id | 无显式 thinking 控制（透传提供商默认，仅 model_params 透传） |
| 路由 | 10 内置模型角色 + `@role` 选择器、auto-thinking 难度分类器、service tier、重试回退链、advisor 第二模型；内嵌 ONNX 微型模型（标题/记忆/auto-thinking） | 两级：子代理 frontmatter `model:` 覆盖（SubAgent.model 必填）+ `/model` 运行期热切换 middleware |

**差异**：omp 的模型层是深度工程化的产品级路由/思考/发现体系；deepagent 是「LangChain 生态提供商 + 运行期探测」的轻量适配，无烘焙目录、无显式思考控制。

## 5. 生态与集成

| 能力 | omp | deepagents |
|---|---|---|
| MCP | stdio/sse/http + OAuth/apikey；**Smithery 市场 + 多源归并 + 扩展可观察 MCP 事件** | stdio/sse/http + OAuth；**项目配置指纹信任门 + 厂商定制 OAuth（GitHub/Slack）+ disabled 持久化** |
| 子代理 | 运行时 AgentRegistry + Agent Hub TUI（steer/revive/kill/持久化血缘） | SDK SubAgent/CompiledSubAgent 中间件 + `.deepagents/agents/` 文件声明 + 远程异步子代理 |
| 扩展 | 最广：TS 扩展 API（tool/command/event/UI）+ 文件能力（skill/slash/hook/instruction）+ 插件市场 + claude-plugins 兼容 | SDK 中间件栈 + SKILL.md + hooks.json 事件钩子 + 内置 skill（remember/skill-creator），无包分发市场 |
| 协作 | **`/collab` 实时跨实例会话共享**（TUI/浏览器来宾可操控）+ Agent Hub | 无实时共享；协作 = hooks 外部通知 + 远程子代理 |
| SDK/协议 | TS `createAgentSession` 会话工厂 + 发现助手；**ACP server & client**；内部 URL 协议（skill:// history:// agent://） | Python `create_deep_agent`（LangGraph 图）+ ACP server（`--acp`）；沙箱 provider 抽象 |

## 6. 综合结论

| 维度 | 胜出方 | 一句话 |
|---|---|---|
| 架构可检查/远端 | deepagents | LangGraph 图 + checkpoint + RemoteGraph 天然支持 |
| 编辑正确性/调试 | omp | AST/LSP/hashline/DAP 是 deepagents 完全没有的层 |
| 执行控制 | omp | 持久会话 + PTY + 审批分层；deepagents 靠远程 sandbox |
| 上下文记忆 | omp | 框架托管记忆 vs 模型自律（自律易失守） |
| 模型体系 | omp | 64 提供商/4365 模型/ThinkingConfig/多级路由 |
| MCP | 对等 | 各有所长（市场 vs 信任门） |
| 子代理控制面 | omp | 运行时 Hub/steer/血缘；deepagents 强在声明式/远程 |
| 扩展生态 | omp | 文件能力 + TS API + 插件市场 + claude-plugins |
| 实时协作 | omp | deepagents 无此能力 |
| SDK 生态亲和 | deepagents | 深度绑定 LangGraph/LangChain 生态 |

**选型建议**：
- 选 **omp**：需要深度编辑正确性、DAP 调试、LSP 智能、框架托管记忆、多模型路由、实时协作、自足产品（可嵌入 ACP/RPC/SDK）。
- 选 **deepagents**：需要把 agent 作为 LangGraph 生态的一部分——图检查点/中断恢复/远端执行/沙箱后端抽象，或用 Python SDK 编程式组合中间件。
