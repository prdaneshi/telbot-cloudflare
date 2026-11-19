# 🤖 ربات تلگرام روی Cloudflare Workers

ربات تلگرام webhook-based که کامل روی اِج کلودفلر اجرا می‌شود —
**بدون سرور، بدون پروکسی، رایگان** (سقف پلن رایگان: ۱۰۰هزار درخواست در روز).

## امکانات

- موتور عمومی اجرای آزمون‌های روان‌شناختی با داده‌های قابل نسخه‌بندی
- نگهداری جلسه، پاسخ‌ها و نتایج در Cloudflare D1
- منوی آزمون‌ها و اجرای سؤال‌به‌سؤال با دکمه‌های شیشه‌ای
- پاسخ به `/start` با منوی دکمه‌ای شیشه‌ای (آزمون‌ها / درباره / راهنما / تماس با ادمین)
- پاسخ به متن کاربر
- فوروارد پیام کاربران به ادمین (اختیاری)
- تأیید امنیتی webhook با secret token

## ساختار

| فایل | نقش |
|---|---|
| `src/worker.js` | کل کد ربات (Cloudflare Worker) |
| `wrangler.toml` | تنظیمات wrangler |
| `migrations/0001_initial.sql` | ساختار D1 برای موتور عمومی آزمون |

## راه‌اندازی با wrangler (CLI)

```powershell
# ۱) نصب وابستگی‌ها
npm install

# ۲) ورود به کلودفلر (مرورگر باز می‌شود)
npx wrangler login

# ۳) ساخت دیتابیس D1 (فقط یک بار)
npx wrangler d1 create telbot-db
# شناسهٔ خروجی را در wrangler.toml در database_id قرار دهید

# ۴) اجرای migration روی دیتابیس Cloudflare
npx wrangler d1 migrations apply telbot-db

# ۵) تنظیم رازها
npx wrangler secret put BOT_TOKEN        # توکن ربات از @BotFather
npx wrangler secret put WEBHOOK_SECRET   # یک رشته تصادفی دلخواه
# اختیاری — برای دریافت پیام کاربران:
# npx wrangler secret put ADMIN_CHAT_ID  # عدد chat_id خودتان

# ۶) دیپلوی
npx wrangler deploy

# ۷) اتصال webhook (فقط یک بار بعد از دیپلوی اول)
# آدرس ورکر را در مرورگر باز کنید:  https://telbot.<subdomain>.workers.dev/setup-webhook
```

## راه‌اندازی بدون CLI (از داشبورد)

1. در [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Create Worker** → نام `telbot` → **Deploy**
2. **Edit code** → محتوای `src/worker.js` را جایگزین کنید → **Deploy**
3. **Settings → Variables and Secrets**:
   - `BOT_TOKEN` (Secret) = توکن ربات
   - `WEBHOOK_SECRET` (Secret) = یک رشته تصادفی (مثلاً از [random.org](https://www.random.org/strings/))
4. آدرس ورکر را باز کنید و `/setup-webhook` را به آخرش اضافه کنید — باید `{"ok":true}` ببینید
5. در تلگرام به ربات `/start` بدهید 🎉

## نکته‌ها

- بعد از هر دیپلوی، webhook تنظیم‌شده باقی می‌ماند؛ فقط اگر آدرس ورکر عوض شود دوباره `/setup-webhook` را باز کنید.
- دیدن لاگ زنده: `npx wrangler tail`

## افزودن آزمون

سؤال‌ها و قوانین نمره‌گذاری داخل Worker هاردکد نشده‌اند. هر آزمون باید در جدول‌های
`tests`, `test_versions`, `dimensions`, `questions`, `options`, `question_scoring`
و `result_interpretations` ثبت شود. بنابراین افزودن NEO یا آزمون‌های بعدی بدون
تغییر موتور اجرای آزمون انجام می‌شود.
