import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isWithheld, readReviewHold } from "@/lib/audit-review-hold";

interface PdfEnv {
  AUDITS: R2Bucket;
  CITATION_DB: D1Database;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params;
  if (!sessionId || !/^[a-zA-Z0-9-]+$/.test(sessionId)) {
    return new Response("Bad session id", { status: 400 });
  }

  const env = getCloudflareContext().env as unknown as PdfEnv;
  // Review hold gate (lib/audit-review-hold.ts): a held, unreleased report is
  // not served. Fail-closed on a D1 error.
  try {
    if (isWithheld(await readReviewHold(env.CITATION_DB, sessionId))) {
      return new Response("Not found", { status: 404 });
    }
  } catch {
    console.error(`AUDIT_REVIEW_HOLD_READ_FAILED route=pdf session_id=${sessionId}`);
    return new Response("Temporarily unavailable", { status: 503 });
  }
  const obj = await env.AUDITS.get(`audits/${sessionId}.pdf`);
  if (!obj) {
    return new Response("Not found", { status: 404 });
  }

  const filename = `astrant-audit-${sessionId.slice(0, 8)}.pdf`;
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
