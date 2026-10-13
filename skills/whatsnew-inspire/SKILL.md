---
name: whatsnew-inspire
description: Synthesize one feasible new project from a complete WhatsNew Top 100 analysis, using traceable repository evidence and explicit demand hypotheses. Use only when the user manually requests inspiration after all catalog entries pass analysis and results are displayed.
---

# 灵感乍现契约

仅在用户手动点击「灵感乍现」或「换一换」后执行；全部项目分析结果须已得到并展示。不得附加在一键分析中自动执行。

只有输入恰好包含 100 个已通过项目分析契约的不同仓库才生成灵感。阅读整个列表，按用途、受众、能力与明确限制寻找共同主题或可组合的工作流，选择一个小团队可制作的本地网页 MVP。

换一换时，读取宿主传入的 `previousIdeas`，选择与已展示构想不同的核心问题、目标工作流或功能组合；不能只换标题。旧构想只用于排除重复，不作为事实来源。重新生成失败时保留原构想，避免用户丢失已得到的内容。

只输出一个构想。它必须包含：

- `title`：3–40 字项目名；`summary`：20–200 字项目内容简介。
- `problem`：30–500 字“现有问题”。仅把输入原文明确表述的问题当事实；由功能组合推导的痛点标为“需求假设，需用户验证”。不声称“市场空白”“唯一产品”或已证明的用户需求。
- `audience`：5–120 字具体使用者；`differentiation`：20–300 字说明与参考项目的不同及为何值得尝试。
- `evidence`：3–6 个不同输入仓库，每项为 `id`、`observation`、`source`、`quote`。引用必须来自该仓库输入字段，且观察能由引用直接支持；不能仅凭 Stars 把热度当成需求证明。
- `features`：3–5 个具体 MVP 功能，单条 10–150 字；避开“完整平台”“全面生态”等无限范围。
- `validation`：2–4 个验证需求或可用性的具体方法，单条 10–180 字；明确这是待验证建议。
- `risks`：1–4 条技术、采用或许可证风险，单条 10–180 字。许可证兼容未知时明确核验，不替参考项目授予权利。

通过 `submit_inspiration` 结构化提交；先检查引用与 ID。宿主只接收通过校验的一项。自然语言或 JSON 文本不作为产物。宿主最多允许两次补交。

生成构想不意味着启动实现。卡片显示“要我帮你实现吗？”按钮；只有用户点击后才能进入新项目撰写流程。不要自动下载依赖、修改已有项目、发布、发消息或生成第二个构想。

保留证据范围：原文只针对某些组件、某个平台或某种安装方式时，问题描述同样保留限定。不能从一句缺少主语的片段推断整个项目；先核对已分析的能力/限制描述，无法确定时将范围标为未知。
