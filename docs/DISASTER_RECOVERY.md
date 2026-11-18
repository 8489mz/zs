# دليل الاسترجاع والنقل لسيرفر جديد (Disaster Recovery)

> **السيرفر واقع على نفس المكان وتريد الاسترجاع فيه؟** استخدم [دليل الطوارئ: السيرفر واقع — ماذا تفعل خطوة بخطوة](FIRE_DRILL_PLAYBOOK.md) أولاً. هذه الصفحة لنقل كامل إلى سيرفر جديد فقط.

> **آخر تجربة استرجاع فعلية:** 22 سبتمبر 2026 على نسخة `zsystems_db_20260922_094344.sql.gz`
> (انظر §6). الوقت المتوقع للنقل الكامل: **ساعة تقريباً**.
>
> استخدم هذا الدليل إذا: السيرفر باظ أو اتمسح، أو أوراكل قفلت الحساب، أو قررت تنقل لمزود آخر.

---

## 0. محتاج إيه قبل ما تبدأ

| الحاجة | مكانها | من غيرها |
|---|---|---|
| آخر نسخة من قاعدة البيانات `zsystems_db_*.sql.gz` | Google Drive فولدر `zsystems-backups` · أو Oracle Bucket `zsystems-backups` · أو `/var/backups/zsystems` على السيرفر القديم | **مفيش استرجاع** |
| ملف الإعدادات السري `backend/.env` | نسختك على الفلاشة / Password Manager (`zsystems-production.env`) | الجلسات تتقفل، وبوابات الدفع والإيميل تقف لحد ما تجمع المفاتيح تاني |
| مفتاح SSH للسيرفر الجديد | بيتعمل مع السيرفر الجديد | — |
| صلاحية على GitHub `8489mx/zs` | حسابك | — |

**لو أوراكل قفلت الحساب:** الـ Bucket راح معاه. خد النسخة من **Google Drive**.

**شكل الملف (من 22 سبتمبر 2026):** `zsystems_backup_<التاريخ>.zip.enc`. ده ملف واحد فيه نسخة السيرفر كله، وحزمة جاهزة لكل منشأة. بيتفتح بكلمة سر الباك أب (`/etc/zsystems/backup-passphrase`)، ولازم تكون محفوظة عندك برة السيرفر: **من غيرها مفيش ولا نسخة هتتفتح.** لو أداة المشروع مش متاحة، تقدر تفتحه بـ openssl:
`openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -in FILE.zip.enc -out FILE.zip -pass file:passphrase.txt`

النسخ الأقدم من 22 سبتمبر 2026 عبارة عن `zsystems_db_*.sql.gz`، وده `pg_dump` عادي.

---

## 1. تجهيز السيرفر الجديد

Ubuntu 24.04. أي معالج (ARM أو x86)، والحد الأدنى 2 نواة و4 جيجا رام. حد أوراكل المجاني لـ Ampere A1 صار 2 نواة و12 جيجا للحساب كله (منذ يونيو 2026).

```bash
# Swap 4 جيجا (مهم على أي سيرفر رامه أقل من 8 جيجا)
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-zsystems.conf && sudo sysctl -p /etc/sysctl.d/99-zsystems.conf

# البرامج
sudo apt-get update && sudo apt-get install -y docker.io nginx certbot python3-certbot-nginx git rclone
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
sudo npm install -g pm2
```

افتح المنافذ 80 و443 في جدار حماية المزود (في أوراكل اسمه Security List).

---

## 2. قاعدة البيانات

```bash
# كلمة السر = قيمة DATABASE_PASSWORD من ملف .env بتاعك
sudo docker run -d --name zsystems-postgres --restart always \
  -e POSTGRES_DB=zsystems_db -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD='ضع_كلمة_السر_هنا' \
  -p 127.0.0.1:5432:5432 -v pgdata:/var/lib/postgresql/data postgres:16-alpine

sleep 10
# ارفع ملف النسخة للسيرفر الجديد الأول (scp من جهازك)، وبعدين:
gunzip -c zsystems_db_XXXXXXXX_XXXXXX.sql.gz | sudo docker exec -i zsystems-postgres psql -U postgres -d zsystems_db 2>&1 | grep ERROR
```

**لو النسخة ملف مجمّع (`zsystems_backup_*.zip.enc`):** ده بيتعمل بعد الخطوة 3، لأن الأداة جزء من التطبيق. وقبلها لازم تحط كلمة السر في `/etc/zsystems/backup-passphrase`:
```bash
bash /var/www/zsystems/app/deploy/scripts/zsystems-restore.sh full zsystems_backup_XXXXXXXX_XXXXXX.zip.enc
```
السكربت بيرفض يشتغل لو قاعدة البيانات مش فاضية. ولو عايز ترجّع **منشأة واحدة بس** على سيرفر شغال:
```bash
bash /var/www/zsystems/app/deploy/scripts/zsystems-restore.sh tenant zsystems_backup_XXXXXXXX_XXXXXX.zip.enc <slug>
```
ده بياخد نسخة أمان من القاعدة كلها الأول، ومش بيلمس أي منشأة تانية.

**النتيجة المتوقعة:** **مفيش ولا خطأ.** لو ظهر أي سطر فيه `ERROR`، وقّف وراجع قبل ما تكمل.

**سكربت إصلاح O65 شُغِّل على الإنتاج في 23 سبتمبر 2026 الساعة 21:34 UTC** (رمّم 24 سطراً: صفر يتيم، صفر عابر للمنشآت، كل القيود متوازنة). فأي نسخة **بعد** `zsystems_hourly_20260923_213600` نظيفة، وتمرين الاسترجاع عليها يعطي 430 من 430.

استثناء واحد: لو النسخة **أقدم** من ذلك التوقيت (`deploy/scripts/repair-o65-almhnds-journal-accounts.sql`)، هيظهر خطأ واحد بس، وهو ده:
`insert or update on table "journal_entry_lines" violates foreign key constraint "journal_entry_lines_account_id_fkey"`
البيانات برضه بترجع كلها. شغّل سكربت الإصلاح على السيرفر الجديد، وبعدها اعمل القيد بالأمر ده:
`sudo docker exec zsystems-postgres psql -U postgres -d zsystems_db -c "alter table journal_entry_lines add constraint journal_entry_lines_account_id_fkey foreign key (account_id) references accounting_accounts(id) on delete restrict"`

---

## 3. التطبيق

```bash
sudo mkdir -p /var/www/zsystems && sudo chown ubuntu:ubuntu /var/www/zsystems
git clone https://github.com/8489mx/zs.git /var/www/zsystems/app
# انسخ ملف .env بتاعك من جهازك:  scp -i KEY zsystems-production.env ubuntu@NEW_IP:/var/www/zsystems/app/backend/.env

cd /var/www/zsystems/app/backend
npm ci && npm run build && npm run migration:run
pm2 start dist/main.js --name zsystems-backend --cwd /var/www/zsystems/app/backend --node-args="--env-file=/var/www/zsystems/app/backend/.env"
pm2 save && pm2 startup   # نفّذ السطر اللي pm2 startup بيطبعه

cd /var/www/zsystems/app/frontend
printf 'VITE_API_BASE_URL=\nVITE_CSRF_COOKIE_NAME=zs_cloud_csrf_token\nVITE_PLATFORM_TENANT_ID=zsystems-main\n' > .env.production
npm ci && npm run build
```

البناء هنا على السيرفر **مرة واحدة بس** للتشغيل الأول. بعد كده كل نشر بيتبني على GitHub (§5).

لو ملف `.env` ضاع: ابدأ من `backend/.env.example`، وخلي `DATABASE_PASSWORD` نفس كلمة سر الخطوة 2. واعمل سر جلسات جديد (`SESSION_*`)، وده هيطلب من كل المستخدمين يسجلوا دخول من جديد. ومفاتيح بوابات الدفع والإيميل والتليجرام هتحتاج تجيبها تاني من كل مزود.

---

## 4. nginx والشهادة والدومين

```bash
sudo cp /var/www/zsystems/app/deploy/nginx/oracle-site.conf /etc/nginx/sites-available/default
sudo sed -i 's/YOUR_DOMAIN/الدومين_بتاعك/' /etc/nginx/sites-available/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d الدومين_بتاعك
```

**مهم عن الدومين:** السيستم دلوقتي شغال على `92-5-178-54.sslip.io`، وده عنوان مبني على IP السيرفر. **سيرفر جديد يعني IP جديد، يعني عنوان جديد.** كل أجهزة الكاشير وروابط المتاجر عند العملاء هتحتاج تتغير. مع دومين حقيقي، كفاية تغير الـ DNS بس.

---

## 5. توصيل النشر التلقائي

في GitHub: `Settings → Secrets and variables → Actions`، وغيّر:
- `ORACLE_HOST` = IP السيرفر الجديد
- `ORACLE_SSH_KEY` = المفتاح الخاص للسيرفر الجديد

وبعدين `Actions → Deploy to Oracle SaaS Server → Run workflow`. المفروض النشر يعدّي وفحص الصحة ينجح.

---

## 6. النسخ الاحتياطي على السيرفر الجديد

```bash
sudo mkdir -p /var/backups/zsystems && sudo chown ubuntu:ubuntu /var/backups/zsystems
sed 's/\r$//' /var/www/zsystems/app/deploy/scripts/zsystems-backup.sh > /tmp/zb.sh && install -m 755 /tmp/zb.sh /var/www/zsystems/backup.sh
sed 's/$//' /var/www/zsystems/app/deploy/scripts/zsystems-restore-drill.sh > /tmp/zd.sh && install -m 755 /tmp/zd.sh /var/www/zsystems/restore-drill.sh

# ثلاثة أسطر: النسخة الكاملة يومياً، نسخة خفيفة كل ساعة، وتمرين استرجاع كل أحد
(crontab -l 2>/dev/null;  echo "0 3 * * * /var/www/zsystems/backup.sh >> /var/backups/zsystems/backup.log 2>&1";  echo "30 * * * * /var/www/zsystems/backup.sh hourly >> /var/backups/zsystems/backup.log 2>&1";  echo "15 4 * * 0 /var/www/zsystems/restore-drill.sh >> /var/backups/zsystems/restore-drill.log 2>&1") | crontab -
```

- **Google Drive:** `rclone config` بنفس الخطوات (remote اسمه `gdrive` وصلاحية `drive.file`)، عبر نفق `ssh -L 53682:127.0.0.1:53682`.
- **Oracle Bucket (لو لسه على أوراكل):** اعمل رابط Pre-Authenticated Request (كتابة بس)، وحطه في `/etc/zsystems/backup-par-url`، وخلي صاحب الملف `ubuntu` وصلاحياته `600`.
- جرّب: `/var/www/zsystems/backup.sh` ثم `/var/www/zsystems/backup.sh hourly` ثم `/var/www/zsystems/restore-drill.sh`.
- **النسخة الساعية** (`zsystems_hourly_*.sql.gz.enc`): `pg_dump` مشفَّر بلا حزم العملاء — محلياً 3 أيام، وGoogle Drive 7 أيام. **مش بتروح Oracle عمداً**: رابط الـPAR كتابة بس ومش بيحذف، فـ24 ملف في اليوم هيملوا الحاوية. الحماية الجغرافية الكاملة على النسخة اليومية.
- **تمرين الاسترجاع الأسبوعي** يسترجع أحدث نسخة في قاعدة منفصلة اسمها `zsystems_restore_drill` جوه نفس الحاوية، يقارنها بالإنتاج (جداول، صفوف، هجرات، مفاتيح مرجعية)، يحذفها، ويبعت تليجرام لو فشل. **قاعدة الإنتاج ما بتتلمسش** — كل استعلاماته عليها قراءة.

---

## 7. التحقق بعد الاسترجاع

```bash
curl -s http://127.0.0.1:3000/api/health/ready     # لازم "status":"ok" و "database":"up"
pm2 ls                                              # zsystems-backend = online
```

- ادخل بحساب المنصة، وبحساب عميل، واتأكد إن آخر فواتير يوم النسخة موجودة.
- **اللي بيضيع (RPO):** أي عمليات حصلت بعد وقت آخر نسخة.
  - بالنسخة اليومية وحدها: **لحد 24 ساعة**.
  - بالنسخة الساعية مفعّلة (DEPLOY-7): **لحد ساعة واحدة** — والنسخة الساعية موجودة محلياً وعلى Google Drive، فحتى لو السيرفر نفسه راح، أقصى ما يضيع ساعة.
  - **لسه مش لحظي:** استرجاع نقطة-في-الزمن الحقيقي (WAL / PITR) محتاج تغيير إعداد Postgres جوه الحاوية وأرشيف WAL، وده قرار مستقل — شوف O73.

---

## 8. تشغيل محل على نسخة الديسكتوب وقت الأزمة، ورجوعه للسحابة

**انقطاع قصير (ساعات):** مش محتاج ده. الكاشير فيه "البيع بدون إنترنت"، والفواتير بتتزامن لوحدها لما النت يرجع.

**انقطاع طويل، أو السيرفر واقع:**
1. **هات حزمة المحل:**
   - لو السحابة شغالة: من شاشة الإعدادات ← النسخ الاحتياطي ← "نقل البيانات بين السحابة ونسخة الديسكتوب" ← **تنزيل حزمة البيانات**.
   - لو السيرفر واقع: خد آخر `zsystems_backup_*.zip.enc` من Google Drive. ده ليك إنت بس، لأنه فيه كل العملاء.
2. **لو السحابة لسه شغالة لحد تاني:** أوقف المنشأة من لوحة المنصة، عشان محدش يشتغل على السحابة والديسكتوب في نفس الوقت.
3. **على جهاز المحل في برنامج الديسكتوب** (نفس الإصدار أو أحدث): نفس الشاشة ← **اختيار ملف للاستيراد**. لو اخترت الملف المجمّع، هيطلب كلمة سر الباك أب ويخليك تختار المنشأة. بعدها اكتب `IMPORT TENANT` للتأكيد.
4. المستخدمين بيدخلوا بنفس أسمائهم وكلمات سرهم اللي على السحابة.

**الرجوع للسحابة:**
1. على الديسكتوب: **تنزيل حزمة البيانات**.
2. على السحابة: المنشأة تستورد الحزمة من نفس الشاشة، أو إنت من السيرفر:
   `bash /var/www/zsystems/app/deploy/scripts/zsystems-restore.sh tenant-file ZERP-tenant-<slug>-<date>.zsbak <tenant-id>`
3. شغّل المنشأة تاني من لوحة المنصة.

الحزمة بترفض أي منشأة غير المنشأة اللي طلعت منها. والسجلات اللي اتعملت أوفلاين بترجع بأرقامها، من غير أي تصادم (TRANSFER-2).

---

## سجل تجارب الاسترجاع

| التاريخ | النسخة | النتيجة |
|---|---|---|
| 22 سبتمبر 2026 | `zsystems_db_20260922_094344.sql.gz` (616 كيلو) | ✅ اتسترجعت في Postgres 16 منفصل في **9 ثواني**. **240 جدول و5670 صف، مطابقين للإنتاج جدول بجدول بالعدد الدقيق.** 805 فهرس و13 trigger مطابقين. 230 هجرة، وآخرها `137_products_catalog_updated_at`. **خطأ واحد:** قيد `journal_entry_lines_account_id_fkey` ما اتعملش بسبب 14 سطر يتيم في الإنتاج (O65)، فبقوا 426 قيد مرجعي بدل 427. **ما اتجربش:** تشغيل الباك إند نفسه على البيانات المسترجعة، لأن ده ممكن يبعت رسايل حقيقية (تليجرام/واتساب/إيميل) من بيانات الإنتاج. |
| 22 سبتمبر 2026 (بعد إصلاح O65) | نفس النسخة، بعد تطبيق سكربت الإصلاح عليها محلياً، ثم `pg_dump` واسترجاعها من جديد | ✅ **صفر أخطاء، و427 من 427 قيد مرجعي.** `migration:run` على البيانات المسترجعة: مفيش هجرات ناقصة. **الباك إند اشتغل فعلاً** على البيانات المسترجعة (بعد ما قفلت تليجرام والإيميل والـ webhooks)، و`/api/health/ready` رد بـ `ok`، وكتالوج متجر `almhnds` الحقيقي ظهر من البيانات المسترجعة. |
| 22 سبتمبر 2026 (الملف المجمّع) | ملف مجمّع مشفّر اتعمل من نفس البيانات (5 منشآت، 927 كيلو، في 3 ثواني) | ✅ openssl فك التشفير، والنسخة الكاملة طلعت منه مطابقة بايت ببايت. بعدها `almhnds` اتنقلت لديسكتوب جديد (1162 سجل، 0 فروق)، واتعمل عليها شغل أوفلاين، ورجعت للسحابة من غير أي فروق، والمنشآت التانية مااتلمستش. الملف التالف وكلمة السر الغلط والمنشأة الغلط اترفضوا كلهم من غير أي تغيير. |

| 23 سبتمبر 2026 | — (تغيير في السكربتات) | ⚙️ **أُتمتت التجربة:** `zsystems-restore-drill.sh` بيعمل نفس الفحوص كل أحد الساعة 4:15 ويبعت تليجرام لو فشل. الحارس `deploy-pipeline.spec.ts` (DEPLOY-8) بيمنع أي نسخة من السكربت تكتب على قاعدة الإنتاج، وجُرّب بكسر متعمَّد. **التجربة اليدوية الكاملة لسه مطلوبة كل 3 شهور** (التمرين الآلي بيتحقق من الاسترجاع، مش من تشغيل الباك إند على البيانات المسترجعة).

| 23 سبتمبر 2026 (أول تشغيل آلي) | `zsystems_hourly_20260923_212652.sql.gz.enc` | ❌ **فشل — وكشف شيئاً حقيقياً.** 244 جدول و236 هجرة مطابقة، والبيانات كلها رجعت، لكن **429 قيد مرجعي بدل 430**: `journal_entry_lines_account_id_fkey` سقط بسبب 14 سطراً يتيماً. التشخيص: إصلاح O65 **في الكود** نزل في 22 سبتمبر، لكن **سكربت ترميم البيانات لم يُشغَّل على الإنتاج قط** — تجربة 22 سبتمبر التي أعطت «427 من 427» كانت على نسخة مُصلَحة **محلياً**. أي أن كل نسخة احتياطية من 22 سبتمبر حتى الآن كانت تسترجع بقيد رقابي ناقص، ولم يكن أحد يعلم. `convalidated = t` في الإنتاج بينما البيانات مخالفة — وهو ممكن فقط لأن الصفوف أُدخلت وفحص المفاتيح معطَّل (`session_replication_role = 'replica'`)، أي من الاسترجاع القديم لشاشة الإعدادات. |
| 23 سبتمبر 2026، 21:34 UTC | — (ترميم) | ✅ `repair-o65-almhnds-journal-accounts.sql` شُغِّل على الإنتاج: **24 سطراً رُمِّمت**، صفر يتيم، صفر عابر للمنشآت، كل القيود متوازنة. في معاملة واحدة بشروط قبلية وبعدية. |
| 23 سبتمبر 2026، 21:37 UTC | `zsystems_hourly_20260923_213600.sql.gz.enc` | ✅ **`RESTORE DRILL OK`.** 244 جدول · 237 هجرة · **430 من 430 قيداً مرجعياً** · صفر أخطاء · الاسترجاع في **6 ثوانٍ**. أول نسخة في تاريخ المشروع يُثبَت آلياً أنها تسترجع كاملة وسليمة. |

كرر التجربة اليدوية **كل 3 شهور**، أو بعد أي تغيير في سكربت النسخ، وسجّلها هنا.
