# 安装与启动

[返回 README](../README.md) · [文档目录](README.md)

## 环境与独立启动

可直接使用下方启动文件。启动器检查 **Node.js 22+、npm、DSH ≥ 0.2.0-rc.2、pnpm**。已有 DSH 低于要求时，在 `$DSH_HOME/runtimes/web/versions/0.2.0-rc.2` 安装并校验目标版本，然后切换运行入口；四个插件共用此目录。符合要求的版本直接复用，不查询 `latest`，不降级新版。每次 DSH 版本变化后自动重新注册 Web 插件，注册成功后才记录版本。

缺少兼容 Node.js/npm 时，Windows、macOS、Linux 启动文件会下载项目内运行环境，并校验官方 SHA-256；已有兼容环境直接复用。缺少 DSH 或 pnpm 时通过 npm 补装到 `.runtime/tools`。固定补装版本见 `scripts/runtime-versions.json`：Node.js 22.23.3、DSH 0.2.0-rc.2、pnpm 12.3.4；已有 Web profile 要求特定 pnpm 时，优先复用匹配的大版本，否则并列补装该 profile 指定版本，并沿用其 store 路径。

首次补装需要联网；Linux/macOS 需有 `curl` 或 `wget`、`tar` 和 SHA-256 工具。自动 Node.js 下载支持 x64、arm64；其他架构需自行提供兼容 Node.js/npm。环境完整时检查只运行本机版本命令，启动不因存在新版而下载。

已有 Node.js/npm 时可单独检查、补齐环境：

```sh
npm run env:check
# 打开已有或项目内补装的 DSH，配置模型
npm run dsh -- web
```

升级已有运行实例时，先关闭旧启动终端或停止旧 dsh web 服务，再重新启动。

在本项目文件夹内双击：

| 系统 | 启动文件 |
| --- | --- |
| Windows | `Start.bat` |
| macOS | `Start.command` |
| Linux | `WhatsNew.desktop`，或用文件管理器选择运行 `start.sh` |

Linux 桌面环境可能需要在首次打开时选择“允许启动”。如果移动了项目文件夹，运行 `node scripts/create-shortcut.mjs` 更新 Linux 快捷方式。macOS 如果解压后丢失执行权限，运行 `chmod +x Start.command start.sh`。

启动后自动打开 **http://127.0.0.1:3210**。「在局域网其他设备上继续探索」只显示 `192.168.*.*` 网段的 IPv4（例如 `192.168.124.62`），过滤 10／172 网段与 IPv6；地址来自当前网卡并自动刷新。手机连接同一个局域网，打开该 URL 即可查看与操作，无需配对码。也可以直接运行 `npm start`。启动终端保持打开；按 `Ctrl+C` 停止服务。重复启动会打开已运行的正式服务。

无需安装本项目依赖或编译。启动脚本在 `.runtime/dsh` 创建独立 profile，通过路径复用现有 dsh 的模型设置与凭证，不复制 API Key，不安装或改写现有 web profile。自定义 provider 若依赖额外的插件，请使用下面的安装进原 web profile 方式，以保留它的完整配置树。

## 安装进已有 dsh web

在项目目录运行以下命令，将当前源码注册为 Web profile 的插件：

```sh
npm run dsh:register
dsh web
```

注册使用 DSH 官方的 `plugin --profile web add link:项目绝对路径` 命令，可重复执行，保留其他插件和模型配置。使用 `DSH_HOME` 可指定现有 DSH 配置目录，`DSH_BIN` 可指定 dsh 入口文件。若 dsh web 已在运行，注册后重启原服务。

在 DSH Web 插件库中可以看到 **WhatsNew · GitHub 开源雷达**、中英文简介和绿色 logo，并能管理该 bundle。每次插件成功加载后，终端会打印：

```text
[DSH 插件] WhatsNew · GitHub 开源雷达 (whatsnew) · 已加载
[DSH 插件]   本机：http://127.0.0.1:3210
```

也可以打包安装到其他机器：

```sh
npm pack
dsh plugin --profile web add /绝对路径/dsh-whatsnew-0.6.1.tgz
dsh web
```

插件随 dsh web 启动，探索页位于 **http://127.0.0.1:3210**，原 dsh 聊天页仍由它自己的端口提供。不要同时运行独立启动器和已安装的同端口插件。

未配置 `root` 时，插件使用自身所在的项目目录保存数据，与启动 `dsh web` 的工作目录无关。在 Web profile 的 `cordis.patch.yml` 中可用 `id: whatsnew` 的 `config` 覆盖 `root`、`port`（默认 3210）和 `host`。

已验证的运行时：`@deepseek-ai/dsh 0.2.0-rc.2`、Node.js 22，包括插件库元数据读取和真实 DSH Web 启动加载。

更多环境变量与局域网设置见[配置与费用](configuration.md)，启动异常见[问题处理](troubleshooting.md)。
