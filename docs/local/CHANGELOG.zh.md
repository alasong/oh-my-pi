# 本地改动说明（中文）

本仓库是 [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi) 的 fork。以下归纳相对 `upstream/main`
的本地独有改动（约 30 个提交，作者 alasong）。详细英文条目见上游规范 `packages/coding-agent/CHANGELOG.md` 的
Unreleased 段，此处只作简要说明。

## 1. asset-anchors 项目资产锚框架（主功能）

把代码图、架构文档、测试、守卫钩子、memory、context 统一为声明式资产（`omp.assets.json`），
可注入上下文、受 git 钩子守护、定期保鲜。

- `omp asset init`：一键初始化 —— 构建代码图索引、生成默认清单、安装守卫钩子
- `omp asset install-hooks` / `uninstall-hooks`：从清单派生 pre-commit（架构/质量检查）与 post-commit（代码图刷新）钩子，保留用户已有钩子
- `omp asset check-drift`：检查架构文档引用的代码符号在代码图中是否已消失（目录展开、并发、去误报、全量列出）
- `assets` 能力注册：通过 `loadCapability("assets")` 加载
- 框架设计见 `docs/local/project-asset-anchors.md`

## 2. coding-agent 行为修复

- `bash.lineDisplay`：bash 输出改为按行流式显示（非逐字符），尾部不完整行暂存到新行或命令结束
- `!cd` 目录迁移修复：不再把 omp 项目目录漂移到 cd 目标，仅改持久 shell 自身 cwd（新开关 `bash.cdFollowsShell` 控制）
- bash 退出码语义修复（新开关 `bash.expectedNonZeroExitAsWarning`，**默认 false = 上游行为**）：开启后，非零退出码但属于命令「正常否定回答」的（`grep` 无匹配、`diff` 有差异、`test` 为假等）不再标成 error，改标 warning 且 exitCode 照常可见，避免体检口径虚高与模型误判；`&&` 链、重定向、`bash -c` 等无法归因的一律仍按 error。在本机 `~/.omp/agent/config.yml` 显式打开即可
- `hub wait` 空轮询标记：等待窗口到期且**没有任何事件**（无作业结束、无消息到达）时，结果带 `noEvent` 标记 + 一句确定性提示，不再和「真有进展」的快照混为一谈；由作业结束或消息赢得的等待结果逐字节不变（`packages/coding-agent/src/tools/hub/`）
- 并行引导改为可执行：system prompt 把空泛的「SHOULD parallelize independent calls」换成「把互不依赖的调用并到同一轮」——带举例（多个 read / 无关的 grep/glob / 多个 edit）并说明代价（每多一轮要重付整个上下文）
- read 内联预算漏洞修复：自带 artifact 的 `read` 结果此前整体跳过 `tools.artifactSpillThreshold`/`artifactHeadBytes`，一条超大 URL 正文可以内联几十 KB；现在按同一 head/tail 预算截断并复用既有 artifact 指针（不重复保存）
- 压缩提示词保真：压缩汇总提示词要求每条关键决策保留**当初的理由**（对话里明说过就原样引用），并显式禁止把决策压成泛论 —— 此前压缩只留结论、丢掉「为什么」，是新会话重推出不同结论的根因（`packages/agent/src/compaction/prompts/compaction-summary.md`）
- memory consolidation 修复：模型输出预算全花在推理上时不再报 "phase2 JSON parse failure"；截断/空输出如实报告为截断而非误导性的 JSON 解析失败

## 3. 杂项

- fork 分歧政策与同步 SOP（`docs/local/fork-divergence.md` + `.omp/RULES.md`）
- `.fat/` 运行时目录加入 gitignore
- `bun.lock` 还原为上游版本

## 文档位置

| 文档 | 内容 |
|---|---|
| `docs/local/CHANGELOG.zh.md` | 本文件，中文简要说明 |
| `docs/local/fork-divergence.md` | fork 分歧政策、冲突热点清单、同步 SOP |
| `docs/local/project-asset-anchors.md` | asset-anchors 框架设计 |
| `packages/coding-agent/CHANGELOG.md` | 英文详细条目（上游规范） |