// Test C-A (A5): bare /.well-known/mcp serves the same body + headers as
// /.well-known/mcp.json (previously 404).
export { GET } from "../mcp.json/route";
