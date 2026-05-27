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

  await dispatchWorkflow({ GITHUB_TOKEN: "test-token" }, async (url, options) => {
    recordedRequest = { url, options };
    return new Response(null, { status: 204 });
  });

  assert.equal(
    recordedRequest.url,
    "https://api.github.com/repos/shiranstar0854/message-website/actions/workflows/daily-update.yml/dispatches"
  );
  assert.equal(recordedRequest.options.method, "POST");
  assert.equal(recordedRequest.options.headers.Authorization, "Bearer test-token");
  assert.equal(recordedRequest.options.body, JSON.stringify({ ref: "main" }));
});

test("Cloudflare scheduler requires a GitHub secret", async () => {
  const { dispatchWorkflow } = await loadScheduler();

  await assert.rejects(dispatchWorkflow({}), /GITHUB_TOKEN secret is required/);
});

test("Cloudflare scheduler reports rejected GitHub dispatches", async () => {
  const { dispatchWorkflow } = await loadScheduler();

  await assert.rejects(
    dispatchWorkflow({ GITHUB_TOKEN: "test-token" }, async () => new Response("denied", { status: 403 })),
    /GitHub workflow dispatch failed \(403\): denied/
  );
});

test("Cloudflare scheduler runs daily at 08:00 Beijing time", () => {
  const configPath = path.join(__dirname, "..", "external-scheduler", "cloudflare", "wrangler.jsonc");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  assert.deepEqual(config.triggers.crons, ["0 0 * * *"]);
});
