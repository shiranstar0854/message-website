const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

async function loadScheduler() {
  return import("../external-scheduler/cloudflare/src/index.mjs");
}

test("Cloudflare scheduler dispatches the GitHub update workflow", async () => {
  const { dispatchWorkflow } = await loadScheduler();
  let recordedRequest;

  await dispatchWorkflow(
    { GITHUB_TOKEN: "test-token" },
    "cloudflare-daily-primary",
    async (url, options) => {
      recordedRequest = { url, options };
      return new Response(null, { status: 204 });
    }
  );

  assert.equal(
    recordedRequest.url,
    "https://api.github.com/repos/shiranstar0854/message-website/actions/workflows/daily-update.yml/dispatches"
  );
  assert.equal(recordedRequest.options.method, "POST");
  assert.equal(recordedRequest.options.headers.Authorization, "Bearer test-token");
  assert.equal(
    recordedRequest.options.body,
    JSON.stringify({ ref: "main", inputs: { trigger_reason: "cloudflare-daily-primary" } })
  );
});

test("Cloudflare scheduler dispatches the evening daily summary workflow", async () => {
  const { runScheduledTrigger } = await loadScheduler();
  let recordedRequest;

  await runScheduledTrigger(
    { cron: "30 11 * * *", scheduledTime: Date.parse("2026-05-28T11:30:00Z") },
    { GITHUB_TOKEN: "test-token" },
    async (url, options) => {
      recordedRequest = { url, options };
      return new Response(null, { status: 204 });
    }
  );

  assert.equal(
    recordedRequest.url,
    "https://api.github.com/repos/shiranstar0854/message-website/actions/workflows/daily-summary.yml/dispatches"
  );
  assert.equal(
    recordedRequest.options.body,
    JSON.stringify({ ref: "main", inputs: { trigger_reason: "cloudflare-summary-evening" } })
  );
});

test("Cloudflare scheduler requires a GitHub secret", async () => {
  const { dispatchWorkflow } = await loadScheduler();

  await assert.rejects(dispatchWorkflow({}), /GITHUB_TOKEN secret is required/);
});

test("Cloudflare scheduler reports rejected GitHub dispatches", async () => {
  const { dispatchWorkflow } = await loadScheduler();

  await assert.rejects(
    dispatchWorkflow(
      { GITHUB_TOKEN: "test-token" },
      "cloudflare-primary",
      async () => new Response("denied", { status: 403 })
    ),
    /GitHub workflow dispatch failed \(403\): denied/
  );
});

test("Cloudflare scheduler runs daily updates and weekly review from Cloudflare cron", () => {
  const configPath = path.join(__dirname, "..", "external-scheduler", "cloudflare", "wrangler.jsonc");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  assert.deepEqual(config.triggers.crons, ["0,30 0,9 * * *", "30 11 * * *", "0 1 * * 1"]);
});

test("Cloudflare daily retry trigger skips dispatch after a successful primary run exists", async () => {
  const { runScheduledTrigger } = await loadScheduler();
  const requests = [];

  await runScheduledTrigger(
    { cron: "0,30 0,9 * * *", scheduledTime: Date.parse("2026-05-28T00:30:00Z") },
    { GITHUB_TOKEN: "test-token" },
    async (url) => {
      requests.push(url);
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              display_title: "Daily information update (cloudflare-daily-primary)",
              created_at: "2026-05-28T00:00:35Z",
              conclusion: "success",
            },
          ],
        }),
        { status: 200 }
      );
    }
  );

  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/runs\?/);
});

test("Cloudflare daily retry trigger dispatches only when the primary run is missing", async () => {
  const { runScheduledTrigger } = await loadScheduler();
  const requests = [];

  await runScheduledTrigger(
    { cron: "0,30 0,9 * * *", scheduledTime: Date.parse("2026-05-28T00:30:00Z") },
    { GITHUB_TOKEN: "test-token" },
    async (url, options) => {
      requests.push({ url, options });
      if (url.includes("/runs?")) {
        return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    }
  );

  assert.equal(requests.length, 2);
  assert.equal(
    requests[1].options.body,
    JSON.stringify({ ref: "main", inputs: { trigger_reason: "cloudflare-daily-retry" } })
  );
});

test("Cloudflare daily retry trigger dispatches after a failed primary run", async () => {
  const { runScheduledTrigger } = await loadScheduler();
  const requests = [];

  await runScheduledTrigger(
    { cron: "0,30 0,9 * * *", scheduledTime: Date.parse("2026-05-28T00:30:00Z") },
    { GITHUB_TOKEN: "test-token" },
    async (url, options) => {
      requests.push({ url, options });
      if (url.includes("/runs?")) {
        return new Response(
          JSON.stringify({
            workflow_runs: [{
              display_title: "Daily information update (cloudflare-daily-primary)",
              created_at: "2026-05-28T00:00:35Z",
              conclusion: "failure",
            }],
          }),
          { status: 200 }
        );
      }
      return new Response(null, { status: 204 });
    }
  );

  assert.equal(requests.length, 2);
  assert.equal(
    requests[1].options.body,
    JSON.stringify({ ref: "main", inputs: { trigger_reason: "cloudflare-daily-retry" } })
  );
});

test("Cloudflare afternoon update trigger dispatches the daily update workflow", async () => {
  const { runScheduledTrigger } = await loadScheduler();
  let recordedRequest;

  await runScheduledTrigger(
    { cron: "0,30 0,9 * * *", scheduledTime: Date.parse("2026-05-28T09:00:00Z") },
    { GITHUB_TOKEN: "test-token" },
    async (url, options) => {
      recordedRequest = { url, options };
      return new Response(null, { status: 204 });
    }
  );

  assert.equal(
    recordedRequest.url,
    "https://api.github.com/repos/shiranstar0854/message-website/actions/workflows/daily-update.yml/dispatches"
  );
  assert.equal(
    recordedRequest.options.body,
    JSON.stringify({ ref: "main", inputs: { trigger_reason: "cloudflare-daily-afternoon-primary" } })
  );
});

test("Cloudflare afternoon retry dispatches only when the afternoon primary run is missing", async () => {
  const { runScheduledTrigger } = await loadScheduler();
  const requests = [];

  await runScheduledTrigger(
    { cron: "0,30 0,9 * * *", scheduledTime: Date.parse("2026-05-28T09:30:00Z") },
    { GITHUB_TOKEN: "test-token" },
    async (url, options) => {
      requests.push({ url, options });
      if (url.includes("/runs?")) {
        return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    }
  );

  assert.equal(requests.length, 2);
  assert.equal(
    requests[1].options.body,
    JSON.stringify({ ref: "main", inputs: { trigger_reason: "cloudflare-daily-afternoon-retry" } })
  );
});

test("Cloudflare scheduler does not dispatch a separate daily summary retry", async () => {
  const { runScheduledTrigger } = await loadScheduler();
  let called = false;

  const result = await runScheduledTrigger(
    { cron: "30 11 * * *", scheduledTime: Date.parse("2026-05-28T11:00:00Z") },
    { GITHUB_TOKEN: "test-token" },
    async () => {
      called = true;
      return new Response(null, { status: 204 });
    }
  );

  assert.equal(result, undefined);
  assert.equal(called, false);
});

test("Cloudflare weekly cron dispatches the weekly review workflow", async () => {
  const { runScheduledTrigger } = await loadScheduler();
  let recordedRequest;

  await runScheduledTrigger(
    { cron: "0 1 * * 1", scheduledTime: Date.parse("2026-06-01T01:00:00Z") },
    { GITHUB_TOKEN: "test-token" },
    async (url, options) => {
      recordedRequest = { url, options };
      return new Response(null, { status: 204 });
    }
  );

  assert.equal(
    recordedRequest.url,
    "https://api.github.com/repos/shiranstar0854/message-website/actions/workflows/weekly-review.yml/dispatches"
  );
  assert.equal(
    recordedRequest.options.body,
    JSON.stringify({ ref: "main", inputs: { trigger_reason: "cloudflare-weekly" } })
  );
});
