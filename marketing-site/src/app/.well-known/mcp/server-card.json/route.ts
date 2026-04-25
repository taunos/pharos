import { SERVER_CARD } from "@/lib/mcp-server-card";

export function GET() {
  return new Response(JSON.stringify(SERVER_CARD, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
