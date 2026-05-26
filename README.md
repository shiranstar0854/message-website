# Message Choose

面向科技、金融、新闻三类信息的静态信息筛选网站。当前版本已实现 `task.md` 的前四个阶段：

1. 静态网站框架和演示数据。
2. RSS 与官方 API 来源配置、抓取脚本、统一字段标准化。
3. 过滤、去重、评分和 `src/data/latest-items.json` 生成流程。
4. GitHub Actions 每日更新、来源审计和每日归档。

阶段 5-6 的 AI 摘要、每周复盘和反馈优化暂未实现。

## 本地使用

直接打开 `index.html` 可以查看静态演示页面。使用本地服务器访问时，页面会读取 `src/data/latest-items.json` 和 `public/site-config.json`。

```bash
npm.cmd test
npm.cmd run build:data
npm.cmd run update:daily
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

`.github/workflows/daily-update.yml` 每天北京时间 `08:17` 自动更新 RSS 数据，也支持在 GitHub Actions 页面手动触发。更新任务会在来源短暂不可访问时保留上一份有效数据，并生成来源审计和每日归档。

## 数据字段

标准化后的信息至少包含：

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
