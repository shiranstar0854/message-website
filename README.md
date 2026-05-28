# Message Choose

面向科技、金融、新闻三类信息的静态信息筛选网站。当前版本已实现 `task.md` 的前五个阶段基础能力：

1. 静态网站框架和演示数据。
2. RSS 与官方 API 来源配置、抓取脚本、统一字段标准化。
3. 过滤、去重、评分和 `src/data/latest-items.json` 生成流程。
4. GitHub Actions 每日更新、来源审计和每日归档。
5. 每日摘要字段、首页摘要展示、每周复盘数据和 Cloudflare 远端周报触发。

阶段 5 当前使用无需外部密钥的确定性摘要基线，后续可替换为 AI 大模型生成；阶段 6 的反馈优化暂未实现。

## 本地使用

直接打开 `index.html` 可以查看静态演示页面。使用本地服务器访问时，页面会读取 `src/data/latest-items.json` 和 `public/site-config.json`。

```bash
npm.cmd test
npm.cmd run build:data
npm.cmd run update:daily
npm.cmd run review:weekly
```

如需抓取真实 RSS 数据：

```bash
npm.cmd run fetch:rss
npm.cmd run normalize
npm.cmd run filter
npm.cmd run dedupe
npm.cmd run score
npm.cmd run generate:latest
```

官方 API 来源默认关闭。需要密钥的来源应先在环境变量中配置对应 key，再把配置文件里的 `enabled` 改为 `true`。

## 自动更新

`.github/workflows/daily-update.yml` 通过 `workflow_dispatch` 执行更新，由托管在 Cloudflare Workers Cron 的外部定时任务于每日北京时间 `08:00` 触发；若当天没有检测到成功的主触发运行，则在 `08:30` 补偿触发一次。`.github/workflows/weekly-review.yml` 由同一个 Cloudflare Worker 于每周一北京时间 `09:00` 触发。Cloudflare 调度器实现位于 `external-scheduler/cloudflare/`，部署时通过 Worker Secret 保存受限 GitHub Token，不依赖本机定时任务。更新任务会在来源短暂不可访问时保留上一份有效数据，并刷新来源审计、每日摘要和当天最新归档。`scripts/trigger-daily-update.ps1` 仅用于本机手动验证触发链路。

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
- `credibility`
- `tags`

评分后会增加 `score`、`scoreBreakdown`、`duplicateCount` 和 `duplicates`。

前端发布文件 `src/data/latest-items.json` 为轻量展示结构，仅保留页面需要的 `id`、`title`、`url`、`source`、`sourceType`、`category`、`publishedAt`、`summary`、`contentExcerpt`、`aiSummary`、`summaryReason`、`tags`、`score` 和 `duplicateCount` 等字段。每周复盘输出到 `src/data/weekly-review.json`，历史周报保存在 `data/archive/weekly/`。
