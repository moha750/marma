// Resend API wrapper — يُستخدم من كل edge function.
// المفتاح يُقرأ من Supabase Edge Functions secrets (RESEND_API_KEY).

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function sendEmail({ to, subject, html, from }: SendEmailParams): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    throw new Error("RESEND_API_KEY غير مضبوط في Edge Functions secrets");
  }

  const sender = from ?? Deno.env.get("EMAIL_FROM") ?? "مَرمى <onboarding@resend.dev>";

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: sender, to, subject, html }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`فشل إرسال البريد عبر Resend (${response.status}): ${text}`);
  }
}
