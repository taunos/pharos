// Minimal RFC 5322 / MIME reader for inbound messages: headers, text/plain
// body, and DSN fields (RFC 3464). Enough for reply handling; not a full MIME stack.
const CRLF = String.fromCharCode(13, 10);
const LF = String.fromCharCode(10);

export type ParsedPart = {
  headers: Record<string, string>;
  contentType: string; // lowercased type/subtype
  params: Record<string, string>;
  body: string; // decoded text (for text-ish parts)
  parts: ParsedPart[];
};

function normalizeNewlines(s: string): string {
  return s.split(CRLF).join(LF);
}

export function parseHeaders(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = normalizeNewlines(block).split(LF);
  let cur = "";
  const flush = () => {
    const i = cur.indexOf(":");
    if (i > 0) out[cur.slice(0, i).trim().toLowerCase()] = cur.slice(i + 1).trim();
  };
  for (const line of lines) {
    if (/^[ \t]/.test(line) && cur) cur += " " + line.trim();
    else {
      if (cur) flush();
      cur = line;
    }
  }
  if (cur) flush();
  return out;
}

function parseContentType(v: string | undefined): { type: string; params: Record<string, string> } {
  const raw = v ?? "text/plain";
  const [type, ...rest] = raw.split(";");
  const params: Record<string, string> = {};
  for (const p of rest) {
    const i = p.indexOf("=");
    if (i < 0) continue;
    params[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return { type: type.trim().toLowerCase(), params };
}

function decodeQP(s: string): string {
  const soft = s.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    const c = soft[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(soft.charCodeAt(i) & 0xff);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function decodeB64(s: string): string {
  try {
    const bin = atob(s.replace(/\s+/g, ""));
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(u);
  } catch {
    return "";
  }
}

export function parseMime(raw: string, depth = 0): ParsedPart {
  const s = normalizeNewlines(raw);
  const sep = s.indexOf(LF + LF);
  const headBlock = sep < 0 ? s : s.slice(0, sep);
  const bodyRaw = sep < 0 ? "" : s.slice(sep + 2);
  const headers = parseHeaders(headBlock);
  const { type, params } = parseContentType(headers["content-type"]);
  const cte = (headers["content-transfer-encoding"] ?? "").toLowerCase();
  const part: ParsedPart = { headers, contentType: type, params, body: "", parts: [] };
  if (type.startsWith("multipart/") && params.boundary && depth < 6) {
    const b = "--" + params.boundary;
    const chunks = bodyRaw.split(b);
    for (const ch of chunks.slice(1)) {
      if (ch.startsWith("--")) break;
      part.parts.push(parseMime(ch.replace(/^\n/, ""), depth + 1));
    }
    return part;
  }
  part.body = cte === "base64" ? decodeB64(bodyRaw) : cte === "quoted-printable" ? decodeQP(bodyRaw) : bodyRaw;
  if (type === "message/rfc822" && depth < 6) part.parts.push(parseMime(part.body, depth + 1));
  return part;
}

function walk(p: ParsedPart, fn: (x: ParsedPart) => void): void {
  fn(p);
  for (const c of p.parts) walk(c, fn);
}

export function firstTextPlain(p: ParsedPart): string {
  let out: string | null = null;
  walk(p, (x) => {
    if (out === null && x.contentType === "text/plain" && x.headers["content-disposition"]?.startsWith("attachment") !== true) out = x.body;
  });
  if (out !== null) return out;
  let html: string | null = null;
  walk(p, (x) => {
    if (html === null && x.contentType === "text/html") html = x.body;
  });
  return html ? (html as string).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ") : "";
}

export type DsnInfo = { status: string | null; finalRecipient: string | null; originalMessageId: string | null };

export function extractDsn(p: ParsedPart): DsnInfo | null {
  let status: string | null = null;
  let finalRecipient: string | null = null;
  let originalMessageId: string | null = null;
  let sawDsnPart = false;
  walk(p, (x) => {
    if (x.contentType === "message/delivery-status") {
      sawDsnPart = true;
      const m = /^Status:\s*([245]\.\d{1,3}\.\d{1,3})/im.exec(x.body);
      if (m && !status) status = m[1];
      const r = /^Final-Recipient:\s*(?:rfc822;)?\s*<?([^>\s]+@[^>\s]+)>?/im.exec(x.body);
      if (r && !finalRecipient) finalRecipient = r[1].toLowerCase();
    }
    if (x !== p && (x.contentType === "text/rfc822-headers" || x.contentType === "message/rfc822-headers")) {
      const h = parseHeaders(x.body);
      if (h["message-id"] && !originalMessageId) originalMessageId = h["message-id"];
    }
    if (x !== p && x.headers["message-id"] && x.contentType !== "message/rfc822" && depthIsEmbedded(p, x) && !originalMessageId) {
      originalMessageId = x.headers["message-id"];
    }
  });
  // A DSN needs a parsed message/delivery-status part with a Status or Final-Recipient
  // (E7): a bare multipart/report (read receipts are multipart/report too) or a
  // delivery-status part with neither field is not treated as a bounce.
  if (!sawDsnPart || (!status && !finalRecipient)) return null;
  return { status, finalRecipient, originalMessageId };
}

function depthIsEmbedded(root: ParsedPart, x: ParsedPart): boolean {
  // An embedded original message is a child of a message/rfc822 part.
  let found = false;
  walk(root, (y) => {
    if (y.contentType === "message/rfc822" && y.parts.includes(x)) found = true;
  });
  return found;
}

export function addrOf(v: string | undefined): string {
  if (!v) return "";
  const m = /<([^>]+)>/.exec(v);
  return (m ? m[1] : v).trim().toLowerCase();
}

/** Strips quoted history and our own footer from a reply body (§9.1: model sees only new text). */
export function stripQuoted(text: string): string {
  const lines = normalizeNewlines(text).split(LF);
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (/^On .+wrote:\s*$/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (/^From:\s.+/i.test(line.trim()) && out.length > 0) break;
    if (/^Don't want these\?/.test(line.trim())) break;
    if (line.trim() === "--") break;
    out.push(line);
  }
  return out.join(LF).trim();
}
