const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadLocalEnv } = require("../scripts/lib/load-local-env");

test("local env loader reads non-empty values without overriding existing env", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "message-env-"));
  try {
    fs.writeFileSync(path.join(directory, ".env.local"), [
      "DEEPSEEK_API_KEY=local-key",
      "DEEPSEEK_MODEL=deepseek-test",
      "EMPTY_VALUE=",
      "# ignored"
    ].join("\n"));

    const env = { DEEPSEEK_MODEL: "existing-model" };
    const loaded = loadLocalEnv(directory, env);

    assert.equal(loaded, 1);
    assert.equal(env.DEEPSEEK_API_KEY, "local-key");
    assert.equal(env.DEEPSEEK_MODEL, "existing-model");
    assert.equal(env.EMPTY_VALUE, undefined);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
