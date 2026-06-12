// F-MCP-HF: human-friendly fallback page for browser GETs on /mcp.
// SYNC: tool names below mirror SERVICE_CATALOG / server.tool() registrations
// (get_capabilities, get_pricing, get_case_studies, book_audit, check_llms_txt,
// score_url). Update this page on tool add/remove.

export const HUMAN_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Astrant MCP Server</title>
<style>
  body { background: #0f0f10; color: #e4e4e7; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; margin: 0; padding: 48px 24px; line-height: 1.6; }
  main { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 8px; }
  .dim { color: #71717a; }
  code, pre { font-family: ui-monospace, "JetBrains Mono", Consolas, monospace; font-size: 0.875rem; }
  code { background: #18181b; padding: 2px 6px; border: 1px solid #1c1c1f; }
  pre { background: #18181b; border: 1px solid #1c1c1f; padding: 16px; overflow-x: auto; }
  a { color: #e4e4e7; }
  ul { padding-left: 20px; }
  .rule { border: 0; border-top: 1px solid #1c1c1f; margin: 32px 0; }
</style>
</head>
<body>
<main>
  <h1>Astrant MCP Server</h1>
  <p class="dim">This URL is a Model Context Protocol endpoint — it speaks JSON-RPC to AI agents, not HTML to browsers. You've reached it from a browser, so here's the human view.</p>
  <hr class="rule">
  <p><strong>What's here:</strong> 6 tools an agent can call against this server:</p>
  <ul>
    <li><code>get_capabilities</code></li>
    <li><code>get_pricing</code></li>
    <li><code>get_case_studies</code></li>
    <li><code>book_audit</code></li>
    <li><code>check_llms_txt</code> — works against any site, not just ours</li>
    <li><code>score_url</code> — works against any site, not just ours</li>
  </ul>
  <p><strong>Inspect it yourself:</strong></p>
  <ul>
    <li>Server card (machine-readable metadata): <a href="https://mcp.astrant.io/.well-known/mcp.json">mcp.astrant.io/.well-known/mcp.json</a></li>
    <li>llms.txt: <a href="https://astrant.io/llms.txt">astrant.io/llms.txt</a></li>
  </ul>
  <p>Call it from a terminal:</p>
  <pre>curl -X POST https://mcp.astrant.io/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'</pre>
  <p><strong>Connect an agent:</strong> point any MCP-capable client (Claude, ChatGPT, or your own) at <code>https://mcp.astrant.io/mcp</code> with Streamable HTTP transport.</p>
  <hr class="rule">
  <p class="dim">Astrant is an Agent Discoverability service — this server is our own first reference implementation. <a href="https://astrant.io">Back to astrant.io</a></p>
</main>
</body>
</html>`;
