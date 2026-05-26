# 更新流程

本文件保留给 `task.md` 阶段 4。当前版本没有 GitHub Actions 自动更新。

本地手动流程：

```bash
npm.cmd run fetch:rss
npm.cmd run normalize
npm.cmd run filter
npm.cmd run dedupe
npm.cmd run score
npm.cmd run generate:latest
```

API 来源默认关闭。如需启用，需要先配置密钥并确认抓取结果稳定。
