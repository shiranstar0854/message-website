# 来源清单

当前来源按 `tech`、`finance`、`news` 三类管理，配置文件分别位于：

- `config/sources.tech.json`
- `config/sources.finance.json`
- `config/sources.news.json`

## 科技

| 来源 | 类型 | 用途 | 可信度 | 更新频率 |
| --- | --- | --- | --- | --- |
| TechCrunch | RSS | 创业、AI、平台与风险投资技术报道 | 82 | hourly |
| The Verge | RSS | 消费科技、平台、政策和产品变化 | 80 | hourly |
| Ars Technica | RSS | 深度技术报道和安全分析 | 84 | daily |
| 36Kr | RSS | 中国科技、创业和风险投资市场报道 | 78 | hourly |
| Solidot | RSS | 中文科技与开源动态 | 76 | daily |
| GitHub Blog API | API | 官方开发者平台发布数据，默认关闭 | 88 | ad hoc |

## 金融

| 来源 | 类型 | 用途 | 可信度 | 更新频率 |
| --- | --- | --- | --- | --- |
| Federal Reserve | RSS | 官方货币政策和监管发布 | 96 | daily |
| U.S. SEC Press Releases | RSS | 官方执法、市场结构和披露新闻 | 94 | daily |
| IMF News | RSS | 宏观和国际金融稳定背景，当前解析为空，暂时关闭 | 90 | daily |
| 中国新闻网财经 | RSS | 中国宏观、市场和商业新闻 | 84 | hourly |
| CNBC Business News | RSS | 美国商业、市场和金融新闻 | 86 | hourly |
| Alpha Vantage News Sentiment | API | 市场新闻补充，默认关闭 | 76 | hourly |

## 新闻

| 来源 | 类型 | 用途 | 可信度 | 更新频率 |
| --- | --- | --- | --- | --- |
| BBC World | RSS | 国际公共新闻 | 86 | hourly |
| NPR News | RSS | 美国公共新闻和政策报道 | 84 | hourly |
| The New York Times | RSS | 综合新闻议程和重大事件 | 84 | hourly |
| 中国新闻网即时新闻 | RSS | 中国即时与综合新闻 | 84 | hourly |
| GNews API | API | 可选 API 头条补充，默认关闭 | 72 | hourly |

## 维护规则

- 每类保留经过实际请求和解析验证的来源，覆盖中国与美国主要关注面。
- API 来源默认关闭，避免没有密钥时阻断本地流程。
- 新来源必须补充 `purpose`、`credibility` 和 `updateFrequency`。
- 如果来源长期失败，应先降权或禁用，不在本阶段自动删除。
