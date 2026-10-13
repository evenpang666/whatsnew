---
name: whatsnew-build
description: Write a runnable local web MVP for a user-selected WhatsNew inspiration, submitting files into an isolated generated project directory. Use only after the user clicks the implementation action.
---

# 新项目撰写契约

将已确认的灵感写成可运行的小型网页 MVP。先在 README 写清现有问题（区分事实与需求假设）、项目简介、范围、数据来源、启动步骤与尚未验证的需求。实现灵感的核心交互，不用静态按钮代替承诺的功能；无法离线实现的外部服务能力明确留作配置点，界面不能伪造成功结果。

采用 Node.js 22+ 与原生 HTML/CSS/JS，无第三方依赖。只通过 `write_project_file` 提交这些文件：`package.json`、`README.md`、`server.mjs`、`public/index.html`、`public/app.js`、`public/style.css`。每次只提交一份完整文件，字符串作为工具参数交付，不输出整包 JSON，不使用 Markdown 代码块作交付。

- package.json 必须含 `type: module` 与 `scripts.start: node server.mjs`；不得添加其他执行脚本或依赖。
- server.mjs 只监听 127.0.0.1，默认端口 3215，可用 PORT 覆盖；以模块目录为根，只暴露本项目页面、必要 API 和本项目数据，拒绝路径穿越。不读取宿主凭证、其他项目或用户目录，不执行系统命令，不外发数据。
- 页面中文、响应式、键盘可用；核心功能真正工作，持久化数据明确存储位置；不在网页写入密钥。
- 不复制参考仓库源码，基于灵感独立撰写。引用仅用于解释设计依据与待核验的许可证。
- 不编造安装命令、支持平台、完整仓库许可或人工核验日期。输入证据未覆盖的字段标为“待核验”或由用户录入；生成日期不等于人工核验日期。局部组件的 source-available 等限制只能标到这些组件，不能替整个仓库定性。

完成全部文件后调用 `finish_project`。宿主检查所需文件、package.json 与 JavaScript 语法；收到错误时改写指定文件并重试，最多两轮补交。通过之前不能宣称“已完成”。

文件仅写入宿主新建的 generated-projects 子目录。不要安装、运行或发布生成代码；用户获得路径与源码 ZIP 后自行审阅并启动。实现只代表 MVP 骨架和核心交互，不声称生产部署或需求验证已经完成。
