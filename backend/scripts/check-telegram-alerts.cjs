// check-telegram-alerts.cjs — verify the repo's own Telegram bot can post.
//
// The repo already alerts to Telegram from three places, all through the same
// Bot API call (POST https://api.telegram.org/bot<token>/sendMessage):
//   - .github/workflows/deploy-oracle.yml — deploy failure / rollback alert
//   - .github/workflows/uptime-watch.yml — up/down state-change alert
//   - backend/src/core/health/health.controller.ts — DB-down incident alert
//     (via TelegramAlertsService.sendMessage) + a super-admin POST
//     /api/health/telegram-test endpoint.
// All three read the bot token + chat id from the environment only
// (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID, GitHub secrets on the runner,
// /etc/zsystems/telegram.env on the server). This script proves that half
// of the alerting chain works: that the token is valid and the chat is
// reachable, without ever printing either value.
//
// It does NOT prove Sentry alerts reach Telegram. Sentry alerts travel a
// different path — Sentry's own Telegram Alerts Bot (a dashboard
// integration, no repo code, no repo bot involved). See
// sentry-live-check.md §7 for the route decision and the owed dashboard
// steps. This script only proves the repo's own bot, which is what the
// deploy / uptime / health alerts depend on.
//
// Usage (on the server, where the secrets live):
//   source /etc/zsystems/telegram.env
//   node backend/scripts/check-telegram-alerts.cjs              # getMe + getChat, no message sent
//   node backend/scripts/check-telegram-alerts.cjs --check-only # env presence only, no network
//   node backend/scripts/check-telegram-alerts.cjs --send-test  # also sends one test message
//
// Exit codes: 0 = verified, 1 = anything missing / rejected / unreachable.
// Failure messages name the missing env var (by name only) or quote
// Telegram's own error description — never the token or the chat id.

const TELEGRAM_API = 'https://api.telegram.org';

function fail(message) {
  console.error(`check-telegram-alerts: FAIL — ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`check-telegram-alerts: OK — ${message}`);
}

function parseArgs(argv) {
  const flags = { checkOnly: false, sendTest: false };
  for (const arg of argv) {
    if (arg === '--check-only') flags.checkOnly = true;
    else if (arg === '--send-test') flags.sendTest = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node backend/scripts/check-telegram-alerts.cjs [--check-only] [--send-test]\n' +
          '  (no flag)    verify the token (getMe) and the chat (getChat), no message sent\n' +
          '  --check-only verify only that TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set\n' +
          '  --send-test  also send one test message to the chat',
      );
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg} (see --help)`);
    }
  }
  if (flags.checkOnly && flags.sendTest) {
    fail('--check-only and --send-test cannot be combined');
  }
  return flags;
}

// Presence check only — no network, no values read beyond "set / unset".
// Returns the two values for the callers that need them.
function requireEnv() {
  const missing = [];
  if (!process.env.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (!process.env.TELEGRAM_CHAT_ID) missing.push('TELEGRAM_CHAT_ID');
  if (missing.length > 0) {
    fail(
      `missing environment variable(s): ${missing.join(', ')} — ` +
        'set them from the deploy secrets (GitHub secrets TELEGRAM_BOT_TOKEN / ' +
        'TELEGRAM_CHAT_ID, or source /etc/zsystems/telegram.env on the server). ' +
        'Values are never printed here.',
    );
  }
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  };
}

// One Telegram Bot API call. The token travels in the URL path — that is
// how the Bot API authenticates (the same shape the workflows and
// TelegramAlertsService already use). The token is never logged, and a
// transport failure is reported generically so a thrown error can never
// leak the request URL.
async function callTelegram(botToken, method, body) {
  let res;
  try {
    res = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    fail(`could not reach ${TELEGRAM_API} (network error) — check outbound HTTPS from this machine`);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    fail(`Telegram answered ${method} with HTTP ${res.status} and an unreadable body`);
  }
  if (!res.ok || !data.ok) {
    // Telegram's description names the problem (e.g. "Unauthorized") and
    // never contains the token or the chat id.
    fail(`Telegram rejected ${method}: HTTP ${res.status} — ${data.description || 'no description'}`);
  }
  return data.result;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const { botToken, chatId } = requireEnv();
  ok('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are both set');
  if (flags.checkOnly) return;

  const me = await callTelegram(botToken, 'getMe');
  ok(`bot token is valid (bot username: ${me.username || 'unknown'})`);
  const chat = await callTelegram(botToken, 'getChat', { chat_id: chatId });
  ok(`chat is reachable (type: ${chat.type || 'unknown'})`);

  if (flags.sendTest) {
    await callTelegram(botToken, 'sendMessage', {
      chat_id: chatId,
      text:
        '🧪 Z-Systems Telegram check: the bot can post to this chat. ' +
        'Deploy, uptime and health alerts use this bot. ' +
        'Sentry error alerts arrive separately via Sentry\u2019s own Telegram Alerts Bot.',
      disable_web_page_preview: true,
    });
    ok('test message sent to the chat');
  }
}

main().catch(() => {
  // main() already fails loudly with a named reason; this is only a guard
  // against an unexpected throw escaping without an exit code.
  fail('unexpected error while checking the Telegram bot');
});
