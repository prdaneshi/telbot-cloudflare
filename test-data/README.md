# ورود دادهٔ آزمون

فایل `neo.template.json` فقط قالب است و هیچ سؤال واقعی NEO در آن قرار ندارد.
پس از آماده‌شدن فایل مجاز آزمون، آن را با همین ساختار تکمیل کنید.

نکته‌ها:

- `questions.position` و `options.position` باید از صفر شروع شوند و پشت‌سرهم باشند.
- متن سؤال‌ها، کلید نمره‌گذاری، سؤال‌های معکوس، ابعاد و تفسیرها باید از منبع مجاز آزمون وارد شوند.
- `reverse: true` برای سؤال‌هایی است که امتیازشان باید در بازهٔ `scale.min` تا `scale.max` معکوس شود.
- برای فعال‌شدن آزمون، هم `active` در آزمون و هم `version.active` باید `true` باشند.

تولید SQL:

```powershell
node scripts/build-test-sql.mjs test-data/neo.json migrations/0002_neo.sql
```

اعمال روی D1 remote:

```powershell
npx wrangler d1 execute telbot-db --remote --file migrations/0002_neo.sql
```

قبل از اجرای SQL، فایل خروجی را بازبینی کنید. محتوای رسمی و دارای مجوز را در GitHub عمومی قرار ندهید مگر اینکه مجوز آن انتشار را پوشش دهد.
