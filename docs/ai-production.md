# DeepSeek production summary path

Phase 5 keeps the existing extractive summary path as the default fallback. The
daily and weekly workflows call DeepSeek only when all of these are true:

- `config/ai-summary-rules.json` has `llmProduction.enabled` set to `true`.
- GitHub Actions has a repository secret named `DEEPSEEK_API_KEY`.
- The configured provider is `deepseek-chat-completions`.

Cloudflare Workers Cron only dispatches the GitHub workflows. The DeepSeek key
belongs in GitHub repository secrets, not in the Cloudflare Worker and not in
frontend data.

## Runtime behavior

- Daily summaries are published to `src/data/daily-summary.json` and shown on
  `daily-summary.html` as three channel-level important-affairs summaries:
  tech, finance, and news.
- Weekly reviews are published to `src/data/weekly-review.json` and shown on
  `weekly-review.html`.
- Daily archive JSON files are stored in `data/archive/daily/` and are kept in
  the repository as the full historical record.
- `src/data/history-index.json` is the web-facing index for `history.html`; it
  lists only the latest `history.retentionDays` daily archives, defaulting to
  10 days.
- A failed DeepSeek request falls back to local extractive output.
- `data/processed/ai-summaries.json` records `llmEnabled`, `llmConfigured`,
  `fallbackCount`, and `errorCount`.

## Enable checklist

1. Add `DEEPSEEK_API_KEY` in GitHub repository secrets.
2. Optionally set `DEEPSEEK_MODEL` in GitHub repository variables.
3. Set `llmProduction.enabled` to `true` in `config/ai-summary-rules.json`.
4. Run the daily and weekly workflows manually once and inspect the generated
   JSON files.

Default model: `deepseek-v4-flash`.
