# Z Systems Deployment Pipeline (Oracle Cloud VPS)

> ⚠️ **تنبيه حاسم:** المنظومة بالكامل (Frontend، Backend، Database - PostgreSQL) مستضافة وتعمل حصرياً على **سيرفر أوراكل (Oracle Cloud VPS)**. تم إنهاء استخدام أي استضافة أخرى نهائياً.

---

## 1. مرجع كود الإنتاج (Source of Truth)

يعتمد خط الإنتاج حصرياً على فرع رئيسي موحد:
```text
GitHub branch: main
```

- أي دمج (Merge) في فرع `main` يُطلق تلقائياً خط التحقق من الكود (`ci.yml`).
- نجاح الـCI على `main` يُطلق النشر تلقائياً عبر `deploy-oracle.yml` (محفَّز `workflow_run` بعد اكتمال `ci` بنجاح على دفعة إلى `main`)، ويتحقق الـworkflow من CI الأخضر لنفس SHA. ويمكن أيضاً تشغيل النشر يدوياً (Run workflow) من `main` بضغطة زر مباشرة، وفي هذه الحالة يتحقق الـworkflow من CI الأخضر لنفس SHA وأن `main` لم يتقدم منذ التشغيل.

---

## 2. التحقق المستمر والنشر التلقائي بعد نجاح CI (Automated CI / Automated CD)

يعمل ملف `.github/workflows/deploy-oracle.yml` بالتسلسل التالي (منذ 22 سبتمبر 2026):

1. **الاعتماد على نجاح CI والنشر التلقائي:** كل دفعة (push) إلى `main` تُطلق `ci.yml`، ونجاحه يُطلق `deploy-oracle.yml` تلقائياً (محفَّز `workflow_run`) لنفس SHA، من غير تدخل يدوي. ويمكن أيضاً بدء النشر يدوياً عبر `workflow_dispatch` من `main` بضغطة زر مباشرة (Run workflow)، وفي هذه الحالة يتحقق الـworkflow من نجاح `ci.yml` لنفس `github.sha` وفحص عدم تغير رأس `main` قبل لمس الخادم.
   - يلزم ضبط GitHub secret باسم `ORACLE_SSH_KNOWN_HOSTS` بسطر `known_hosts` لخادم Oracle بعد التحقق من بصمته عبر قناة موثوقة. سيرفض النشر الاتصال إذا غاب السر أو تغيّر مفتاح الخادم؛ لا تعتمد على `ssh-keyscan` وحده لإثبات الهوية.
2. **البناء على GitHub وليس على السيرفر:** يُبنى الباك إند (`nest build`) والفرونت إند (Vite) على جهاز GitHub، ويُحزَّم الناتج في `release.tgz` ويُرفع للسيرفر بـ `scp`.
   - **السبب:** السيرفر نواة واحدة و6 جيجا رام بلا Swap؛ البناء عليه كان يجمّد الكاشيرات لدقائق، وكان `rm -rf dist` قبل البناء يُسقط الباك إند طوال مدة البناء (سجّل PM2 أكثر من 1700 إعادة تشغيل فاشلة بخطأ `Cannot find module dist/main.js`).
   - متغيرات بناء الفرونت إند تأتي من GitHub Variables (`VITE_API_BASE_URL`, `VITE_CSRF_COOKIE_NAME`, `VITE_PLATFORM_TENANT_ID`) مع قيم افتراضية مطابقة لملف `frontend/.env.production` الموجود على السيرفر.
3. **على السيرفر:**
   - `git reset --hard <sha>` (المصدر مطلوب لأن الهجرات تعمل بـ `ts-node`).
   - `npm ci` للباك إند **فقط** إذا تغيّر `package-lock.json` (بصمة محفوظة في `node_modules/.zs-lock-hash`).
   - فك الحزمة في `/var/www/zsystems/.deploy-stage`، ثم إنشاء نسخة PostgreSQL ساعية مشفرة **قبل** تشغيل أي هجرة. إذا فشل النسخ يتوقف النشر ولا تتغير القاعدة.
   - تشغيل الهجرات **قبل** تبديل الكود. إذا فشل فحص الصحة بعد التبديل يعود الكود السابق، وتبقى نسخة ما قبل الهجرة متاحة للاسترجاع المتحكم به.
   - تبديل `backend/dist` و`frontend/dist` بعملية `mv` (النسخة السابقة تبقى في `dist.prev`).
4. **إعادة التحميل:** `pm2 reload zsystems-backend --update-env`.
5. **فحص الصحة مع رجوع تلقائي:** فحص `/api/health/live` و`/api/health/ready`؛ إن فشل تُعاد `dist.prev` للمكان ويُعاد تحميل PM2 ويفشل الإجراء.
6. **إعادة تحميل Nginx** ثم إشعار تليجرام.

> ملاحظة: `/var/www/zsystems/update.sh` القديم على السيرفر ما زال يبني على السيرفر نفسه — لا تستخدمه إلا للطوارئ.

### 2-b. النسخ الاحتياطي

- السكربت المرجعي: `deploy/scripts/zsystems-backup.sh`، يُثبَّت على السيرفر في `/var/www/zsystems/backup.sh` ويعمل يومياً 3 فجراً من crontab المستخدم `ubuntu`، وسجله في `/var/backups/zsystems/backup.log`.
- النسخة المحلية في `/var/backups/zsystems` تُحفظ 14 يوماً.
- **الملف المجمّع (منذ 22 سبتمبر 2026):** الملف `zsystems_backup_<التاريخ>.zip.enc` فيه `full/zsystems_db.sql.gz` (نسخة السيرفر كله) و`tenants/<slug>__<id>.zsbak` (حزمة جاهزة لكل منشأة) و`manifest.json`. بيتعمل بـ `node dist/tools/zs-backup-tool.js bundle`، ومشفّر بكلمة السر اللي في `/etc/zsystems/backup-passphrase`. يرفض السكربت التشغيل إذا غاب مفتاح التشفير، وإذا فشل التجميع يرفع نسخة dump مشفرة فقط.
- **الاسترجاع منه مباشرة:** `bash deploy/scripts/zsystems-restore.sh list|full|tenant|tenant-file ...` (التفاصيل في `docs/DISASTER_RECOVERY.md`).
- النسخة خارج السيرفر تُرفع إلى Oracle Object Storage عبر رابط Pre-Authenticated Request (كتابة فقط) محفوظ في `/etc/zsystems/backup-par-url`. بدون هذا الملف تبقى النسخة على السيرفر فقط.
- نسخة ثالثة **خارج حساب أوراكل** (تحمي من إغلاق الحساب نفسه): Google Drive عبر `rclone` بـ remote اسمه `gdrive` للمستخدم `ubuntu`، بصلاحية `drive.file` (يرى فقط الملفات التي أنشأها هو). المجلد `zsystems-backups`، والنسخ الأقدم من 90 يوماً تُحذف منه تلقائياً. الإعداد يتم مرة واحدة بـ `rclone config` عبر نفق SSH على المنفذ 53682.
- الوجهتان الخارجيتان مستقلتان: فشل واحدة لا يمنع الأخرى، والسكربت يخرج بخطأ إن فشلت أي منهما.
- **الاسترجاع والنقل لسيرفر جديد:** `docs/DISASTER_RECOVERY.md` — خطوات كاملة + سجل تجارب الاسترجاع الفعلية. إعداد nginx الفعلي محفوظ في `deploy/nginx/oracle-site.conf`.
- **خلل سابق (أُصلح في 22 سبتمبر 2026):** الـ cron القديم كان يوجّه السجل إلى `/var/log/zsystems_backup.log` الذي لا يملك المستخدم `ubuntu` صلاحية الكتابة عليه، فكانت الـ shell تفشل قبل تشغيل السكربت أصلاً. آخر نسخة فعلية كانت يوم 31 أغسطس 2026. كما كان `docker exec -t` يحقن `\r` في ملف SQL.

### 2-b-2. مراقبة السيرفر من الداخل (`deploy/scripts/zsystems-watch.sh`)

- يُثبَّت في `/var/www/zsystems/watch.sh` ويعمل من crontab المستخدم `ubuntu` مع كل restart (بعد 90 ثانية) وكل يوم 7 الصبح UTC، وسجله في `/var/backups/zsystems/watch.log`.
- **يبعت تنبيه تليجرام لو:** عدد الأنوية أو الرام قل عن المتوقع (بيتسجل أول مرة في `/etc/zsystems/expected-shape`)، أو السيرفر عمل restart، أو مفيش نسخة احتياطية جديدة من أكتر من 26 ساعة أو آخر نسخة فيها ERROR، أو القرص عدّى 85%، أو الباك إند وقف.
- **السبب:** أوراكل خفّضت حد السيرفرات المجانية للنص في يونيو 2026 من غير أي إعلان.
- إعدادات تليجرام في `/etc/zsystems/telegram.env` (`TELEGRAM_BOT_TOKEN` و`TELEGRAM_CHAT_ID`، صاحب الملف `ubuntu` وصلاحياته 600). من غيرها التنبيهات بتتكتب في السجل بس.
- **كل تنبيهات النظام بتروح لبوت واحد** (`Zsystem Alert`، من 22 سبتمبر 2026): سكربت المراقبة (`/etc/zsystems/telegram.env`)، وتنبيهات الباك إند على مستوى المنصة (`TELEGRAM_ALERTS_ENABLED` / `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` في `backend/.env` على السيرفر)، وإشعارات النشر **عند الفشل أو الرجوع التلقائي بس** (GitHub Secrets بنفس الأسماء؛ النجاح بيبان في GitHub ومش بيتبعت، عشان تليجرام يفضل للحاجات الحرجة). لو غيّرت البوت، غيّره في الأماكن التلاتة.
- **المراقبة الخارجية بتجرب 4 روابط من 22 سبتمبر 2026:** السيرفر مباشرة بالـIP، و`app.zsystemai.com/api/health/live`، و`uptime-probe.zsystemai.com/api/health/live` (بيختبر سجل `*` وشهادة Origin وبلوك المتاجر في nginx؛ الاسم محجوز في SF-10)، والموقع التسويقي `zsystemai.com`. التنبيه بيقول أنهي رابط وقع: لو `server` بس، يبقى السيرفر؛ لو الباقي، يبقى Cloudflare أو DNS أو الشهادة.
- **لو السيرفر وقف خالص**، السكربت ده مش هيقدر يبعت حاجة. التنبيه ساعتها بيجي من المراقبة الخارجية `.github/workflows/uptime-watch.yml`: بتشتغل على GitHub كل 5 دقايق (GitHub ممكن يأخرها شوية)، وبتجرب `https://<host>/api/health/live` تلات مرات. بتبعت على نفس البوت (نفس الـ GitHub Secrets) **لما الحالة تتغير بس**: رسالة لما السيرفر يقع، ورسالة لما يرجع. حالة التشغيلة اللي فاتت (نجحت ولا فشلت) هي اللي بتتقارن بيها الحالة الحالية.

### 2-c. سعة السيرفر الحالي (قياس 22 سبتمبر 2026)

- Oracle Ampere A1: **1 OCPU، 5.8 جيجا رام، بلا Swap**، قرص 45 جيجا، و PostgreSQL 16 في Docker على نفس السيرفر.
- الباك إند عملية PM2 واحدة (`fork`). لا يجوز تحويلها إلى `cluster` قبل نقل الحالة الموجودة في الذاكرة (`auth-cache`، `LoginAttemptLimiter`، طابور المهام) إلى تخزين مشترك — انظر O13 في `ARCHITECTURE_INVARIANTS.md`. ومع نواة واحدة لا فائدة منها أصلاً.
- السعة التقديرية كانت 15 إلى 25 عميلاً نشطاً في نفس الوقت بأربعة كاشيرات لكل عميل. **رُفع الـ instance في نفس اليوم إلى 4 OCPU / 24 جيجا** (داخل حد Always Free) وأُضيف Swap 4 جيجا، فصارت السعة التقديرية 40 إلى 80 عميلاً.
- **تصحيح (22 سبتمبر 2026):** حد Always Free لـ Ampere A1 صار **2 OCPU / 12 جيجا** للحساب كله منذ 15 يونيو 2026 (مُطبَّق منذ 18 أغسطس)، وليس 4 / 24 كما كُتب هنا أولاً. الـ 4 / 24 الحالية تعمل على رصيد الفترة التجريبية (Promo) الذي ينتهي نحو 30 سبتمبر 2026، وبعدها قد يوقف أوراكل السيرفر. **صُغِّر فعلاً إلى 2 OCPU / 12 جيجا في نفس اليوم** (تم التحقق: nproc=2، رام 11Gi، Swap 4 جيجا، الباك إند سليم). أي زيادة فوق ذلك تتطلب Pay As You Go ودفع الفرق. السعة التقديرية على 2 / 12 مع الـ Swap: 25 إلى 45 عميلاً نشطاً بأربعة كاشيرات. المصدر: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- الحساب Free Tier (بلا وسيلة دفع): أوراكل قد توقف السيرفر إذا بقي خاملاً 7 أيام. الإيقاف لا يمسح البيانات، والتشغيل يتم من اللوحة.

### 2-d. الدومينات: الموقع التسويقي والـERP والمتاجر (SF-10، من 22 سبتمبر 2026)

| الرابط | بيروح فين |
|---|---|
| `zsystemai.com` | الموقع التسويقي (ريبو `8489mx/zs-web-purble`) على Cloudflare Pages |
| `app.zsystemai.com` | الـERP على سيرفر أوراكل |
| `<slug>.zsystemai.com` | متجر العميل، على نفس السيرفر ونفس قاعدة البيانات |

**الحالة:** المرحلتين اتنفذوا في الإنتاج يوم 22 سبتمبر 2026. الخطوة 8 (قواعد التحويل) اتسابت بقرار المالك لأن مفيش روابط قديمة عند عملاء؛ لو اتوزعت روابط `zsystemai.com/st/...` في أي وقت، ضيفها. و`www` بقى سجل A على السيرفر (مش CNAME) عشان nginx يحوّله للجذر. من غير المتغيرين (ديسكتوب، تطوير) كل حاجة على `/st/<slug>`.
**الترتيب مهم:** المرحلة (أ) كلها قبل (ب)، وإلا روابط المتاجر الحالية هتقف.

**(أ) الـERP والمتاجر على السب دومينات** — الدومين الرئيسي لسه على السيرفر طول المرحلة دي:
1. Cloudflare ← SSL/TLS ← Origin Server ← Create Certificate للاسمين `zsystemai.com` و`*.zsystemai.com`. على السيرفر:
   `sudo mkdir -p /etc/ssl/zsystemai` واحفظ الشهادة في `origin.pem` والمفتاح في `origin.key` (`sudo chmod 600 origin.key`).
2. على السيرفر في `backend/.env`: اتأكد إن `SESSION_COOKIE_DOMAIN` **فاضي أو مش موجود** (لو على الجذر الباك إند هيرفض يشتغل، F38)، وضيف `STOREFRONT_ROOT_DOMAIN=zsystemai.com`.
3. nginx: `sudo cp deploy/nginx/zsystemai-subdomains.conf /etc/nginx/sites-available/zsystemai-subdomains` ثم
   `sudo ln -s /etc/nginx/sites-available/zsystemai-subdomains /etc/nginx/sites-enabled/` ثم `sudo nginx -t && sudo systemctl reload nginx`.
   الملف بيسمع على 80 و443 مع بعض، فبيشتغل مع وضع SSL الحالي في Cloudflare أياً كان.
4. Cloudflare DNS: سجل `A` اسمه `app` وسجل `A` اسمه `*`، الاتنين على IP السيرفر و**Proxied** (البرتقالي).
5. GitHub ← Settings ← Secrets and variables ← Actions ← **Variables**: `VITE_STOREFRONT_ROOT_DOMAIN` = `zsystemai.com`، وبعدها نشر جديد (push أو Run workflow).
6. اتأكد: `https://app.zsystemai.com/login` بيفتح الدخول، و`https://<slug>.zsystemai.com` بيفتح المتجر، ورابط المتجر في إعدادات المتجر بقى بالشكل الجديد، و`https://app.zsystemai.com/st/<slug>` بيحوّل للسب دومين.

**(ب) الموقع التسويقي على الدومين الرئيسي:**
7. Cloudflare ← Workers & Pages ← Create ← Pages ← Connect to Git ← `zs-web-purble`. Build command `npm run build`، Output `dist`.
8. Cloudflare ← Rules ← Redirect Rules: تلات قواعد Wildcard، كل واحدة Status 301 ومع **Preserve query string**:
   `https://zsystemai.com/st/*` ← `https://app.zsystemai.com/st/${1}`، ونفسها لـ`/store/*` و`/shop/*`.
   السيرفر بعدها بيحوّل من `app` لسب دومين المتجر. الـ`#t=` في روابط التتبع بيفضل مع التحويل.
9. Pages ← Custom domains ← `zsystemai.com` (Cloudflare بيستبدل سجل الجذر لوحده). `www` يفضل على السيرفر وnginx بيحوّله للجذر.
10. بعد ما الجذر يبقى على Pages: SSL/TLS ← **Full (strict)**.

**إعدادات اتضافت على السيرفر في نفس اليوم (لازم تتعمل تاني لو السيرفر اتبنى من جديد):**
- `backend/.env`: `APP_LOGIN_URL=https://app.zsystemai.com/login` (رابط الدخول في إيميل التجربة المجانية؛ كان ناقص فالإيميل كان فيه `/login` لوحده) و`APP_PUBLIC_URL=https://app.zsystemai.com` (روابط بوابة الناقلين وتتبع الشحنات؛ كانت بترجع لـ`app.z-systems.io`).
- `/etc/nginx/conf.d/cloudflare-realip.conf`: الـIP الحقيقي للزائر من ترويسة `CF-Connecting-IP` لعناوين Cloudflare بس. طريقة توليده في `deploy/nginx/cloudflare-realip.conf`. من غيره كل حدود المحاولات في الباك إند (الدخول، طلبات المتجر) كانت بتحسب كل الزوار كأنهم عناوين Cloudflare. اتجرّب: طلب من `197.54.10.191` اتسجل بعنوانه الحقيقي.

**بعد (ب):** `zsystemai.com/api/...` مبقاش بيوصل للسيرفر. أي حاجة لسه بتكلم الجذر (جهاز ديسكتوب مربوط بالسحابة، سكربت) لازم تتغير لـ`app.zsystemai.com`. المراقبة الخارجية مش متأثرة لأنها بتكلم IP السيرفر.

---

## 3. أسرار GitHub المطلوبة (GitHub Actions Secrets)

يتم ضبط الأسرار تحت مسار المستودع:  
`GitHub repo -> Settings -> Secrets and variables -> Actions`

| اسم السر | الوصف | القيمة النموذجية |
| :--- | :--- | :--- |
| `ORACLE_SSH_KEY` | مفتاح SSH الخاص للاتصال بالسيرفر | OpenSSH Private Key |
| `ORACLE_HOST` | عنوان IP لسيرفر أوراكل | `92.5.178.54` (اختياري، يملك قيمة افتراضية) |
| `ORACLE_USER` | اسم المستخدم في السيرفر | `ubuntu` (اختياري، يملك قيمة افتراضية) |
| `ORACLE_PORT` | منفذ الـ SSH | `22` (اختياري، يملك قيمة افتراضية) |

---

## 4. متغيرات بيئة الإنتاج السحابية (Production Env Highlights)

بيئة الباك إند (`backend/.env` على سيرفر أوراكل) تتضمن:
```env
NODE_ENV=production
APP_MODE=CLOUD_SAAS
PLATFORM_TENANT_ID=zsystems
APP_LOGIN_URL=https://app.zsystemai.com/login
APP_PUBLIC_URL=https://app.zsystemai.com
STOREFRONT_ROOT_DOMAIN=zsystemai.com
MAIL_DELIVERY_MODE=smtp
PUBLIC_TRIAL_DEBUG_CREDENTIALS=false
ENABLE_BOOTSTRAP_ADMIN=false
ALLOW_BOOTSTRAP_ADMIN_IN_PRODUCTION=false
```

بيئة بناء الفرونت إند:
```env
VITE_API_BASE_URL=            # فاضي: الـAPI على نفس الدومين (app.zsystemai.com/api)
VITE_PLATFORM_TENANT_ID=zsystems
VITE_STOREFRONT_ROOT_DOMAIN=zsystemai.com
```

---

## 5. روابط الفحص المباشر بعد النشر (Health Check Verification)

- **فحص جاهزية الخادم:** `https://app.zsystemai.com/api/health/live`
- **فحص جاهزية قاعدة البيانات:** `https://app.zsystemai.com/api/health/ready`
- **لوحة الدخول:** `https://app.zsystemai.com/login`
- **بوابة السائقين:** `https://app.zsystemai.com/driver`
- **متجر عميل:** `https://<slug>.zsystemai.com`
- **الموقع التسويقي:** `https://zsystemai.com` (Cloudflare Pages)
