// One-shot Zoho OAuth setup for the outreach Worker (runbook step 3).
// Asks for the Self Client's Client ID, Client Secret and a fresh grant code
// (input hidden), exchanges the code, proves the refresh token works, then
// stores all three as Worker secrets via `wrangler secret put` (value on stdin).
// Nothing is printed or written to disk. Run from outreach/:
//   node scripts/zoho-setup.mjs
import { spawnSync } from "node:child_process";
import readline from "node:readline";

const ACCOUNTS = process.env.ZOHO_ACCOUNTS_HOST || "accounts.zoho.com";

function ask(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(prompt)) rl.output.write(prompt);
    };
    rl.question(prompt, (v) => {
      rl.close();
      process.stdout.write("\n");
      resolve(v.trim().replace(/^["']|["']$/g, ""));
    });
  });
}

async function token(params) {
  const res = await fetch(`https://${ACCOUNTS}/oauth/v2/token`, { method: "POST", body: new URLSearchParams(params) });
  return res.json().catch(() => ({ error: `http_${res.status}` }));
}

function putSecret(name, value) {
  const r = spawnSync("npx", ["wrangler", "secret", "put", name], { input: value + "\n", stdio: ["pipe", "inherit", "inherit"], shell: true });
  if (r.status !== 0) throw new Error(`wrangler secret put ${name} failed`);
}

const clientId = await ask("Client ID: ");
const clientSecret = await ask("Client Secret: ");
console.log("Now click Create on the Generate Code tab, copy the code, and paste it here within a minute.");
const code = await ask("Grant code: ");

const ex = await token({ grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, code });
if (!ex.refresh_token) {
  console.error(`Code exchange failed: ${ex.error ?? "no refresh_token in reply"}. Nothing was stored.`);
  console.error(`(Lengths received: client id ${clientId.length}, secret ${clientSecret.length}, code ${code.length}.)`);
  process.exit(1);
}
const test = await token({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: ex.refresh_token });
if (!test.access_token) {
  console.error(`Refresh test failed: ${test.error ?? "no access_token"}. Nothing was stored.`);
  process.exit(1);
}
console.log(`Token works (scope: ${ex.scope ?? test.scope ?? "not reported"}). Storing secrets...`);
putSecret("MAIL_OAUTH_CLIENT_ID", clientId);
putSecret("MAIL_OAUTH_CLIENT_SECRET", clientSecret);
putSecret("MAIL_OAUTH_REFRESH_TOKEN", ex.refresh_token);
console.log("Done: all three Zoho secrets stored.");
