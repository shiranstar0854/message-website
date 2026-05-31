const DAILY_DISPATCH_URL =
  "https://api.github.com/repos/shiranstar0854/message-website/actions/workflows/daily-update.yml/dispatches";
const SUMMARY_DISPATCH_URL =
  "https://api.github.com/repos/shiranstar0854/message-website/actions/workflows/daily-summary.yml/dispatches";
const WEEKLY_DISPATCH_URL =
  "https://api.github.com/repos/shiranstar0854/message-website/actions/workflows/weekly-review.yml/dispatches";
const DAILY_RUNS_URL =
  "https://api.github.com/repos/shiranstar0854/message-website/actions/workflows/daily-update.yml/runs";
const SUMMARY_RUNS_URL =
  "https://api.github.com/repos/shiranstar0854/message-website/actions/workflows/daily-summary.yml/runs";
const DAILY_WINDOW_CRON = "0,30 0,9,11 * * *";
const WEEKLY_CRON = "0 1 * * 1";
const DAILY_PRIMARY_TRIGGER = "cloudflare-daily-primary";
const DAILY_RETRY_TRIGGER = "cloudflare-daily-retry";
const DAILY_AFTERNOON_PRIMARY_TRIGGER = "cloudflare-daily-afternoon-primary";
const DAILY_AFTERNOON_RETRY_TRIGGER = "cloudflare-daily-afternoon-retry";
const SUMMARY_PRIMARY_TRIGGER = "cloudflare-summary-primary";
const SUMMARY_RETRY_TRIGGER = "cloudflare-summary-retry";
const WEEKLY_TRIGGER = "cloudflare-weekly";
const DAILY_PRIMARY_RUN_TITLE = `Daily information update (${DAILY_PRIMARY_TRIGGER})`;
const DAILY_AFTERNOON_PRIMARY_RUN_TITLE = `Daily information update (${DAILY_AFTERNOON_PRIMARY_TRIGGER})`;
const SUMMARY_PRIMARY_RUN_TITLE = `Daily summary update (${SUMMARY_PRIMARY_TRIGGER})`;
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

export async function dispatchWorkflow(env, triggerReason = DAILY_PRIMARY_TRIGGER, request = fetch, dispatchUrl = DAILY_DISPATCH_URL) {
  const response = await request(dispatchUrl, {
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

export async function hasSuccessfulPrimaryRunForScheduledDay(env, scheduledTime, request = fetch, runsUrl = DAILY_RUNS_URL, displayTitle = DAILY_PRIMARY_RUN_TITLE) {
  const dayStart = new Date(scheduledTime);
  dayStart.setUTCHours(0, 0, 0, 0);
  const nextDayStart = dayStart.getTime() + DAY_IN_MILLISECONDS;
  const query = new URLSearchParams({
    event: "workflow_dispatch",
    branch: "main",
    per_page: "30",
  });
  const response = await request(`${runsUrl}?${query.toString()}`, {
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
      run.display_title === displayTitle &&
      run.conclusion === "success" &&
      createdAt >= dayStart.getTime() &&
      createdAt < nextDayStart
    );
  });
}

export async function runScheduledTrigger(controller, env, request = fetch) {
  const scheduledAt = new Date(controller.scheduledTime);
  const hour = scheduledAt.getUTCHours();
  const minute = scheduledAt.getUTCMinutes();

  if (controller.cron === DAILY_WINDOW_CRON && hour === 0 && minute === 0) {
    return dispatchWorkflow(env, DAILY_PRIMARY_TRIGGER, request);
  }

  if (controller.cron === DAILY_WINDOW_CRON && hour === 0 && minute === 30) {
    const successfulPrimaryRunExists = await hasSuccessfulPrimaryRunForScheduledDay(env, controller.scheduledTime, request);
    if (!successfulPrimaryRunExists) {
      return dispatchWorkflow(env, DAILY_RETRY_TRIGGER, request);
    }
  }

  if (controller.cron === DAILY_WINDOW_CRON && hour === 9 && minute === 0) {
    return dispatchWorkflow(env, DAILY_AFTERNOON_PRIMARY_TRIGGER, request);
  }

  if (controller.cron === DAILY_WINDOW_CRON && hour === 9 && minute === 30) {
    const successfulPrimaryRunExists = await hasSuccessfulPrimaryRunForScheduledDay(
      env,
      controller.scheduledTime,
      request,
      DAILY_RUNS_URL,
      DAILY_AFTERNOON_PRIMARY_RUN_TITLE
    );
    if (!successfulPrimaryRunExists) {
      return dispatchWorkflow(env, DAILY_AFTERNOON_RETRY_TRIGGER, request);
    }
  }

  if (controller.cron === DAILY_WINDOW_CRON && hour === 11 && minute === 0) {
    return dispatchWorkflow(env, SUMMARY_PRIMARY_TRIGGER, request, SUMMARY_DISPATCH_URL);
  }

  if (controller.cron === DAILY_WINDOW_CRON && hour === 11 && minute === 30) {
    const successfulPrimaryRunExists = await hasSuccessfulPrimaryRunForScheduledDay(
      env,
      controller.scheduledTime,
      request,
      SUMMARY_RUNS_URL,
      SUMMARY_PRIMARY_RUN_TITLE
    );
    if (!successfulPrimaryRunExists) {
      return dispatchWorkflow(env, SUMMARY_RETRY_TRIGGER, request, SUMMARY_DISPATCH_URL);
    }
  }

  if (controller.cron === WEEKLY_CRON) {
    return dispatchWorkflow(env, WEEKLY_TRIGGER, request, WEEKLY_DISPATCH_URL);
  }
}

export default {
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledTrigger(controller, env));
  },
};
