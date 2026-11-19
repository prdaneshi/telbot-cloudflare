/**
 * Generic Telegram psychological-test engine on Cloudflare Workers + D1.
 * Tests are data: the Worker knows how to run a test, but does not contain
 * NEO (or any other test) questions.
 */

const MAIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: "🧠 آزمون‌ها", callback_data: "tests" }],
    [{ text: "🔄 ارزیابی مجدد", callback_data: "history:0" }],
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
    "• ارزیابی مجدد — محاسبهٔ دوبارهٔ نتیجه با پاسخ‌های ذخیره‌شده در گفت‌وگوی خصوصی\n" +
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
    "یکی از گزینه‌های منوی زیر را انتخاب کنید."
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

async function getOptions(env, versionId) {
  const { results } = await env.DB.prepare(
    `SELECT position, label FROM options
     WHERE test_version_id = ? ORDER BY position`
  ).bind(versionId).all();
  return results || [];
}

async function getQuestion(env, versionId, position) {
  return env.DB.prepare(
    `SELECT id, position, text FROM questions
     WHERE test_version_id = ? AND position = ?`
  ).bind(versionId, position).first();
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

function answerKeyboard(options, sessionId, position, selected, { showSubmit = false, color = true } = {}) {
  const inline_keyboard = options.map((option) => {
    const isSelected = option.position === selected;
    return [{
      text: isSelected ? `✅ ${option.label}` : option.label,
      callback_data: `ans:${sessionId}:${position}:${option.position}`,
      ...(isSelected && color ? { style: "success" } : {}),
    }];
  });
  if (showSubmit) {
    inline_keyboard.push([{ text: "ثبت نهایی و نمایش نتیجه", callback_data: `submit:${sessionId}` }]);
  }
  return { inline_keyboard };
}

async function sendQuestion(env, chatId, sessionId, versionId, position) {
  const question = await getQuestion(env, versionId, position);
  if (!question) throw new Error(`question not found: ${versionId}/${position}`);
  const options = await getOptions(env, versionId);
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: `سؤال ${position + 1}\n\n${question.text}`,
    reply_markup: answerKeyboard(options, sessionId, position),
  });
}

async function highlightAnswer(env, chatId, messageId, session, position, saved) {
  try {
    const options = await getOptions(env, session.test_version_id);
    const showSubmit = position === session.last_position;
    const edit = (selected, color) => tg(env, "editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: answerKeyboard(options, session.id, position, selected, { showSubmit, color }),
    });
    const applied = (result) => result.ok || /message is not modified/i.test(result.description ?? "");

    let selected = saved.option_position;
    // If two clicks overlap, an older Telegram edit can finish last. Re-read
    // the saved choice after each edit to bring the keyboard back in sync.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!applied(await edit(selected, true)) && !applied(await edit(selected, false))) {
        console.warn("Unable to mark saved answer");
        return;
      }
      const latest = await env.DB.prepare(
        `SELECT option_position FROM answers WHERE session_id = ? AND question_id = ?`
      ).bind(session.id, saved.question_id).first();
      if (!latest || latest.option_position === selected) return;
      selected = latest.option_position;
    }
  } catch {
    console.warn("Unable to mark saved answer");
  }
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
      `تعداد سؤال‌ها: ${count}\n\n` +
      "می‌توانید پاسخ‌ها را تا قبل از ثبت نهایی تغییر دهید.",
    reply_markup: {
      inline_keyboard: [[{ text: "▶️ شروع آزمون", callback_data: `start:${version.id}` }]],
    },
  });
}

const HISTORY_PAGE_SIZE = 8;
const SESSION_DATE_FORMAT = new Intl.DateTimeFormat("fa-IR", {
  dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Tehran",
});

function formatSessionDate(date) {
  return SESSION_DATE_FORMAT.format(new Date(`${date.replace(" ", "T")}Z`));
}

const COMPLETED_SESSION = "s.id = ? AND s.chat_id = ? AND s.status = 'completed'";

function scoreQuery(eligibleSession) {
  return `WITH scores AS (
    SELECT s.id AS session_id, s.test_version_id, d.id AS dimension_id,
           d.key AS dimension_key,
           ROUND(SUM(
             (CASE WHEN qs.reverse_scored = 1
               THEN (v.scale_min + v.scale_max - a.option_value)
               ELSE a.option_value END) * qs.weight
           ), 2) AS raw_score
    FROM test_sessions s
    JOIN test_versions v ON v.id = s.test_version_id
    JOIN answers a ON a.session_id = s.id
    JOIN question_scoring qs ON qs.question_id = a.question_id
    JOIN dimensions d ON d.id = qs.dimension_id
    WHERE ${eligibleSession} AND d.test_version_id = s.test_version_id
    GROUP BY d.id
  )`;
}

async function getCompletedTest(env, chatId, sessionId) {
  return env.DB.prepare(
    `SELECT s.id, t.title, v.version_label, COALESCE(s.completed_at, s.started_at) AS session_date
     FROM test_sessions s
     JOIN test_versions v ON v.id = s.test_version_id
     JOIN tests t ON t.id = v.test_id
     WHERE ${COMPLETED_SESSION}`
  ).bind(sessionId, String(chatId)).first();
}

async function sendTestHistory(env, chatId, page) {
  const { results } = await env.DB.prepare(
    `SELECT s.id, t.title, v.version_label, COALESCE(s.completed_at, s.started_at) AS session_date
     FROM test_sessions s
     JOIN test_versions v ON v.id = s.test_version_id
     JOIN tests t ON t.id = v.test_id
     WHERE s.chat_id = ? AND s.status = 'completed'
     ORDER BY session_date DESC, s.id DESC
     LIMIT ? OFFSET ?`
  ).bind(String(chatId), HISTORY_PAGE_SIZE + 1, page * HISTORY_PAGE_SIZE).all();

  if (!results.length) {
    return tg(env, "sendMessage", {
      chat_id: chatId,
      text: page === 0 ? "هنوز آزمون تکمیل‌شده‌ای برای ارزیابی مجدد ندارید." : "آزمون دیگری در این صفحه نیست.",
      reply_markup: MAIN_KEYBOARD,
    });
  }

  const buttons = results.slice(0, HISTORY_PAGE_SIZE).map((session) => [{
    text: `${session.title} (${session.version_label}) — ${formatSessionDate(session.session_date)}`,
    callback_data: `reassess:${session.id}`,
  }]);
  const navigation = [];
  if (page > 0) navigation.push({ text: "صفحهٔ قبل", callback_data: `history:${page - 1}` });
  if (results.length > HISTORY_PAGE_SIZE) navigation.push({ text: "صفحهٔ بعد", callback_data: `history:${page + 1}` });
  if (navigation.length) buttons.push(navigation);
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: "🔄 برای محاسبهٔ دوبارهٔ نتیجه، یکی از آزمون‌های تکمیل‌شده را انتخاب کنید:",
    reply_markup: { inline_keyboard: buttons },
  });
}

async function finishTest(env, chatId, sessionId, isPrivate) {
  if (!isDbReady(env)) return;
  // Write the scores and close the session in the same transaction. An edit
  // either lands before scoring or sees the closed session and is rejected.
  const ready = `s.id = ? AND s.chat_id = ? AND s.status = 'in_progress'
    AND s.current_position > 0 AND s.current_position = (
      SELECT COUNT(*) FROM questions q WHERE q.test_version_id = s.test_version_id
    )`;
  const [, completed] = await env.DB.batch([
    env.DB.prepare(
      `${scoreQuery(ready)}
       INSERT INTO results (id, session_id, dimension_key, raw_score, level, interpretation)
       SELECT lower(hex(randomblob(16))), scores.session_id, scores.dimension_key,
              scores.raw_score, ri.level, ri.text
       FROM scores
       LEFT JOIN result_interpretations ri ON ri.id = (
         SELECT id FROM result_interpretations
         WHERE test_version_id = scores.test_version_id AND dimension_id = scores.dimension_id
           AND min_score <= scores.raw_score AND max_score >= scores.raw_score
         ORDER BY min_score DESC, id LIMIT 1
       )`
    ).bind(sessionId, String(chatId)),
    env.DB.prepare(
      `UPDATE test_sessions AS s
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE ${ready}`
    ).bind(sessionId, String(chatId)),
  ]);
  if (!completed.meta.changes) return;

  const session = await getCompletedTest(env, chatId, sessionId);
  if (!session) return;
  const { results: scores } = await env.DB.prepare(
    `SELECT d.title AS dimension_title, d.description AS dimension_description, r.raw_score
     FROM results r
     JOIN test_sessions s ON s.id = r.session_id
     JOIN dimensions d ON d.test_version_id = s.test_version_id AND d.key = r.dimension_key
     WHERE ${COMPLETED_SESSION}
     ORDER BY d.sort_order, d.id`
  ).bind(sessionId, String(chatId)).all();
  await sendTestResult(env, chatId, session, scores, { showReassessment: isPrivate });
}

async function reassessTest(env, chatId, sessionId) {
  const session = await getCompletedTest(env, chatId, sessionId);
  if (!session) {
    return tg(env, "sendMessage", {
      chat_id: chatId,
      text: "این آزمون برای ارزیابی مجدد در دسترس نیست.",
      reply_markup: MAIN_KEYBOARD,
    });
  }

  const { results: scores } = await env.DB.prepare(
    `${scoreQuery(COMPLETED_SESSION)}
     SELECT d.title AS dimension_title, d.description AS dimension_description, scores.raw_score
     FROM scores
     JOIN dimensions d ON d.id = scores.dimension_id
     ORDER BY d.sort_order, d.id`
  ).bind(sessionId, String(chatId)).all();
  await sendTestResult(env, chatId, session, scores, { reassessed: true });
}

async function sendTestResult(env, chatId, session, scores, { reassessed = false, showReassessment = false } = {}) {
  const lines = scores.length
    ? scores.map((score) => `• ${score.dimension_title}: ${score.raw_score}${score.dimension_description ? `\n  ${score.dimension_description}` : ""}`)
    : ["نتیجه‌ای برای این آزمون محاسبه نشد."];
  const summary = reassessed
    ? `🔄 ارزیابی مجدد آزمون «${session.title}» (${session.version_label})\n` +
      `تاریخ تکمیل: ${formatSessionDate(session.session_date)}\n\n` +
      "نتیجه بر اساس پاسخ‌های ذخیره‌شده:\n"
    : `✅ آزمون «${session.title}» به پایان رسید.\n\nنتیجهٔ اولیه:\n`;
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text:
      summary + lines.join("\n") +
      "\n\nاین نتیجه برای خودشناسی است و جایگزین ارزیابی تخصصی نمی‌شود.",
    reply_markup: showReassessment ? {
      inline_keyboard: [
        [{ text: "🔄 ارزیابی مجدد این آزمون", callback_data: `reassess:${session.id}` }],
        ...MAIN_KEYBOARD.inline_keyboard,
      ],
    } : MAIN_KEYBOARD,
  });
}

async function answerQuestion(env, chatId, messageId, sessionId, position, optionPosition) {
  if (!isDbReady(env) || !Number.isSafeInteger(position) || !Number.isSafeInteger(optionPosition)) return;
  const session = await env.DB.prepare(
    `SELECT s.id, s.test_version_id, s.current_position,
            (SELECT MAX(position) FROM questions WHERE test_version_id = s.test_version_id) AS last_position
     FROM test_sessions s
     WHERE s.id = ? AND s.chat_id = ? AND s.status = 'in_progress'`
  ).bind(sessionId, String(chatId)).first();
  if (!session || position > session.current_position) return;

  const saved = await env.DB.prepare(
    `INSERT INTO answers
     (id, session_id, question_id, option_position, option_value, answered_at)
     SELECT ?, s.id, q.id, o.position, o.value, CURRENT_TIMESTAMP
     FROM test_sessions s
     JOIN questions q ON q.test_version_id = s.test_version_id AND q.position = ?
     JOIN options o ON o.test_version_id = s.test_version_id AND o.position = ?
     WHERE s.id = ? AND s.chat_id = ? AND s.status = 'in_progress' AND q.position <= s.current_position
     ON CONFLICT(session_id, question_id) DO UPDATE SET
       option_position = excluded.option_position,
       option_value = excluded.option_value,
       answered_at = excluded.answered_at
     RETURNING question_id, option_position`
  ).bind(crypto.randomUUID(), position, optionPosition, sessionId, String(chatId)).first();
  if (!saved) return;

  const nextPosition = position + 1;
  let advanced = false;
  if (position === session.current_position) {
    const advance = await env.DB.prepare(
      `UPDATE test_sessions SET current_position = ?
       WHERE id = ? AND status = 'in_progress' AND current_position = ?`
    ).bind(nextPosition, sessionId, position).run();
    advanced = Boolean(advance.meta.changes);
  }
  await highlightAnswer(env, chatId, messageId, session, position, saved);
  if (advanced && position < session.last_position) {
    await sendQuestion(env, chatId, sessionId, session.test_version_id, nextPosition);
  }
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
  const isPrivate = callbackQuery.message?.chat?.type === "private";
  await tg(env, "answerCallbackQuery", { callback_query_id: callbackQuery.id });
  if (!chatId) return;

  if (data === "tests") return sendTestList(env, chatId);
  const historyPage = /^history:(\d{1,9})$/.exec(data);
  if (historyPage || data.startsWith("reassess:")) {
    const unavailable = !isPrivate ? "ارزیابی مجدد را در گفت‌وگوی خصوصی با ربات انجام دهید."
      : !isDbReady(env) ? "اتصال دیتابیس آزمون‌ها هنوز تنظیم نشده است."
      : null;
    if (unavailable) return tg(env, "sendMessage", { chat_id: chatId, text: unavailable });
    if (historyPage) return sendTestHistory(env, chatId, Number(historyPage[1]));
    return reassessTest(env, chatId, data.slice("reassess:".length));
  }
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
  if (data.startsWith("submit:")) return finishTest(env, chatId, data.slice(7), isPrivate);
  if (data.startsWith("ans:")) {
    const [, sessionId, position, optionPosition] = data.split(":");
    return answerQuestion(env, chatId, callbackQuery.message.message_id, sessionId, Number(position), Number(optionPosition));
  }
}

async function setupProductionWebhook(request, env) {
  if (request.method !== "POST") return new Response("Not found", { status: 404 });
  if (!env.WEBHOOK_SECRET || request.headers.get("Authorization") !== `Bearer ${env.WEBHOOK_SECRET}`) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!env.BOT_TOKEN || !env.PUBLIC_WEBHOOK_URL) {
    return Response.json({ ok: false, error: "Bot configuration is incomplete" }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  const action = body?.action;
  if (action !== "status" && action !== "connect") {
    return Response.json({ ok: false, error: "Expected action: status or connect" }, { status: 400 });
  }

  try {
    const bot = await tg(env, "getMe", {});
    if (!bot.ok) return Response.json({ ok: false, error: "Telegram rejected the bot token" }, { status: 502 });
    const username = bot.result?.username;
    if (username?.toLowerCase() !== env.BOT_USERNAME.toLowerCase()) {
      return Response.json({ ok: false, error: "Token belongs to a different bot" }, { status: 409 });
    }

    if (action === "connect") {
      const set = await tg(env, "setWebhook", {
        url: env.PUBLIC_WEBHOOK_URL,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
      });
      if (!set.ok) return Response.json({ ok: false, error: "Telegram refused webhook registration" }, { status: 502 });
    }

    const info = await tg(env, "getWebhookInfo", {});
    if (!info.ok) return Response.json({ ok: false, error: "Telegram did not return webhook status" }, { status: 502 });
    const connected = info.result?.url === env.PUBLIC_WEBHOOK_URL;
    const ok = action === "status" || connected;
    return Response.json({
      ok, username, connected,
      pendingUpdates: info.result?.pending_update_count,
    }, { status: ok ? 200 : 502 });
  } catch {
    return Response.json({ ok: false, error: "Could not reach Telegram" }, { status: 502 });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({ ok: true, bot: env.BOT_USERNAME || "telbot", database: isDbReady(env) ? "d1" : "not-configured" });
    }
    if (url.pathname === "/setup-webhook" && env.BOT_USERNAME) return setupProductionWebhook(request, env);
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
