# Message Choose

面向科技、金融、新闻三类信息的静态信息筛选网站。当前版本已实现 `task.md` 的前五个阶段基础能力：

1. 静态网站框架和演示数据。
2. RSS、官方网页与官方 API 来源配置、抓取脚本、统一字段标准化。
3. 过滤、去重、评分和 `src/data/latest-items.json` 生成流程。
4. GitHub Actions 每日更新、来源审计和每日归档。
5. 每日摘要字段、首页核心热点、来源透明度、每周复盘数据和 Cloudflare 远端周报触发。

阶段 5 当前使用无需外部密钥的确定性摘要基线，后续可替换为 AI 大模型生成；阶段 6 的反馈优化暂未实现。

## 本地使用

直接打开 `index.html` 可以查看静态演示页面。使用本地服务器访问时，页面会读取 `src/data/latest-items.json` 和 `public/site-config.json`。

```bash
npm.cmd test
npm.cmd run build:data
npm.cmd run update:daily
npm.cmd run review:weekly
```

如需分别抓取真实 RSS 与官方网页数据：

```bash
npm.cmd run fetch:rss
npm.cmd run fetch:web
npm.cmd run normalize
npm.cmd run filter
npm.cmd run dedupe
npm.cmd run score
npm.cmd run generate:latest
```

官方网页来源用于接入中国政府网、人民银行、证监会、交易所、国家发展改革委、财政部、国家统计局、科技部等公开渠道。官方 API 来源默认关闭；需要密钥的来源应先在环境变量中配置对应 key，再把配置文件里的 `enabled` 改为 `true`。

## 自动更新

`.github/workflows/daily-update.yml` 通过 `workflow_dispatch` 执行信息流更新，由托管在 Cloudflare Workers Cron 的外部定时任务于每日北京时间 `08:00` 触发；若当天没有检测到成功的主触发运行，则在 `08:30` 补偿触发一次。`.github/workflows/daily-summary.yml` 于每日北京时间 `19:00` 生成每日摘要；若当天没有检测到成功的主触发运行，则在 `19:30` 补偿触发一次。`.github/workflows/weekly-review.yml` 由同一个 Cloudflare Worker 于每周一北京时间 `09:00` 触发。Cloudflare 调度器实现位于 `external-scheduler/cloudflare/`，部署时通过 Worker Secret 保存受限 GitHub Token，不依赖本机定时任务。信息流更新会在来源短暂不可访问时保留上一份有效数据，并刷新来源审计和当天最新归档；摘要更新会基于当天最新信息流生成三类每日摘要。`scripts/trigger-daily-update.ps1` 仅用于本机手动验证触发链路。

## 数据字段

处理管线中的标准化信息至少包含：

- `id`
- `title`
- `url`
- `source`
- `sourceType`
- `category`
- `publishedAt`
- `summary`
- `fetchedAt`
- `sourceLastCheckedAt`
- `sourceAuthority`
- `timelinessTier`
- `credibility`
- `tags`

评分后会增加 `score`、`scoreBreakdown`、`duplicateCount` 和 `duplicates`。

前端发布文件 `src/data/latest-items.json` 为轻量展示结构，仅保留页面需要的 `id`、`title`、`translatedTitle`、`url`、`source`、`sourceType`、`category`、`publishedAt`、`fetchedAt`、`sourceLastCheckedAt`、`sourceAuthority`、`timelinessTier`、`summary`、`contentExcerpt`、`aiSummary`、`summaryReason`、`importance`、`impactAreas`、`sourceLanguage`、`summaryLanguage`、`tags`、`keywords`、`score` 和 `duplicateCount` 等字段。英文来源条目会进入 AI 中文摘要队列，前端优先展示中文 `translatedTitle` 和 `aiSummary`，并保留英文原文入口。首页会基于评分和发布时间生成“今日核心热点 Top 5”；关键词搜索会匹配标题、摘要、中文摘要、标签和 `keywords`，并按标题匹配、关键词匹配、相关度、时间新鲜度和热度排序。每周复盘输出到 `src/data/weekly-review.json`，历史周报保存在 `data/archive/weekly/`。

## DeepSeek 摘要页面

- `daily-summary.html` 读取 `src/data/daily-summary.json`，只展示科技、金融、新闻三类每日重要事务总结。
- `weekly-review.html` 读取 `src/data/weekly-review.json`。
- `history.html` 读取 `src/data/history-index.json`，并展示最近 10 天每日归档；`data/archive/daily/` 中的每日 JSON 作为 GitHub 历史记录完整保留。
- `about.html` 说明来源类型、评分规则、摘要风险、非投资建议和更新时间。
- 模型接口默认配置为 DeepSeek Chat Completions：`https://api.deepseek.com/chat/completions`。
- 自动化启用模型调用前，需要在 GitHub Actions secrets 配置 `DEEPSEEK_API_KEY`，并将 `config/ai-summary-rules.json` 的 `llmProduction.enabled` 改为 `true`。
Automation note: the daily information workflow now runs at Beijing 08:00 with a 08:30 retry, and again at Beijing 17:00 with a 17:30 retry. The corresponding Cloudflare UTC crons are `0 0 * * *`, `30 0 * * *`, `0 9 * * *`, and `30 9 * * *`. Sources that have no items inside the 48-hour freshness window remain enabled and visible as `empty`; they are not treated as failed, and stale cached items are not republished.
