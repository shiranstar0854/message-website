# 更新流程

阶段 4 已实现自动更新。由于 GitHub 内置 `schedule` 未产生运行记录，工作流文件 `.github/workflows/daily-update.yml` 只保留 `workflow_dispatch` 入口，由外部调度器定时调用。当前外部任务按小时触发一次，也支持在 GitHub Actions 页面手动触发。

## 执行流程

```bash
npm.cmd test
npm.cmd run update:daily
```

外部调度器调用命令：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/trigger-daily-update.ps1
```

触发脚本只从本机 Git Credential Manager 读取既有 GitHub 登录凭据，不会将访问令牌写入仓库文件。

`update:daily` 会依次执行：

1. 抓取已启用 RSS，并更新 `data/raw/rss-items.json` 与 `src/data/source-health.json`。
2. 生成标准化、过滤、去重、评分与前端展示数据。
3. 输出 `data/processed/source-audit.json` 来源审计报告。
4. 输出 `data/archive/daily/YYYY-MM-DD.json` 轻量每日快照，每频道保留评分最高的 20 条，供后续每周复盘使用。

## 故障处理

- 每个来源请求最多尝试 2 次，每次最多等待 20 秒。
- 单一来源最终请求失败或返回空数据时，健康状态会记录 `failed` 或 `empty`、HTTP 状态、错误信息及连续失败次数。
- 如果该来源存在上一次成功抓取内容，页面生成流程会继续使用旧内容，并在审计报告标记 `usedFallback: true`。
- 外部调度成功触发时，每次运行都会刷新当天最新归档文件并创建数据更新提交。
- API 来源默认关闭。如需启用，必须先通过 GitHub Actions Secrets 配置凭据，并在本地验证抓取结果。

## 人工介入

- 查看 GitHub Actions 的 `Daily information update` 运行结果，确认事件类型为 `workflow_dispatch`。
- 查看 `data/processed/source-audit.json` 中的 `failureCount`、`usedFallback` 与 `newestPublishedAt`。
- 连续失败或长期无新增内容的来源，按 `docs/feedback-rules.md` 的后续规则人工复核后再停用。
