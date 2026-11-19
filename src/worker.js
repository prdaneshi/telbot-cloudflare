/**
 * Generic Telegram psychological-test engine on Cloudflare Workers + D1.
 * Tests are data: the Worker knows how to run a test, but does not contain
 * NEO (or any other test) questions.
 */

const MAIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: "🧠 آزمون‌ها", callback_data: "tests" }],
    [
      { text: "ℹ️ درباره ربات", callback_data: "about" },
      { text: "❓ راهنما", callback_data: "help" },
    ],
    [{ text: "💬 تماس با ادمین", callback_data: "contact" }],
  ],
};

const TEXTS = {
  about:
    "🤖 دربارهٔ ربات\n\n" +
    "این ربات برای اجرای آزمون‌های روان‌شناختی طراحی شده است.\n" +
    "نتایج برای خودشناسی ارائه می‌شوند و جایگزین ارزیابی تخصصی نیستند.",
  help:
    "❓ راهنما\n\n" +
    "• /start — نمایش منوی اصلی\n" +
    "• آزمون‌ها — مشاهده و شروع آزمون‌ها\n" +
    "• هر آزمون را می‌توانید متوقف کنید و بعداً ادامه دهید.",
  contact: "📩 پیام خود را همین‌جا بنویسید تا به ادمین برسد.",
};

const isDbReady = (env) => Boolean(env.DB && typeof env.DB.prepare === "function");

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

function logToSheet(ctx, env, message) {
  if (!env.SHEET_LOG_URL) return;
  ctx.waitUntil(
    fetch(env.SHEET_LOG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: message.chat.id,
        first_name: message.from?.first_name || "",
        username: message.from?.username || "",
        text: message.text || "",
      }),
    }).catch((err) => console.error("sheet log error:", err))
  );
}

function welcome(name) {
  return (
    `سلام ${name}! 👋\n\n` +
    "به ربات آزمون‌های روان‌شناختی خوش آمدید.\n" +
    "از منوی زیر آزمون موردنظر را انتخاب کنید."
  );
}

async function listTests(env) {
  if (!isDbReady(env)) return [];
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.title, t.description, v.id AS version_id
     FROM tests t
     JOIN test_versions v ON v.test_id = t.id
     WHERE t.active = 1 AND v.active = 1
     ORDER BY t.sort_order, t.id`
  ).all();
  return results || [];
}

async function getTestVersion(env, versionId) {
  return env.DB.prepare(
    `SELECT v.id, v.test_id, v.version_label, v.instructions, v.question_count,
            v.scale_min, v.scale_max, t.title, t.description
     FROM test_versions v
     JOIN tests t ON t.id = v.test_id
     WHERE v.id = ? AND v.active = 1 AND t.active = 1`
  ).bind(versionId).first();
}

async function getQuestion(env, versionId, position) {
  const question = await env.DB.prepare(
    `SELECT id, position, text FROM questions
     WHERE test_version_id = ? AND position = ?`
  ).bind(versionId, position).first();
  if (!question) return null;
  const { results: options } = await env.DB.prepare(
    `SELECT position, label FROM options
     WHERE test_version_id = ? ORDER BY position`
  ).bind(versionId).all();
  return { ...question, options: options || [] };
}

async function sendTestList(env, chatId) {
  const tests = await listTests(env);
  if (!tests.length) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: isDbReady(env)
        ? "فعلاً آزمونی برای اجرا فعال نشده است."
        : "اتصال دیتابیس آزمون‌ها هنوز تنظیم نشده است.",
      reply_markup: MAIN_KEYBOARD,
    });
    return;
  }
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: "🧠 آزمون موردنظر را انتخاب کنید:",
    reply_markup: {
      inline_keyboard: tests.map((test) => [
        { text: test.title, callback_data: `test:${test.version_id}` },
      ]),
    },
  });
}

async function sendQuestion(env, chatId, sessionId, versionId, position) {
  const question = await getQuestion(env, versionId, position);
  if (!question) throw new Error(`question not found: ${versionId}/${position}`);
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: `سؤال ${position + 1}\n\n${question.text}`,
    reply_markup: {
      inline_keyboard: question.options.map((option) => [
        {
          text: option.label,
          callback_data: `ans:${sessionId}:${position}:${option.position}`,
        },
      ]),
    },
  });
}

async function startTest(env, chatId, versionId) {
  if (!isDbReady(env)) {
    await tg(env, "sendMessage", { chat_id: chatId, text: "دیتابیس آزمون‌ها تنظیم نشده است." });
    return;
  }
  const version = await getTestVersion(env, versionId);
  if (!version) {
    await tg(env, "sendMessage", { chat_id: chatId, text: "این آزمون در دسترس نیست." });
    return;
  }
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO test_sessions (id, chat_id, test_version_id, status, current_position)
     VALUES (?, ?, ?, 'in_progress', 0)`
  ).bind(sessionId, String(chatId), version.id).run();
  await sendQuestion(env, chatId, sessionId, version.id, 0);
}

async function showTestDetails(env, chatId, versionId) {
  const version = await getTestVersion(env, versionId);
  if (!version) {
    await tg(env, "sendMessage", { chat_id: chatId, text: "این آزمون در دسترس نیست." });
    return;
  }
  const count = version.question_count || "تعداد نامشخص";
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text:
      `🧠 ${version.title}\n\n` +
      `${version.description || ""}\n\n` +
      `${version.instructions || "لطفاً به همهٔ سؤال‌ها با دقت پاسخ دهید."}\n\n` +
      `تعداد سؤال‌ها: ${count}`,
    reply_markup: {
      inline_keyboard: [[{ text: "▶️ شروع آزمون", callback_data: `start:${version.id}` }]],
    },
  });
}

async function calculateResults(env, sessionId) {
  const session = await env.DB.prepare(
    `SELECT s.id, s.chat_id, s.test_version_id, v.scale_min, v.scale_max, t.title
     FROM test_sessions s
     JOIN test_versions v ON v.id = s.test_version_id
     JOIN tests t ON t.id = v.test_id
     WHERE s.id = ?`
  ).bind(sessionId).first();
  if (!session) throw new Error(`session not found: ${sessionId}`);

  const { results: scores } = await env.DB.prepare(
    `SELECT d.key AS dimension_key, d.title AS dimension_title,
            d.description AS dimension_description,
            ROUND(SUM(
              (CASE WHEN qs.reverse_scored = 1
                THEN (? + ? - a.option_value)
                ELSE a.option_value END) * qs.weight
            ), 2) AS raw_score
     FROM answers a
     JOIN questions q ON q.id = a.question_id
     JOIN question_scoring qs ON qs.question_id = q.id
     JOIN dimensions d ON d.id = qs.dimension_id
     WHERE a.session_id = ?
     GROUP BY d.id, d.key, d.title, d.description
     ORDER BY d.sort_order, d.id`
  ).bind(session.scale_min, session.scale_max, sessionId).all();

  const rows = scores || [];
  await env.DB.prepare(`DELETE FROM results WHERE session_id = ?`).bind(sessionId).run();
  for (const score of rows) {
    const interpretation = await env.DB.prepare(
      `SELECT level, text FROM result_interpretations
       WHERE test_version_id = ? AND dimension_id = (
         SELECT id FROM dimensions WHERE key = ? AND test_version_id = ?
       ) AND min_score <= ? AND max_score >= ?
       ORDER BY min_score DESC LIMIT 1`
    ).bind(session.test_version_id, score.dimension_key, session.test_version_id,
      score.raw_score, score.raw_score).first();
    await env.DB.prepare(
      `INSERT INTO results
       (id, session_id, dimension_key, raw_score, level, interpretation)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), sessionId, score.dimension_key, score.raw_score,
      interpretation?.level || null, interpretation?.text || null).run();
  }
  return { session, scores: rows };
}

async function finishTest(env, chatId, sessionId) {
  const { session, scores } = await calculateResults(env, sessionId);
  await env.DB.prepare(
    `UPDATE test_sessions SET status = 'completed', completed_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(sessionId).run();
  const lines = scores.length
    ? scores.map((score) => `• ${score.dimension_title}: ${score.raw_score}${score.dimension_description ? `\n  ${score.dimension_description}` : ""}`)
    : ["نتیجه‌ای برای این آزمون محاسبه نشد."];
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text:
      `✅ آزمون «${session.title}» به پایان رسید.\n\n` +
      "نتیجهٔ اولیه:\n" + lines.join("\n") +
      "\n\nاین نتیجه برای خودشناسی است و جایگزین ارزیابی تخصصی نمی‌شود.",
    reply_markup: MAIN_KEYBOARD,
  });
}

async function answerQuestion(env, chatId, sessionId, position, optionPosition) {
  if (!isDbReady(env)) return;
  const session = await env.DB.prepare(
    `SELECT id, chat_id, test_version_id, status, current_position
     FROM test_sessions WHERE id = ?`
  ).bind(sessionId).first();
  if (!session || String(session.chat_id) !== String(chatId) || session.status !== "in_progress") return;
  if (Number(session.current_position) !== Number(position)) return;

  const question = await env.DB.prepare(
    `SELECT id FROM questions WHERE test_version_id = ? AND position = ?`
  ).bind(session.test_version_id, position).first();
  const option = await env.DB.prepare(
    `SELECT position, value FROM options WHERE test_version_id = ? AND position = ?`
  ).bind(session.test_version_id, optionPosition).first();
  if (!question || !option) return;

  await env.DB.prepare(
    `INSERT OR REPLACE INTO answers
     (id, session_id, question_id, option_position, option_value, answered_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(crypto.randomUUID(), sessionId, question.id, option.position, option.value).run();

  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM questions WHERE test_version_id = ?`
  ).bind(session.test_version_id).first();
  const nextPosition = Number(position) + 1;
  await env.DB.prepare(
    `UPDATE test_sessions SET current_position = ? WHERE id = ?`
  ).bind(nextPosition, sessionId).run();
  if (nextPosition >= Number(count.count)) await finishTest(env, chatId, sessionId);
  else await sendQuestion(env, chatId, sessionId, session.test_version_id, nextPosition);
}

async function handleMessage(ctx, env, message) {
  const chatId = message.chat.id;
  const text = message.text || "";
  logToSheet(ctx, env, message);

  if (text.startsWith("/start")) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: welcome(message.from?.first_name || "دوست من"),
      reply_markup: MAIN_KEYBOARD,
    });
    return;
  }
  if (text === "آزمون‌ها" || text === "آزمون ها") {
    await sendTestList(env, chatId);
    return;
  }

  if (env.ADMIN_CHAT_ID && text) {
    const from = message.from?.username
      ? `@${message.from.username}`
      : message.from?.first_name || chatId;
    await tg(env, "sendMessage", {
      chat_id: env.ADMIN_CHAT_ID,
      text: `📩 پیام از ${from} (${chatId}):\n\n${text}`,
    });
  }
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: "برای مشاهدهٔ آزمون‌ها از دکمهٔ «🧠 آزمون‌ها» استفاده کنید.",
    reply_markup: MAIN_KEYBOARD,
  });
}

async function handleCallback(env, callbackQuery) {
  const data = callbackQuery.data || "";
  const chatId = callbackQuery.message?.chat?.id;
  await tg(env, "answerCallbackQuery", { callback_query_id: callbackQuery.id });
  if (!chatId) return;

  if (data === "tests") return sendTestList(env, chatId);
  if (data === "about" || data === "help" || data === "contact") {
    await tg(env, "editMessageText", {
      chat_id: chatId,
      message_id: callbackQuery.message.message_id,
      text: TEXTS[data],
      reply_markup: MAIN_KEYBOARD,
    });
    return;
  }
  if (data.startsWith("test:")) return showTestDetails(env, chatId, data.slice(5));
  if (data.startsWith("start:")) return startTest(env, chatId, data.slice(6));
  if (data.startsWith("ans:")) {
    const [, sessionId, position, optionPosition] = data.split(":");
    return answerQuestion(env, chatId, sessionId, Number(position), Number(optionPosition));
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({ ok: true, bot: "telbot", database: isDbReady(env) ? "d1" : "not-configured" });
    }
    if (request.method === "GET" && url.pathname === "/setup-webhook") {
      if (!env.BOT_TOKEN || !env.WEBHOOK_SECRET) {
        return Response.json({ ok: false, error: "ابتدا BOT_TOKEN و WEBHOOK_SECRET را تنظیم کنید" }, { status: 500 });
      }
      const result = await tg(env, "setWebhook", {
        url: `${url.origin}/webhook`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
      });
      return Response.json(result);
    }
    if (request.method === "POST" && url.pathname === "/webhook") {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
      const update = await request.json();
      try {
        if (update.message) await handleMessage(ctx, env, update.message);
        else if (update.callback_query) await handleCallback(env, update.callback_query);
      } catch (err) {
        console.error("handle error:", err);
      }
      return new Response("ok");
    }
    return new Response("Not found", { status: 404 });
  },
};
