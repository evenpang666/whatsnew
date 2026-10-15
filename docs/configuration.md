# 配置与 Token 费用

[返回 README](../README.md) · [文档目录](README.md)

## 可选配置

- `config/github.token`：优先使用运行服务的数据目录下的这个文件。填写单行 GitHub Token；也可通过页面「设置」中的 [GitHub Token 管理链接](https://github.com/settings/tokens) 和保存按钮配置，支持删除。保存使用文件权限 `0600`，后续请求立即读取，无需重启；状态接口只显示是否配置和来源，不返回密钥；此文件排除在源码和插件包之外。
- `GITHUB_TOKEN`：本地 Token 文件不存在时使用的环境变量。文件为空或无效时明确提示修正，不静默切换其他身份。建议仅授予读取公开仓库所需的权限。
- `WHATSNEW_PORT`：独立启动器端口，默认 `3210`。
- `DSH_HOME`：现有 dsh 配置目录，默认 `~/.dsh`。
- `DSH_BIN`：dsh 的 `lib/bin.js` 绝对路径，用于非标准安装。
- `WHATSNEW_NO_OPEN=1`：启动服务但不自动打开浏览器。

如果装入 dsh web，端口和数据目录可以在 profile 的 `cordis.patch.yml` 覆盖：

```yaml
- id: whatsnew
  config:
    port: 3210
    root: /你的数据目录
```

后端默认监听 `0.0.0.0`，允许本机与检测到的 `192.168.*.*` IPv4 Host，无设备配对。所有浏览器从同站接口取得自动请求 Token，保留 Host／Origin／跨站校验。可在插件配置中设置 `host: 127.0.0.1` 改为仅本机访问。插件不执行下载项目的代码。

## 本次 Token 与费用

一键分析与手动灵感生成分别统计，完成后以小字显示在对应按钮右侧。按任务中所有 dsh Agent 的实际会话用量汇总，包括补交、模型重试和失败尝试；使用 dsh 原生 Token-meter 折叠完整调用生命周期。输入、缓存读取、缓存写入与输出独立计数，思考 Token 已包含在输出，不重复相加。费用仅覆盖本按钮的任务，不包含宿主其他会话。

费用单位 **USD**，使用 [DeepSeek 官方价格](https://api-docs.deepseek.com/quick_start/pricing/) 的峰谷价格范围估算，核验日期为 **2026-10-13**。Flash：每百万未缓存输入 $0.15–0.30、缓存读取 $0.003–0.006、输出 $0.60–1.20；V4 Pro：分别 $0.66–1.32、$0.022–0.044、$1.98–3.96。接入平台收费可能不同，实际以账单为准。

不知道的模型报价显示「费用无法完整估算」；部分调用未返回用量时显示已报告 Token 下界及缺失提示，不当作免费。旧 dsh 缺少原生计量接口时同样使用下界标注。复用项目分析缓存且没有模型调用时，本次为 0 Token／$0；不沿用上次费用。

自定义或中转模型可在插件配置中覆盖 USD／百万 Token 单价：

```yaml
- id: whatsnew
  config:
    port: 3210
    root: /你的数据目录
    pricing:
      input: 0.30
      cacheRead: 0.006
      output: 1.20
      # cacheWrite: 0.30  # 模型实际计费包含缓存写入时填写
```

以上费率保留原文的核验日期；运行时的估算实现见 `src/usage.js`，配置价格时请按实际平台账单填写。

## 独立 DeepSeek API Token

在左侧「设置」保存或删除独立 DeepSeek API Token。Token 保存在服务电脑数据目录的 `config/deepseek.token`，优先于 `DEEPSEEK_API_KEY`；没有独立凭证时沿用 dsh 当前模型配置。独立凭证使用 dsh 内置 DeepSeek 官方适配器的默认模型，作用于项目分析、灵感生成与项目实现，下一次调用生效，无需重启。此配置使用独立 provider，不改写 dsh 共享设置或凭证。

保存采用原子替换与文件权限 `0600`，状态接口只返回是否启用及来源，不返回密钥。Token 文件及临时文件均已加入 `.gitignore`，静态服务不提供访问；演示模式不保存 Token。
