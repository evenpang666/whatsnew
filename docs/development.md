# 开发与结构化交付

[返回 README](../README.md) · [文档目录](README.md)

## 开发与验证

```sh
npm run check
npm test
npm run demo
```

演示页在 `http://127.0.0.1:3211`，仅供离线界面体验，明确标注示例数据，不调用模型也不执行下载。演示和正式缓存相互独立。

自动测试覆盖：分析输出校验、失败续跑、下载完成与失败状态、下载项目跌出榜单、Release/Commit 更新判断、Release 下载统计，HTTP 防跨站保护、官方 Star 历史分页、首轮查询、历史缓存与旧采样迁移。

## 主要源码

主要源码：`src/plugin.js` 原生插件入口；`src/analyzer.js` dsh Agent 驱动；`src/github.js` 数据口径；`src/service.js` 状态和下载；`src/server.js` 本机 HTTP；`public/` 界面。

## 插件集成

插件通过 `package.json` 的 `dsh.bundle.patch` 与 `cordis.patch.yml` 加载；注册 `whatsnew_top`、`whatsnew_project`、`whatsnew_history` 三个工具，并通过 `ctx.agents.create()` 使用当前配置的模型生成分析。用于分析、灵感和撰写的 Agent 禁用全局工具，仅暴露当前阶段的结构化提交工具。README 作为不可信数据处理，输出须通过 ID、类别、字段长度、数量和引用匹配校验后才进入展示。

## 内置 Skills 与结构化交付

三个 Skill 随插件打包，运行每种任务时读取相应 `SKILL.md` 并显式应用：

- [`whatsnew-analyze`](../skills/whatsnew-analyze/SKILL.md)：逐项目（包括本地 Git）确定用途、受众、类别、标签、能力和明确限制，每条能力/限制的引用必须匹配原始描述、Topics 或 README。
- [`whatsnew-inspire`](../skills/whatsnew-inspire/SKILL.md)：覆盖全量 100 项，生成一个有来源的新项目构想，区分事实与需求假设。
- [`whatsnew-build`](../skills/whatsnew-build/SKILL.md)：仅在用户点击实现按钮后逐文件撰写，限制在独立目录和六个允许文件，不安装、执行或发布代码。

旧失败响应曾被模型标记 completed，却缺少最后的 `}` 或 `]`。新版不解析模型的最终自然语言 JSON，而以 `submit_project_analysis`、`submit_inspiration`、`write_project_file` 和 `finish_project` 的结构化提交为结果依据。模型收到字段/证据错误后修正该项；通过结果立即保存，避免一条残缺响应损失整批。Skill 指令配合宿主校验，不能替代功能实测或对需求的真实验证。

历次实测和版本回归记录见[验证记录](verification-history.md)。
