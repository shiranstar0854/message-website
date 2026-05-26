# 评分策略

评分配置位于 `config/scoring-rules.json`，执行脚本为 `scripts/score-items.js`。

## 评分组成

综合评分由以下部分组成，最终限制在 0 到 100：

- 基础分：保证正常内容有可比较的起点。
- 来源可信度：按 `credibility * sourceCredibilityWeight` 加分。
- 时效性：使用半衰期模型，越新的内容加分越高。
- 关键词：命中高价值主题或风险信号时加分。
- 分类加成：金融、科技、新闻按配置轻微区分优先级。
- 来源加成：官方监管和央行来源有额外加分。
- 重复惩罚：同一信息被多源重复报道时保留最高质量版本，同时轻微扣分。

## 去重逻辑

去重配置位于 `config/dedupe-rules.json`，执行脚本为 `scripts/dedupe-items.js`。

- 链接归一化后相同，直接视为重复。
- 同分类标题相似度超过阈值，视为高度相似。
- 重复组内优先保留可信度更高的来源。
- 可信度相同时，优先保留发布时间更新的记录。
- 被合并的记录写入 `duplicates`，用于前端显示和后续审计。

## 输出

评分后的结果写入 `data/processed/scored-items.json`，前端最终读取的数据由 `scripts/generate-latest-data.js` 写入 `src/data/latest-items.json`。
