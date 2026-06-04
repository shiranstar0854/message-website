# Message Choose 用户操作说明

本文档适用于当前版本的 Message Choose 信息筛选与摘要网站。

## 1. 页面入口

- `index.html`：信息流首页，用于查看科技、金融、新闻信息流。
- `daily-summary.html`：每日摘要页，只展示科技、金融、新闻三类每日重要事务总结。
- `weekly-review.html`：每周复盘页，展示最近归档数据形成的周度复盘。
- `history.html`：历史信息页，网页展示最近 10 天每日归档，GitHub 归档目录保留全部每日 JSON。
- `about.html`：关于与规则页，说明来源类型、评分规则、摘要风险和更新时间。

线上入口：

```text
https://0854937.xyz/
```

站内页面切换已加入淡入淡出的动态效果。

## 2. 普通用户使用

### 信息流首页

首页支持：

- 今日核心热点 Top 5：按评分和发布时间选出最值得先看的 5 条信息，展示标题、简短解释、重要性、影响领域、来源、频道、发布时间和评分。
- 频道概览：用紧凑横向条显示科技、金融、新闻信息数量，不占用首屏头部空间。
- 顶部关键词搜索：匹配标题、摘要、正文摘录、中文摘要、来源、标签和关键词；多个关键词用空格分隔时默认全部命中。搜索排序依次考虑标题匹配、关键词匹配、相关度、时间新鲜度和热度评分。
- 来源状态：显示活跃来源、异常来源、最近检查和最近成功时间。
- 手机首页：卡片间距和字号按窄屏压缩，顶部搜索入口保留。

评分综合来源可信度、关键词命中、发布时间新鲜度、重复/聚合信号、频道权重和官方来源加权。评分只用于排序，不代表投资建议或事实核验结论。

英文来源会优先展示中文标题和中文摘要；原英文标题与原文入口保留，便于回到来源核对。

### 每日摘要

打开：

```text
https://0854937.xyz/daily-summary.html
```

每日摘要只展示：

- 科技重要事务总结
- 金融重要事务总结
- 新闻重要事务总结

每类摘要下方有“查看依据条目”，默认折叠，用于追溯摘要来源。

### 每周复盘

打开：

```text
https://0854937.xyz/weekly-review.html
```

每周复盘包含：

- 周度总览
- 各频道复盘
- 主要来源
- 高分重点条目
- 后续关注点

### 历史信息

打开：

```text
https://0854937.xyz/history.html
```

历史页只展示最近 10 天每日归档。选择日期后可查看当天信息条目；更早的每日 JSON 继续保存在 GitHub 的 `data/archive/daily/` 目录中。

## 3. 自动化时间

自动化由 Cloudflare Workers Cron 触发 GitHub Actions。

### 每日信息流更新

用途：抓取 RSS 和官方网页来源、标准化、过滤、去重、评分、文章富化、生成首页信息流、静态摘要、来源审计和每日归档。

时间：

```text
北京时间 08:00
```

补偿触发：

```text
北京时间 08:30
```

Cloudflare UTC cron：

```text
0 0 * * *
30 0 * * *
```

对应 GitHub Actions workflow：

```text
.github/workflows/daily-update.yml
```

### 每日摘要更新

用途：基于当天最新信息流生成科技、金融、新闻三类每日重要事务摘要。

时间：

```text
北京时间 19:00
```

补偿触发：

```text
北京时间 19:30
```

Cloudflare UTC cron：

```text
0 11 * * *
30 11 * * *
```

对应 GitHub Actions workflow：

```text
.github/workflows/daily-summary.yml
```

### 每周复盘

时间：

```text
北京时间每周一 09:00
```

Cloudflare UTC cron：

```text
0 1 * * 1
```

对应 GitHub Actions workflow：

```text
.github/workflows/weekly-review.yml
```

## 4. DeepSeek 配置

DeepSeek API Key 不应出现在公共访问页面、前端脚本、JSON 数据或仓库明文文件中。

正确位置：

```text
GitHub 仓库
Settings
Secrets and variables
Actions
Repository secrets
DEEPSEEK_API_KEY
```

可选模型变量：

```text
GitHub 仓库
Settings
Secrets and variables
Actions
Variables
DEEPSEEK_MODEL
```

默认模型：

```text
deepseek-v4-flash
```

接口：

```text
https://api.deepseek.com/chat/completions
```

JSON 输出模式：

```json
{
  "response_format": {
    "type": "json_object"
  }
}
```

如果 DeepSeek 调用失败，自动化不会中断，会回退到本地规则摘要。

## 5. 管理员常用命令

本地预览：

```bash
npm.cmd run serve
```

运行测试：

```bash
npm.cmd test
```

生成信息流数据，不生成每日摘要：

```bash
npm.cmd run build:data
```

只抓取中国官方网页来源：

```bash
npm.cmd run fetch:web
```

完整信息流更新：

```bash
npm.cmd run update:daily
```

生成每日摘要：

```bash
npm.cmd run update:summary
```

生成每周复盘：

```bash
npm.cmd run review:weekly
```

部署 Cloudflare Worker：

```bash
cd external-scheduler/cloudflare
npx.cmd --yes wrangler@latest deploy
```

## 6. 数据文件

前端数据：

- `src/data/latest-items.json`：首页信息流数据
- `src/data/daily-summary.json`：每日三类摘要数据
- `src/data/weekly-review.json`：每周复盘数据
- `src/data/history-index.json`：历史归档索引
- `src/data/source-health.json`：来源健康状态

归档数据：

- `data/archive/daily/`：每日归档 JSON，GitHub 中完整保留；网页历史页只索引最近 10 天
- `data/archive/weekly/`：每周复盘历史

处理数据：

- `data/raw/rss-items.json`
- `data/raw/webpage-items.json`
- `data/normalized/normalized-items.json`
- `data/processed/filtered-items.json`
- `data/processed/deduped-items.json`
- `data/processed/scored-items.json`
- `data/processed/article-enrichment.json`
- `data/processed/ai-summaries.json`
- `data/processed/source-audit.json`

## 7. 常见问题

### 信息流没有更新

检查：

```text
GitHub Actions -> Daily information update
```

确认最近一次运行是否成功。

### 每日摘要没有更新

检查：

```text
GitHub Actions -> Daily summary update
```

确认最近一次运行是否成功。

### 每日摘要没有使用 DeepSeek

检查 `src/data/daily-summary.json`：

```json
{
  "llmConfigured": true,
  "fallbackCount": 0,
  "errorCount": 0
}
```

如果 `llmConfigured` 是 `false`，说明 GitHub Actions 没有读取到 `DEEPSEEK_API_KEY`。

如果 `errorCount` 大于 `0`，说明 DeepSeek 请求或 JSON 解析失败，系统会自动回退到本地摘要。

### Cloudflare 没有触发

检查 Cloudflare Worker：

```text
message-website-scheduler
Triggers / Cron
```

应包含：

```text
0 0 * * *
30 0 * * *
0 11 * * *
30 11 * * *
0 1 * * 1
```

### API Key 会不会暴露

不会。当前设计中：

- 前端页面不调用 DeepSeek。
- DeepSeek 只在 GitHub Actions 里调用。
- API Key 存在 GitHub Actions Repository Secret。
- 发布到网站的数据只包含摘要结果，不包含密钥。

## 8. 修改后发布流程

推荐流程：

```bash
npm.cmd test
git status --short
git add -A
git commit -m "Your change message"
git pull --rebase origin main
git push origin main
```

如果改了 Cloudflare 调度配置，还需要重新部署 Worker：

```bash
cd external-scheduler/cloudflare
npx.cmd --yes wrangler@latest deploy
```
Automation schedule note: daily information updates run at Beijing 08:00 and 17:00. Each run has a delayed compensation trigger 30 minutes later, at 08:30 and 17:30. Items outside the 48-hour freshness window are not published; sources with no fresh items remain enabled and visible as empty rather than failed.
