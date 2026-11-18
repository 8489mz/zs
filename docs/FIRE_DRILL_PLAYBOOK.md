# دليل الطوارئ: السيرفر واقع — ماذا تفعل خطوة بخطوة (Fire-Drill Playbook)

> **متى تستخدم هذه الصفحة:** السيرفر السحابي واقع أو قاعدة البيانات تالفة أو محذوفة،
> والمحلات لا تستطيع الدخول. هذه الصفحة للاسترجاع **على نفس السيرفر**.
> لو السيرفر نفسه راح (أوراكل قفلت الحساب، أو قررت تنقل لمزود آخر)،
> استخدم بدلاً منها [دليل الاسترجاع والنقل لسيرفر جديد](DISASTER_RECOVERY.md).
>
> **الهدف:** ترجع الخدمة من أحدث نسخة احتياطية، بترتيب ثابت، من غير تخمين.
> الوقت المتوقع للاسترجاع الكامل: **ساعة تقريباً** (تجربة 22 سبتمبر 2026: 9 ثوانٍ للاسترجاع نفسه،
> وباقي الوقت تجهيز وتحقّق).
>
> **قبل أي شيء:** كل النسخ مشفّرة، وكلمة سر فك التشفير في `/etc/zsystems/backup-passphrase`.
> **من غيرها لا توجد نسخة واحدة تُفتح — لا محلية ولا Drive ولا Oracle.**
> تأكد أن عندك نسخة منها خارج السيرفر قبل أن تبدأ.

## أماكن النسخ الاحتياطية (مُثبتة من `deploy/scripts/zsystems-backup.sh`)

| النسخة | الملف | محلياً `/var/backups/zsystems` | Google Drive `zsystems-backups` | Oracle Object Storage |
|---|---|---|---|---|
| الساعية `hourly` | `zsystems_hourly_<التاريخ>.sql.gz.enc` — `pg_dump` مشفّر فقط | **3 أيام** | **7 أيام** | **لا تُرفع عمداً** — رابط الـPAR للكتابة فقط ولا يحذف القديم، فـ24 ملفاً في اليوم تملأ الحاوية |
| اليومية `daily` | `zsystems_backup_<التاريخ>.zip.enc` — ملف مجمّع: نسخة السيرفر كله + حزمة جاهزة لكل منشأة + `manifest.json` | **14 يوماً** | **90 يوماً** | **نعم** عبر رابط PAR في `/etc/zsystems/backup-par-url` |

- الجدولة (crontab المستخدم `ubuntu`): اليومية كل يوم 03:00، الساعية كل ساعة `:30`، وتمرين الاسترجاع الآلي كل أحد 04:15.
- **ما الذي يضيع (RPO):** بالنسخة الساعية **حتى ساعة واحدة** من العمليات؛ بالنسخة اليومية وحدها **حتى 24 ساعة**.
  الاسترجاع يرجع البيانات إلى **وقت النسخة**، وأي عملية بعد ذلك الوقت تضيع — لا يوجد استرجاع لحظي (WAL/PITR) بعد.
- **كيف تعرف أن النسخ سليمة قبل الأزمة:** تمرين الاسترجاع الآلي `zsystems-restore-drill.sh`
  يسترجع أحدث نسخة كل أحد في قاعدة منفصلة اسمها `zsystems_restore_drill` ويقارنها بالإنتاج
  (جداول، صفوف، هجرات، مفاتيح مرجعية) **من غير أن يلمس قاعدة الإنتاج**، ويرسل تنبيه تليجرام لو فشل.
  والتجربة اليدوية الكاملة مطلوبة كل 3 شهور وتُسجَّل في `docs/DISASTER_RECOVERY.md`.

---

## الخطوة 1 — تأكد من العطل ومَن المتأثر

```bash
pm2 ls                                            # هل zsystems-backend = online؟
curl -s http://127.0.0.1:3000/api/health/live     # لازم "status":"ok" (لا يفحص قاعدة البيانات)
curl -s http://127.0.0.1:3000/api/health/ready    # لازم "status":"ok" و "database":"up" (يفحص قاعدة البيانات)
sudo docker ps | grep zsystems-postgres           # هل حاوية قاعدة البيانات شغالة؟
```

- لو `live` سليم و`ready` فاشل: المشكلة في قاعدة البيانات، لا في التطبيق — انتقل للخطوة 2.
- لو الاثنان فاشلان و`pm2 ls` يقول الباك إند متوقف: جرّب أولاً `pm2 reload zsystems-backend`،
  وأعد فحص الصحة؛ لو رجعت، كان توقفاً عابراً ولا حاجة لاسترجاع.
- **المتأثرون:** كل منشآت السحابة تشترك في قاعدة بيانات وباك إند واحد، فالعطل يمس الجميع.
  الكاشير يستمر في البيع دون إنترنت وتتزامن الفواتير لما يرجع الاتصال،
  ومندوبو التوزيع توضع عملياتهم في الطابور دون إنترنت — لا تطلب من أحد إعادة إدخال فواتير.
- تنبيه تليجرام عن انقطاع قاعدة البيانات يُرسَل **تلقائياً** من فحص الصحة
  (`backend/src/core/health/health.controller.ts`)، فلا تنتظر وصوله لتبدأ.

## الخطوة 2 — حدّد أحدث نسخة احتياطية

```bash
ls -lt /var/backups/zsystems/ | head -20
```

- خذ **أحدث نسخة ساعية** (`zsystems_hourly_*.sql.gz.enc`) إن كان عمرها أقل من ساعة؛
  إن لم توجد نسخة ساعية حديثة، خذ **أحدث ملف مجمّع يومي** (`zsystems_backup_*.zip.enc`).
- لو السيرفر نفسه لا يرد: خذ النسخة من Google Drive (مجلد `zsystems-backups` عبر `rclone`، remote اسمه `gdrive`)،
  ولو أوراكل قفلت الحساب فالـ Bucket راح معها — خذها من Google Drive حصراً.
- تأكد أن الملف كامل قبل أن تعتمد عليه:
  `openssl` يفك التشفير ثم `gzip -cd <الملف> | tail -n 5 | grep -q "PostgreSQL database dump complete"`.
  نسخة لا تنتهي بسطر إكمال `pg_dump` **تُرفَض** — خذ النسخة التي قبلها.

## الخطوة 3 — استرجع في قاعدة البيانات الحية

> **فخّ موثّق — لا تقع فيه:** `deploy/scripts/zsystems-restore.sh full`
> **يرفض العمل على قاعدة بيانات غير فاضية** (يخرج بخطأ لو وجد أي جدول).
> هو لسيرفر جديد فقط، وليس لاسترجاع قاعدة حية. أمر `tenant` منه يسترجع منشأة واحدة فقط،
> لا السيرفر كله. استرجاع السيرفر كله على قاعدة حية يتم بالوصفة التالية،
> وهي نفس وصفة `deploy/scripts/zsystems-restore-drill.sh` (§2–§3)، لا بغيرها.

```bash
# 1. أوقف الباك إند أولاً حتى لا يكتب أحد أثناء الاسترجاع
pm2 stop zsystems-backend

# 2. إن كانت قاعدة البيانات لا تزال ترد، خذ نسخة أمان منها قبل أن تمسحها
sudo docker exec zsystems-postgres pg_dump -U postgres zsystems_db | gzip > /var/backups/zsystems/pre-restore-$(date +%Y%m%d_%H%M%S).sql.gz
gzip -cd /var/backups/zsystems/pre-restore-*.sql.gz | tail -n 5 | grep -q "PostgreSQL database dump complete" || echo "SAFETY DUMP INCOMPLETE - STOP"

# 3. فكّ التشفير إلى ملف SQL (كلمة السر من /etc/zsystems/backup-passphrase)
#    من نسخة ساعية:
openssl enc -d -aes-256-cbc -pbkdf2 -in /var/backups/zsystems/zsystems_hourly_<التاريخ>.sql.gz.enc -out /tmp/restore.sql.gz -pass file:/etc/zsystems/backup-passphrase
#    من ملف مجمّع يومي (من مجلد backend):
(cd /var/www/zsystems/app/backend && /usr/bin/node --env-file=.env dist/tools/zs-backup-tool.js extract --in /var/backups/zsystems/zsystems_backup_<التاريخ>.zip.enc --entry full/zsystems_db.sql.gz --out - --passphrase-file /etc/zsystems/backup-passphrase) > /tmp/restore.sql.gz

# 4. امسح قاعدة البيانات الحية وأعد إنشاءها فاضية — هذه نقطة اللاعودة:
#    كل ما كُتب بعد وقت النسخة يضيع هنا. لا تنفذها إلا بعد الخطوتين 1 و2 أعلاه.
sudo docker exec zsystems-postgres psql -U postgres -d postgres -q -c "DROP DATABASE zsystems_db WITH (FORCE)"
sudo docker exec zsystems-postgres psql -U postgres -d postgres -q -c "CREATE DATABASE zsystems_db"

# 5. استرجع، وعدّ سطور الخطأ — لازم يكون صفر
gunzip -c /tmp/restore.sql.gz | sudo docker exec -i zsystems-postgres psql -U postgres -d zsystems_db -q > /tmp/restore.log 2>&1
grep -c "^ERROR" /tmp/restore.log
# إن ظهر أي سطر ERROR: توقف، اقرأ أول سطر خطأ كاملاً، ولا تكمل للخطوة 4.
```

**بديل — العطل في التطبيق فقط وقاعدة البيانات سليمة:**
لا تسترجع قاعدة البيانات أصلاً. ارجع لمجلد الإصدار السابق الذي يحتفظ به النشر:
`backend/dist.prev` و`frontend/dist.prev` (يوجدان فقط بعد نشر بدّل المجلدات؛
وعند فشل فحص الصحة بعد النشر يرجع النشر نفسه تلقائياً).

```bash
mv /var/www/zsystems/app/backend/dist /var/www/zsystems/app/backend/dist.bad
mv /var/www/zsystems/app/backend/dist.prev /var/www/zsystems/app/backend/dist
mv /var/www/zsystems/app/frontend/dist /var/www/zsystems/app/frontend/dist.bad
mv /var/www/zsystems/app/frontend/dist.prev /var/www/zsystems/app/frontend/dist
pm2 reload zsystems-backend --update-env
```

## الخطوة 4 — أعد تشغيل الهجرات إلى الـSHA المنشور إن كان المخطط متأخراً

```bash
cd /var/www/zsystems/app/backend
npm run migration:list    # قارن عدد الهجرات المطبقة بعددها في النسخة المسترجعة
npm run migration:run     # إن كانت ناقصة — يشغّل الناقص فقط
```

- بعد الاسترجاع، قاعدة البيانات على مخطط **وقت النسخة**؛ إن كان الكود المنشور أحدث منها،
  `migration:run` يرفعها إلى مخطط الـSHA المنشور. لا تشغّل الباك إند على مخطط أقدم من الكود.
- **سلوك النشر الحالي — اقرأ قبل أن تفترض (آخر تحقق: 2026-11-18 — حي على `main` منذ حزمة INV-MIGRATION-AUTO-REVERT):**
  عند فشل الهجرات أو فحص الصحة أثناء النشر، النشر **يرجع قاعدة البيانات تلقائياً** إلى مخطط ما قبل النشر
  (INV-MIGRATION-AUTO-REVERT، **حي على `main`**): يرجع الهجرات واحدة تلو الأخرى بـ `migration:revert`
  حتى عدد ما قبل النشر (مع التحقق أن العدد ينقص بعد كل `down`)، وإن تعذّر يسترجع نسخة الساعة
  التي أخذها النشر قبل الهجرات (الخطوة 4 من `deploy-oracle.yml`).
  فبعد أي نشر فاشل، افحص `migration:list` قبل أن تعيد التشغيل أو تسترجع:
  إن كان المخطط متقدماً على الكود الذي ستُشغّله، ارجعه بـ `npm run migration:revert`
  (أمر واحد يرجع هجرة واحدة — كرره وتحقق أن العدد ينقص بعد كل مرة)،
  أو استرجع من نسخة الساعة التي أخذها النشر قبل الهجرات يدوياً.

## الخطوة 5 — شغّل فحوصات الصحة

```bash
pm2 reload zsystems-backend --update-env   # أو pm2 start إن كان متوقفاً
pm2 ls                                      # zsystems-backend = online
curl -s http://127.0.0.1:3000/api/health/live    # لازم 200 و "status":"ok"
curl -s http://127.0.0.1:3000/api/health/ready   # لازم 200 و "status":"ok" و "database":"up"
```

- إن ردّ `ready` بـ 503 أو `"database":"down"`: قاعدة البيانات لم ترجع سليمة — ارجع للخطوة 3
  واقرأ `/tmp/restore.log` من أول سطر `ERROR`.
- ادخل بحساب المنصة وبحساب عميل، وتأكد أن آخر فواتير **يوم النسخة** موجودة،
  وأن عدد الجداول والهجرات يطابق ما قبل العطل (`select count(*) from pg_tables` و`kysely_migration`).

## الخطوة 6 — أبلغ المنشآت المتأثرة

- تنبيه تليجرام عن العطل وفشل النشر يُرسَل تلقائياً (من فحص الصحة ومن workflow النشر) —
  هو تنبيه لك أنت، وليس إبلاغاً للعملاء.
- **لا توجد رسالة جماعية للمنشآت داخل النظام** — أبلغ كل عميل متأثر مباشرة (تليجرام/واتساب/اتصال)،
  واذكر ثلاث حقائق فقط: وقت وقوع العطل، ووقت النسخة التي رجعت إليها البيانات (نقطة الفقدان)،
  وما الذي ضاع بعد ذلك الوقت إن وُجد.
- بعد رجوع الخدمة، راقب أول فاتورة تُدخَل من كل منشأة: رقم الفاتورة يجب أن يكمل تسلسل ما قبل العطل
  من غير تكرار ولا قفزة — تكرار الرقم يعني أن الاسترجاع لم يكن على أحدث نسخة.

---

## بعد الأزمة (خلال 24 ساعة)

1. سجّل في `docs/DISASTER_RECOVERY.md` (سجل تجارب الاسترجاع): التاريخ، ملف النسخة المستخدم، النتيجة، والوقت المستغرق.
2. تحقق أن النسخ المجدولة عادت: `ls -lt /var/backups/zsystems/` يظهر نسخة ساعية جديدة،
   و`crontab -l` يظهر أسطر النسخ الثلاثة (يومية 03:00، ساعية `:30`، تمرين أحد 04:15).
3. إن كان سبب العطل نشراً فاشلاً، لا تعيد النشر قبل أن يُصلَح السبب وتُفحَص `migration:list`
   (الخطوة 4) — إعادة النشر على مخطط متقدم تعيد نفس الفشل.
