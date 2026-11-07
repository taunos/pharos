// Starts the LOCAL-ONLY Workers AI proxy (ai-proxy/) with `wrangler dev` on
// 127.0.0.1:8799, using your wrangler login. Leave it running in its own
// terminal; Ctrl+C stops it. This never deploys anything.
//
//   node tools/report-panel/start-proxy.mjs [--port 8799]
//
// wrangler is taken from scanner/node_modules of this checkout, or of the main
// checkout when this is a worktree without node_modules.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const i = process.argv.indexOf("--port");
const PORT = i >= 0 ? process.argv[i + 1] : "8799";

let main = null;
try {
  main = path.dirname(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim());
} catch {}
const bin = [REPO, main].filter(Boolean)
  .map((b) => path.join(b, "scanner", "node_modules", "wrangler", "bin", "wrangler.js"))
  .find((p) => fs.existsSync(p));
if (!bin) throw new Error("wrangler not found under scanner/node_modules (run npm install in scanner/ of the main checkout)");

const child = spawn(process.execPath, [bin, "dev", "--ip", "127.0.0.1", "--port", PORT], {
  cwd: path.join(HERE, "ai-proxy"), stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
