// نواة إرسال الإشعارات إلى أجهزة الملعب — ثلاث قنوات، حمولة واحدة.
// ----------------------------------------------------------------------------
// استُخرجت من send-booking-push كي تخدمها و send-owner-push معاً. المنطق لم
// يتغيّر حرفاً: الويب بـ Web Push، وأبل بـ APNs مباشرةً، وأندرويد بـ FCM،
// والحمولة المنطقية واحدة (عنوان + نص + وجهة نقر + وسم) فلا يتفرّق نصّ الإشعار
// بين المنصّات — تفرُّقه هو ما يجعل صياغةً تُصلَح في مكان وتبقى خاطئة في مكانين.
//
// ولماذا وحدةٌ مشتركة لا نسختان؟ لأن هنا تعيش معالجة الجهاز الميّت (٤٠٤/٤١٠
// ⇒ حذف) وعدّاد الفشل. نسختان تعنيان عيباً يُصلَح في واحدة ويبقى في الأخرى —
// وهو بالضبط ما قيل في _shared/apns.ts حين استُخرج توقيع ES256.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { apnsConfigured, apnsSendAlert, apnsToken } from "./apns.ts";
import { fcmConfigured, fcmSession } from "./fcm.ts";

// معرّف التطبيق في المتجرين — هو موضوع إشعار APNs (لا معرّف بطاقة المحفظة)
const APP_BUNDLE_ID = Deno.env.get("APP_BUNDLE_ID") ?? "help.marma.app";

export interface PushPayload {
  title: string;
  body: string;
  /** وجهة النقر داخل التطبيق، مثل /loyalty/stamps */
  url: string;
  /** وسمٌ موحّد للحدث: إشعارٌ لاحق بنفس الوسم يستبدل سابقه بدل أن يتكدّس */
  tag: string;
}

export interface PushResult {
  sent: number;
  failed: number;
  total: number;
  byPlatform: Record<string, number>;
  reason?: string;
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh_key: string | null;
  auth_key: string | null;
  /** web = Web Push · ios = رمز APNs · android = رمز FCM */
  platform: "web" | "ios" | "android";
}

/** يُضبط مرّة لكل استدعاء دالّة — المفاتيح من الأسرار، وغيابها خطأ تشغيلي */
export function initWebPush(): void {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  if (!pub || !priv || !subject) throw new Error("VAPID_* env vars missing");
  webpush.setVapidDetails(subject, pub, priv);
}

async function getFailedCount(db: SupabaseClient, id: string): Promise<number> {
  const { data } = await db
    .from("push_subscriptions").select("failed_count").eq("id", id).single();
  return (data as { failed_count?: number } | null)?.failed_count ?? 0;
}

/** يُرسل الحمولة إلى كل أجهزة الملعب المسجّلة، ويُنظّف الميّت منها */
export async function pushToTenant(
  db: SupabaseClient,
  tenantId: string,
  payload: PushPayload,
): Promise<PushResult> {
  const empty: PushResult = { sent: 0, failed: 0, total: 0, byPlatform: {} };

  const { data, error } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh_key, auth_key, platform")
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`فشل قراءة الاشتراكات: ${error.message}`);

  const subscriptions = (data ?? []) as PushSubscriptionRow[];
  if (!subscriptions.length) return { ...empty, reason: "no subscriptions" };

  // نُجهّز توكنَي القناتين مرّةً واحدة لكل دفعة، وفقط إن وُجد لهما مشترك فعلاً:
  // لا معنى لرحلة شبكةٍ إلى أبل وقوقل لملعبٍ كل أجهزته على الويب.
  const hasIos = subscriptions.some((s) => s.platform === "ios");
  const hasAndroid = subscriptions.some((s) => s.platform === "android");

  let jwt: string | null = null;
  if (hasIos) {
    if (apnsConfigured()) {
      try { jwt = await apnsToken(); } catch (err) {
        console.error("[push] فشل توكن APNs:", err);
      }
    } else {
      console.warn("[push] أجهزة أبل مسجّلة لكن أسرار APNs غير مضبوطة");
    }
  }

  const fcm = hasAndroid
    ? (fcmConfigured()
      ? await fcmSession()
      : (console.warn("[push] أجهزة أندرويد مسجّلة لكن FCM_SERVICE_ACCOUNT غير مضبوط"), null))
    : null;

  // نتيجة موحّدة لكل قناة: نجاح، أو جهاز ميّت يُحذف، أو فشل يُعَدّ
  const markOk = (id: string) =>
    db.from("push_subscriptions")
      .update({ last_used_at: new Date().toISOString(), failed_count: 0 }).eq("id", id);
  const markGone = (id: string) =>
    db.from("push_subscriptions").delete().eq("id", id);
  const markFailed = async (id: string) =>
    db.from("push_subscriptions")
      .update({ failed_count: (await getFailedCount(db, id)) + 1 }).eq("id", id);

  const webBody = JSON.stringify(payload);

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      // ── أبل ──
      if (sub.platform === "ios") {
        if (!jwt) return { id: sub.id, ok: false, skipped: true };
        const r = await apnsSendAlert(jwt, sub.endpoint, APP_BUNDLE_ID, {
          title: payload.title, body: payload.body,
          threadId: payload.tag, url: payload.url,
        });
        if (r.status === 200) { await markOk(sub.id); return { id: sub.id, ok: true }; }
        if (r.gone) { await markGone(sub.id); return { id: sub.id, ok: false, deleted: true }; }
        await markFailed(sub.id);
        return { id: sub.id, ok: false, error: `apns ${r.status} ${r.error ?? ""}` };
      }

      // ── أندرويد ──
      if (sub.platform === "android") {
        if (!fcm) return { id: sub.id, ok: false, skipped: true };
        const r = await fcm.send(sub.endpoint, {
          title: payload.title, body: payload.body,
          tag: payload.tag, url: payload.url,
        });
        if (r.status >= 200 && r.status < 300) { await markOk(sub.id); return { id: sub.id, ok: true }; }
        if (r.gone) { await markGone(sub.id); return { id: sub.id, ok: false, deleted: true }; }
        await markFailed(sub.id);
        return { id: sub.id, ok: false, error: `fcm ${r.status} ${r.error ?? ""}` };
      }

      // ── الويب ──
      // صفّ ويبٍ بلا مفاتيح لا يمكن إرساله؛ يمنعه قيد قاعدة البيانات، والفحص
      // هنا يحمي من صفٍّ قديم سابقٍ للقيد.
      if (!sub.p256dh_key || !sub.auth_key) {
        await markGone(sub.id);
        return { id: sub.id, ok: false, deleted: true };
      }
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh_key, auth: sub.auth_key } },
          webBody,
          { TTL: 60 * 60 },
        );
        await markOk(sub.id);
        return { id: sub.id, ok: true };
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await markGone(sub.id);
          return { id: sub.id, ok: false, deleted: true };
        }
        await markFailed(sub.id);
        return { id: sub.id, ok: false, error: String(err) };
      }
    }),
  );

  const ok = (r: PromiseSettledResult<unknown>) =>
    r.status === "fulfilled" && (r.value as { ok: boolean }).ok;
  const sent = results.filter(ok).length;

  // تفصيل بالمنصّة: عند شكوى «لا تصلني إشعارات» هذا السجلّ يقول أي قناةٍ صمتت
  const byPlatform: Record<string, number> = { web: 0, ios: 0, android: 0 };
  results.forEach((r, i) => { if (ok(r)) byPlatform[subscriptions[i].platform]++; });

  return { sent, failed: subscriptions.length - sent, total: subscriptions.length, byPlatform };
}
