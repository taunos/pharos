// F3.2 internal operator tool: re-send welcome email to a specific subscription.
// Useful for support cases ("can you resend my welcome email?") + verification previews.
// Gated by INTERNAL_FULFILL_KEY (same secret as audit-fulfill dispatch).

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sendWelcomeEmail, type WelcomeEmailEnv } from "@/lib/welcome-email";

interface PreviewEnv extends WelcomeEmailEnv {
  INTERNAL_FULFILL_KEY: string;
}

export async function POST(request: Request) {
  const env = getCloudflareContext().env as unknown as PreviewEnv;
  const auth = request.headers.get("x-internal-fulfill-key");
  if (!auth || auth !== env.INTERNAL_FULFILL_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { subscription_id?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
  }

  const subscriptionId = body.subscription_id ?? "";
  const email = body.email ?? "";
  if (!subscriptionId || !email) {
    return NextResponse.json(
      { ok: false, code: "MISSING_FIELDS", message: "subscription_id + email required" },
      { status: 400 },
    );
  }

  await sendWelcomeEmail(env, subscriptionId, email);
  console.log(
    `F3_PREVIEW_WELCOME_SENT subscription_id=${subscriptionId.substring(0, 12)} email=${email}`,
  );
  return NextResponse.json({ ok: true });
}
