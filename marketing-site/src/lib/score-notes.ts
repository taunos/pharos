// Plain-language versions of the scanner's terse sub-check notes, for the free
// Score surfaces (results page, Score PDF, Score email). The free Score shows
// the note with no remediation next to it, so "status=404" or
// "name=true, url=true, description=false" reaches a visitor as raw debug
// output. The paid Audit still prints the scanner note (its remediation text
// and remediation-templates.ts match on the raw form), so the scanner notes
// are left unchanged and only the free surfaces translate them here.
//
// Only exact, known note shapes are rewritten; anything else is returned as is.
// Pure: safe in server and client components.

import type { SubCheck } from "./audit-types";

const yes = (s: string) => s === "yes" || s === "true";

function joinOr(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

export function plainScoreNote(sub: Pick<SubCheck, "id" | "notes">): string {
  const notes = sub.notes ?? "";
  let m: RegExpMatchArray | null;
  switch (sub.id) {
    case "presence":
      if ((m = notes.match(/^status=(404|410)$/))) return `There is no llms.txt file at /llms.txt (the server answered ${m[1]}).`;
      if ((m = notes.match(/^status=(\d{3})$/)) && m[1] !== "200") return `/llms.txt did not load (the server answered HTTP ${m[1]}).`;
      if (/^status=200, content-type="[^"]*"$/.test(notes)) return "Found an llms.txt file at /llms.txt.";
      if (notes === "fetch failed") return "We could not load /llms.txt on this run.";
      return notes;
    case "spec_compliance":
      if ((m = notes.match(/^h1=(yes|no), blockquote=(yes|no)$/))) {
        const h1 = yes(m[1]);
        const bq = yes(m[2]);
        if (h1 && bq) return "The file starts with an H1 title and has a blockquote summary.";
        if (h1) return "The file has an H1 title but no blockquote summary (a line starting with >).";
        if (bq) return "The file has a blockquote summary but no H1 title (a line starting with #).";
        return "No H1 title (a line starting with #) and no blockquote summary (a line starting with >).";
      }
      return notes;
    case "linked_pages_quality":
      if (notes === "no links to sample") return "No links in llms.txt for us to check.";
      if ((m = notes.match(/^(\d+)\/(\d+) sampled links return markdown-ish content$/))) {
        return `${m[1]} of the ${m[2]} llms.txt links we checked returned Markdown or plain text; the rest returned HTML or did not load.`;
      }
      return notes;
    case "organization_schema":
      if ((m = notes.match(/^Organization found: name=(true|false), url=(true|false), description=(true|false), sameAs=\d+$/))) {
        const missing = [["name", m[1]], ["url", m[2]], ["description", m[3]]]
          .filter(([, v]) => !yes(v))
          .map(([k]) => k);
        return missing.length === 0
          ? "Organization markup found, with a name, url and description."
          : `Organization markup found, but it has no ${joinOr(missing)}.`;
      }
      return notes;
    case "live_invocation":
      if ((m = notes.match(/^tools\/list returned (\d+) tools$/))) {
        return `The MCP server answered and listed ${m[1]} tool${m[1] === "1" ? "" : "s"}.`;
      }
      return notes;
    default:
      return notes;
  }
}
