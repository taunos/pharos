import { getCloudflareContext } from "@opennextjs/cloudflare";

interface JsonEnv {
  AUDITS: R2Bucket;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params;
  if (!sessionId || !/^[a-zA-Z0-9-]+$/.test(sessionId)) {
    return new Response("Bad session id", { status: 400 });
  }

  const env = getCloudflareContext().env as unknown as JsonEnv;
  const obj = await env.AUDITS.get(`audits/${sessionId}.json`);
  if (!obj) {
    return new Response("Not found", { status: 404 });
  }

  const filename = `pharos-audit-${sessionId.slice(0, 8)}.json`;
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
