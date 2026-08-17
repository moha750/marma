#!/bin/sh
# psql مباشرةً على قاعدة الإنتاج. هذا هو الطريق الوحيد — لا نسخ ولصق في لوحة
# Supabase، ولا ملفات SQL مؤقّتة تُمرَّر باليد. الاعتماد الوحيد: .env
# (غير متتبَّع في git، وصلاحيّاته 600).
#
#   sh scripts/db.sh                                  # جلسة تفاعلية
#   sh scripts/db.sh -c "select 1;"                   # استعلام واحد
#   sh scripts/db.sh -f supabase/migrations/x.sql     # تنفيذ ملف هجرة
#   npm run db -- -c "select 1;"                      # نفس الشيء عبر npm
#
# لماذا ملف مستقل لا سطر داخل package.json: تمرير الوسائط عبر
# `npm run db -- "..."` يجرّد علامات الاقتباس، فتصل جملة SQL إلى psql مقطّعة
# كلمةً كلمة. هنا "$@" يحفظها كما هي.
#
# لماذا متغيّرات منفصلة لا سلسلة اتصال واحدة:
#   (١) كلمة المرور تُمرَّر عبر بيئة العملية لا عبر وسائطها، فلا تظهر في `ps`
#       لبقيّة مستخدمي الجهاز — سلسلة الاتصال كوسيط تظهر.
#   (٢) لا حاجة لترميز URL: الرموز @ # % / : تُكتب حرفيّاً كما هي في .env.
#   (٣) .env تُقرأ حرفيّاً بلا `source`، فلا يفسّر الـ shell رموز $ و ` فيها.
set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "لا يوجد .env — نفّذ: cp .env.example .env ثم املأ القيم" >&2
  exit 1
fi

# قراءة قيمة حرفيّة من .env: أوّل سطر يبدأ بـ "المفتاح=" فقط، بلا تنفيذ shell.
read_env() {
  v=$(awk -v k="$1" 'index($0, k "=") == 1 { sub(/^[^=]*=/, ""); print; exit }' .env)
  case "$v" in
    \"*\") v=${v#\"}; v=${v%\"} ;;
    \'*\') v=${v#\'}; v=${v%\'} ;;
  esac
  printf '%s' "$v"
}

PGHOST=$(read_env SUPABASE_DB_HOST)
PGUSER=$(read_env SUPABASE_DB_USER)
PGPASSWORD=$(read_env SUPABASE_DB_PASSWORD)
PGPORT=$(read_env SUPABASE_DB_PORT)
PGDATABASE=$(read_env SUPABASE_DB_NAME)

for k in HOST USER PASSWORD; do
  eval "val=\$PG$k"
  [ -n "$val" ] && continue
  echo "SUPABASE_DB_$k غير معرّف في .env — راجع .env.example" >&2
  exit 1
done

: "${PGPORT:=5432}"
: "${PGDATABASE:=postgres}"
PGSSLMODE=require              # Supabase يرفض الاتصال بلا TLS — نثبّته صراحةً
PGAPPNAME=goal-db-cli          # ليظهر مصدر الجلسة في pg_stat_activity

export PGHOST PGUSER PGPASSWORD PGPORT PGDATABASE PGSSLMODE PGAPPNAME
exec psql "$@"
