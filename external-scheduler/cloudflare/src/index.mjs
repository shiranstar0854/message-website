const DISPATCH_URL =
  "https://api.github.com/repos/shiranstar0854/message-website/actions/workflows/daily-update.yml/dispatches";
const RUNS_URL =
  "https://api.github.com/repos/shiranstar0854/message-website/actions/workflows/daily-update.yml/runs";
const PRIMARY_CRON = "0 0 * * *";
const RETRY_CRON = "30 0 * * *";
const PRIMARY_TRIGGER = "cloudflare-primary";
const RETRY_TRIGGER = "cloudflare-retry";
const PRIMARY_RUN_TITLE = `Daily information update (${PRIMARY_TRIGGER})`;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

function getHeaders(env) {
  if (!env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN secret is required.");
  }

  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "User-Agent": "message-website-cloudflare-scheduler",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function dispatchWorkflow(env, triggerReason = PRIMARY_TRIGGER, request = fetch) {
  const response = await request(DISPATCH_URL, {
    method: "POST",
    headers: {
      ...getHeaders(env),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main", inputs: { trigger_reason: triggerReason } }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub workflow dispatch failed (${response.status}): ${detail}`);
  }
}

export async function hasPrimaryRunForScheduledDay(env, scheduledTime, request = fetch) {
  const dayStart = new Date(scheduledTime);
  dayStart.setUTCHours(0, 0, 0, 0);
  const nextDayStart = dayStart.getTime() + DAY_IN_MILLISECONDS;
  const query = new URLSearchParams({
    event: "workflow_dispatch",
    branch: "main",
    per_page: "30",
  });
  const response = await request(`${RUNS_URL}?${query.toString()}`, {
    headers: getHeaders(env),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub workflow run lookup failed (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  return payload.workflow_runs.some((run) => {
    const createdAt = Date.parse(run.created_at);
    return (
      run.display_title === PRIMARY_RUN_TITLE &&
      createdAt >= dayStart.getTime() &&
      createdAt < nextDayStart
    );
  });
}

export async function runScheduledTrigger(controller, env, request = fetch) {
  if (controller.cron === PRIMARY_CRON) {
    return dispatchWorkflow(env, PRIMARY_TRIGGER, request);
  }

  if (controller.cron === RETRY_CRON) {
    const primaryRunExists = await hasPrimaryRunForScheduledDay(env, controller.scheduledTime, request);
    if (!primaryRunExists) {
      return dispatchWorkflow(env, RETRY_TRIGGER, request);
    }
  }
}

export default {
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledTrigger(controller, env));
  },
};
