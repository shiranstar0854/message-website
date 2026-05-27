const DISPATCH_URL =
  "https://api.github.com/repos/shiranstar0854/message-website/actions/workflows/daily-update.yml/dispatches";

export async function dispatchWorkflow(env, request = fetch) {
  if (!env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN secret is required.");
  }

  const response = await request(DISPATCH_URL, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "message-website-cloudflare-scheduler",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "main" }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub workflow dispatch failed (${response.status}): ${detail}`);
  }
}

export default {
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(dispatchWorkflow(env));
  },
};
