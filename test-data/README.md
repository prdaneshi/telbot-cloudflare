# ورود دادهٔ آزمون

فایل `neo.template.json` یک نمونهٔ غیرواقعی برای ساختار دادهٔ آزمون است. برای ورود نسخهٔ فارسی نئو، فایل مجاز سؤال‌ها و کلید نمره‌دهی را با همین ساختار در `test-data/neo.local.json` قرار دهید. Git این فایل محلی را نادیده می‌گیرد. محتوای رسمی را فقط در صورتی در مخزن عمومی منتشر کنید که مجوز انتشار داشته باشید.

- جایگاه سؤال‌ها و گزینه‌ها از صفر شروع می‌شود و باید پیوسته باشد.
- `reverse: true` امتیاز پاسخ را در بازهٔ `scale.min` تا `scale.max` معکوس می‌کند.
- وقتی هر دو پرچم `active` و `version.active` روشن باشند، آزمون در منوی ربات نمایش داده می‌شود.

برای ساخت SQL و ورود داده به یک پایگاه محلی جدا، از ریشهٔ پروژه اجرا کنید:

```powershell
New-Item -ItemType Directory -Force .wrangler | Out-Null
node scripts/build-test-sql.mjs test-data/neo.local.json .wrangler/neo-seed.sql
npx wrangler d1 migrations apply telbot-db --local --persist-to .wrangler/neo-staging
npx wrangler d1 execute telbot-db --local --persist-to .wrangler/neo-staging --file .wrangler/neo-seed.sql
```

برای فعال کردن آزمون فقط در همان پایگاه محلی:

```powershell
npx wrangler d1 execute telbot-db --local --persist-to .wrangler/neo-staging --command "UPDATE tests SET active = 1 WHERE id = 'neo'; UPDATE test_versions SET active = 1 WHERE test_id = 'neo' AND version_label = 'fa-licensed-1';"
```

فایل SQL تولیدشده حاوی متن سؤال‌هاست و در پوشهٔ نادیده‌گرفته‌شدهٔ `.wrangler` می‌ماند. پیش از ورود داده به محیط اصلی، فایل را بازبینی کنید. اگر نسخهٔ قبلی پاسخ ثبت‌شده دارد، برای بارگذاری کلید یا سؤال‌های جدید یک برچسب نسخهٔ تازه انتخاب کنید تا دادهٔ آزمون‌های قبلی حفظ شود.

## آزمون با ربات تلگرام آزمایشی

این مرحله به ورود به Cloudflare و یک ربات جداگانه از BotFather نیاز دارد. همهٔ فرمان‌های زیر تنظیمات `wrangler.neo-staging.toml` را به‌صورت صریح انتخاب می‌کنند تا به Worker یا دیتابیس اصلی وصل نشوند.

برای ساخت پایگاه آزمایشی در اولین اجرا، سپس ورود داده و استقرار Worker آزمایشی:

```powershell
npx wrangler login
$cfg = 'wrangler.neo-staging.toml'
npx wrangler d1 create telbot-neo-staging-db --config $cfg --binding DB --update-config
npx wrangler d1 migrations apply telbot-neo-staging-db --remote --config $cfg
npx wrangler d1 execute telbot-neo-staging-db --remote --config $cfg --file .wrangler/neo-seed.sql
npx wrangler deploy --config $cfg
```

توکن ربات آزمایشی و یک کلید تصادفی مستقل برای وب‌هوک را در ورودی تعاملی Wrangler وارد کنید:

```powershell
npx wrangler secret put BOT_TOKEN --config $cfg
npx wrangler secret put WEBHOOK_SECRET --config $cfg
```

مسیر `/setup-webhook` را روی نشانی Worker آزمایشی باز کنید و موفقیت ثبت وب‌هوک را بررسی کنید. سپس آزمون را فقط در پایگاه آزمایشی روشن کنید:

```powershell
npx wrangler d1 execute telbot-neo-staging-db --remote --config $cfg --command "UPDATE tests SET active = 1 WHERE id = 'neo'; UPDATE test_versions SET active = 1 WHERE test_id = 'neo' AND version_label = 'fa-licensed-1';"
```

در گفت‌وگوی خصوصی با ربات آزمایشی، `/start` را بفرستید و منو، نمایش پنج گزینه، ثبت پاسخ و نمایش نتیجه را بررسی کنید.
