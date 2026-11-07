// =====================================================================
// LOCAL-ONLY. NEVER DEPLOY. Unauthenticated Workers AI proxy for the report
// panel harness: POST {model, inputs} -> env.AI.run(model, inputs).
// Every request whose Host is not localhost / 127.0.0.1 / [::1] is rejected,
// so an accidental deploy cannot be used to spend Workers AI.
// =====================================================================
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocalRequest(req) {
  const host = (req.headers.get("host") || "").toLowerCase().replace(/:\d+$/, "");
  const urlHost = new URL(req.url).hostname.toLowerCase();
  return LOCAL_HOSTS.has(host) && LOCAL_HOSTS.has(urlHost);
}

export default {
  async fetch(req, env) {
    if (!isLocalRequest(req)) return new Response("Forbidden: local-only proxy", { status: 403 });
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const { model, inputs } = await req.json();
    try {
      const result = await env.AI.run(model, inputs);
      return Response.json({ ok: true, result });
    } catch (e) {
      return Response.json({ ok: false, error: String((e && e.message) || e) }, { status: 502 });
    }
  },
};
