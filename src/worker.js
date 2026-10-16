/**
 * ربات تلگرام روی Cloudflare Worker — مبتنی بر webhook (بدون نیاز به پروکسی).
 *
 * مسیرها:
 *   GET  /                → وضعیت سلامت
 *   GET  /setup-webhook   → تنظیم webhook تلگرام روی این ورکر
 *   POST /webhook         → دریافت آپدیت‌های تلگرام (با هدر secret)
 */

const WELCOME = (name) =>
  `سلام ${name}! 👋\n\n` +
  "به ربات خوش آمدید.\n" +
  "هر متنی بفرستید تا پاسخ بگیرید، یا از دکمه‌های زیر استفاده کنید.";

const MAIN_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "ℹ️ درباره ربات", callback_data: "about" },
      { text: "❓ راهنما", callback_data: "help" },
    ],
    [{ text: "💬 تماس با ادمین", callback_data: "contact" }],
  ],
};

const TEXTS = {
  about:
    "🤖 *درباره ربات*\n\n" +
    "این ربات روی *Cloudflare Workers* اجرا می‌شود — بدون سرور، بدون پروکسی.",
  help:
    "❓ *راهنما*\n\n" +
    "• /start — شروع و نمایش منو\n" +
    "• هر متنی بفرستید تا پاسخ بگیرید\n" +
    "• با دکمه‌ی «تماس با ادمین» می‌توانید پیام بدهید",
  contact: "📩 پیام خود را همین‌جا بنویسید تا به ادمین برسد.",
};

/** فراخوانی Bot API تلگرام */
async function tg(env, method, body) {
  const resp = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return resp.json();
}

/** پیام‌های معمولی کاربر */
async function handleMessage(env, message) {
  const chatId = message.chat.id;
  const text = message.text || "";

  if (text.startsWith("/start")) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: WELCOME(message.from.first_name || "دوست من"),
      reply_markup: MAIN_KEYBOARD,
    });
    return;
  }

  // اگر ادمین تعریف شده باشد، پیام کاربر برایش ارسال می‌شود
  if (env.ADMIN_CHAT_ID && text) {
    const from = message.from.username
      ? `@${message.from.username}`
      : message.from.first_name || chatId;
    await tg(env, "sendMessage", {
      chat_id: env.ADMIN_CHAT_ID,
      text: `📩 پیام از ${from} (${chatId}):\n\n${text}`,
    });
  }

  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: text
      ? `پیام شما را دریافت کردم: «${text}»\nبرای منو /start را بزنید.`
      : "فعلاً فقط متن می‌فهمم 🙂 برای منو /start را بزنید.",
  });
}

/** دکمه‌های شیشه‌ای */
async function handleCallback(env, callbackQuery) {
  const data = callbackQuery.data || "";
  await tg(env, "answerCallbackQuery", {
    callback_query_id: callbackQuery.id,
  });
  await tg(env, "editMessageText", {
    chat_id: callbackQuery.message.chat.id,
    message_id: callbackQuery.message.message_id,
    text: TEXTS[data] || "گزینه ناشناخته 🙂",
    parse_mode: "Markdown",
    reply_markup: data === "contact" ? MAIN_KEYBOARD : undefined,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // سلام‌اندازی — راهنمای وضعیت
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        ok: true,
        bot: "telbot",
        hint: "برای اتصال به تلگرام یک بار /setup-webhook را باز کنید",
      });
    }

    // تنظیم webhook — یک بار بعد از هر دیپلوی کافی است
    if (request.method === "GET" && url.pathname === "/setup-webhook") {
      if (!env.BOT_TOKEN || !env.WEBHOOK_SECRET) {
        return Response.json(
          { ok: false, error: "ابتدا BOT_TOKEN و WEBHOOK_SECRET را تنظیم کنید" },
          { status: 500 }
        );
      }
      const result = await tg(env, "setWebhook", {
        url: `${url.origin}/webhook`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
      });
      return Response.json(result);
    }

    // دریافت آپدیت از تلگرام
    if (request.method === "POST" && url.pathname === "/webhook") {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }

      const update = await request.json();
      try {
        if (update.message) await handleMessage(env, update.message);
        else if (update.callback_query)
          await handleCallback(env, update.callback_query);
      } catch (err) {
        console.error("handle error:", err);
      }
      // همیشه 200 برمی‌گردانیم تا تلگرام آپدیت را دوباره نفرستد
      return new Response("ok");
    }

    return new Response("Not found", { status: 404 });
  },
};
