import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";

const config = "wrangler.production.toml";
const username = "RavanAzmoon_bot";
const setupUrl = "https://ravanazmoon.prdaneshi.workers.dev/setup-webhook";

function wrangler(args, input) {
  const run = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "secret", ...args, "--config", config], {
    input, encoding: "utf8", timeout: 30000,
    env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler" },
  });
  if (run.status !== 0) throw new Error(`Wrangler secret ${args[0]} failed. Check your Cloudflare login and the production deployment.`);
  return run.stdout;
}

async function setup(action, secret) {
  const response = await fetch(setupUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || `Could not ${action} the webhook (HTTP ${response.status}).`);
  }
  return result;
}

async function main() {
  if (process.stdin.isTTY) throw new Error("Use the hidden-input PowerShell command in the README.");
  let token = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) token += chunk;
  token = token.trim();
  if (!/^\d+:[A-Za-z0-9_-]{25,}$/.test(token)) throw new Error("Expected a bot token from BotFather.");

  mkdirSync(".wrangler", { recursive: true });
  const existing = JSON.parse(wrangler(["list"]));
  if (existing.some(({ name }) => name === "BOT_TOKEN" || name === "WEBHOOK_SECRET")) {
    throw new Error("The production Worker already has bot credentials. Check its webhook before replacing any secrets.");
  }

  const webhookSecret = randomBytes(32).toString("hex");
  wrangler(["bulk"], JSON.stringify({ BOT_TOKEN: token, WEBHOOK_SECRET: webhookSecret }));

  try {
    const status = await setup("status", webhookSecret);
    if (status.username?.toLowerCase() !== username.toLowerCase()) throw new Error(`Expected @${username}.`);
  } catch (error) {
    wrangler(["bulk"], JSON.stringify({ BOT_TOKEN: null, WEBHOOK_SECRET: null }));
    throw error;
  }

  try {
    const result = await setup("connect", webhookSecret);
    if (!result.connected) throw new Error("Telegram did not confirm the expected webhook URL.");
    console.log(`Telegram confirmed the production webhook for @${result.username}.`);
  } catch (error) {
    const status = await setup("status", webhookSecret).catch(() => null);
    if (status?.connected) {
      console.log(`Telegram confirmed the production webhook for @${status.username}.`);
      return;
    }
    if (status) wrangler(["bulk"], JSON.stringify({ BOT_TOKEN: null, WEBHOOK_SECRET: null }));
    else console.error("Webhook state could not be confirmed. The credentials were kept so an active webhook is not interrupted.");
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
