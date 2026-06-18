const fs = require("node:fs");
const path = require("node:path");

function unquoteEnvValue(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath, env) {
  if (!fs.existsSync(filePath)) return 0;
  const content = fs.readFileSync(filePath, "utf8");
  let loaded = 0;

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (env[key]) continue;
    const value = unquoteEnvValue(rawValue);
    if (!value) continue;
    env[key] = value;
    loaded += 1;
  }

  return loaded;
}

function loadLocalEnv(rootDir, env = process.env) {
  const baseDir = rootDir || process.cwd();
  return [".env.local", ".env"].reduce((count, fileName) => (
    count + loadEnvFile(path.join(baseDir, fileName), env)
  ), 0);
}

module.exports = {
  loadLocalEnv
};
