# 数据来源、统计口径与存储

[返回 README](../README.md) · [文档目录](README.md)

- 榜单项目范围按 **Star 总数** 获取；新增 Star 排序是在这 100 项目内部重排，不宣称全 GitHub 增星前 100。历史缺失项排在末尾且不编号，未获取数据不会记作零；有 GitHub 创建日期依据时，创建前的日期可确定为零，创建后的缺失日仍视为未知。无 Token 的 API 额度可能无法一次覆盖全部 100 项；显示当前覆盖数，额度恢复或配置 Token 后可重新采集。热门榜单按 **Star 总数** 排序，属于累计热度榜，**不是 GitHub Trending 日榜**。排除 Fork，不限定语言，不排除归档项目。搜索使用 `stars:>10000` 缩小查询范围；只有返回完整 100 项且没有 `incomplete_results` 才接受，因此仍能覆盖全局前 100。
- GitHub 不提供仓库源码总下载次数。页面仅展示 Release 附件的 `download_count` 之和；没有 Release 时显示“未提供”。超过 100 个 Release 时明确标记“最近 100 个 Release 的资产下载量”。
- Star/Fork 总数是榜单采集时快照，Release/提交信息按需读取并缓存 10 分钟；检查更新和下载会强制刷新版本。Star 趋势独立查询 `/repos/{owner}/{repo}/stargazers/history`（API 版本 `2026-03-10`），按 GitHub 提供的周数据和每日计数还原每日新增 Star，按需分页，缓存 6 小时，支持手动刷新。当天数据尚未结束，日界限沿用 GitHub；新增计数不等于净增长或当日累计 Star。查询失败显示错误与重试按钮，不使用本地采样替代。
- README 当前读取默认分支的 `README.md`，最多截取 10,000 字符；不可用时用描述和 Topics 分析，并在详情标注依据。GitHub 无 Token 有较低的请求额度，详情需要更多请求。
- 累计获星按项目创建日起的官方每日新增求和，逐日累计值随原始历史持久化，不扣取消星标。首次读取完整生命周期；后续更新复查缓存末日前 30 天并补齐至今，保留更早已验证的数据。该增量更新不会主动复查重叠区间之前的历史修订；缓存缺失或不完整时重新采集全量。历史采集最多 3 个项目并发，周／月图表和页面轮询复用计算结果。
- ZIP 更新比较正式 Release 标签或默认分支 SHA；Git 比较当前分支 HEAD 与从该 GitHub 分支 fetch 的提交。同一标签被强制重打的场景暂不识别，后台不提供无人值守定时推送。
- 分析记录在 `.runtime/state.json`，源码 ZIP 和克隆目录在 `downloads/`，ZIP 元数据同时在 `downloads/.whatsnew-index.json`。已下载标记来自文件系统扫描；删除源码会在下一次扫描后取消标记，删除运行缓存也能从目录重新识别。每 15 秒最多扫描一次，下载／克隆／拉取后及检查更新时立即重扫。目录扫描忽略符号链接，最多向下 6 层、2000 个目录；超出限制会在页面提示。Git 无 origin 或 origin 非 GitHub 的仓库视为本地项目；含多个同 ID Git 工作目录时检查与拉取覆盖各目录。模型分析可能有分类偏差，可在 GitHub 查看原始项目核实。

官方协议参考：[GitHub Repository Search](https://docs.github.com/en/rest/search/search#search-repositories)、[GitHub Releases](https://docs.github.com/en/rest/releases/releases)、[GitHub Release Assets](https://docs.github.com/en/rest/releases/assets)、[GitHub Star History](https://docs.github.com/en/rest/activity/starring#get-repository-star-history)、[DeepSeek Harness 插件发布](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)。
