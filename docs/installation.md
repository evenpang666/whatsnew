# 安装与启动

[返回 README](../README.md) · [文档目录](README.md)

## 环境与独立启动

先安装 **Node.js 22+** 和 **dsh**，并在 `dsh web` 中配置可用模型：

```sh
npm install -g @deepseek-ai/dsh
dsh web
```

升级已有运行实例时，先关闭旧启动终端或停止旧 dsh web 服务，再重新启动。

然后在本项目文件夹内双击：

| 系统 | 启动文件 |
| --- | --- |
| Windows | `Start.bat` |
| macOS | `Start.command` |
| Linux | `WhatsNew.desktop`，或用文件管理器选择运行 `start.sh` |

Linux 桌面环境可能需要在首次打开时选择“允许启动”。如果移动了项目文件夹，运行 `node scripts/create-shortcut.mjs` 更新 Linux 快捷方式。macOS 如果解压后丢失执行权限，运行 `chmod +x Start.command start.sh`。

启动后自动打开 **http://127.0.0.1:3210**。「在局域网其他设备上继续探索」只显示 `192.168.*.*` 网段的 IPv4（例如 `192.168.124.62`），过滤 10／172 网段与 IPv6；地址来自当前网卡并自动刷新。手机连接同一个局域网，打开该 URL 即可查看与操作，无需配对码。也可以直接运行 `npm start`。启动终端保持打开；按 `Ctrl+C` 停止服务。重复启动会打开已运行的正式服务。

无需安装本项目依赖或编译。启动脚本在 `.runtime/dsh` 创建独立 profile，通过路径复用现有 dsh 的模型设置与凭证，不复制 API Key，不安装或改写现有 web profile。自定义 provider 若依赖额外的插件，请使用下面的安装进原 web profile 方式，以保留它的完整配置树。

## 安装进已有 dsh web

```sh
npm pack
dsh plugin --profile web add /绝对路径/dsh-whatsnew-0.6.1.tgz
dsh web
```

插件随 dsh web 启动，探索页位于 **http://127.0.0.1:3210**，原 dsh 聊天页仍由它自己的端口提供。不要同时运行独立启动器和已安装的同端口插件。

已验证的运行时：`@deepseek-ai/dsh 0.1.5-rc.2`、Node.js 22。dsh 仍在快速迭代，后续版本需要复核服务接口。

更多环境变量与局域网设置见[配置与费用](configuration.md)，启动异常见[问题处理](troubleshooting.md)。
