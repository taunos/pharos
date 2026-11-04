import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

// Test C2 site slice — benchmark research page (channel plan D1).
//
// Source: reports/channel-kit-2026-10-04/benchmark-report.md (gitignored,
// Bruno-owned copy). The body below is that draft transcribed for the web:
// headings, tables and links are mechanical; every wording change is listed
// for Bruno's approval in the slice report. Do not edit the copy here without
// the same approval. The internal "every number, with source" appendix is
// not published.
//
// Data files live in public/research/ai-cited-vendors-2026/, generated from
// the Test A-60 run files (_tmp/premortem/test-a/*-60.csv, prompts-60.json).
// Every rate in the tables below was recomputed from those CSVs and matches.

const PATH = "/research/ai-cited-vendors-2026";
const URL_ABS = `https://astrant.io${PATH}`;
const DATA_DIR = "/research/ai-cited-vendors-2026";
const TITLE = "What do AI-cited B2B vendors have that uncited ones don't? (N≈900 domains)";
const DESCRIPTION =
  "We asked Perplexity 60 “which tool should I use” questions about developer and B2B SaaS products and checked every domain for llms.txt, JSON-LD and MCP discovery. Cited vendors carried llms.txt and JSON-LD more often. This is a correlation in one sample.";
// Set to the actual publish (deploy) date before going live.
const DATE_PUBLISHED = "2026-11-04";

export const metadata: Metadata = {
  title: `${TITLE} — Astrant`,
  description: DESCRIPTION,
  alternates: { canonical: "/research/ai-cited-vendors-2026" },
  openGraph: {
    type: "article",
    title: TITLE,
    description: DESCRIPTION,
    url: URL_ABS,
  },
};

const articleLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: TITLE,
  description: DESCRIPTION,
  datePublished: DATE_PUBLISHED,
  author: { "@type": "Person", name: "Bruno", worksFor: { "@type": "Organization", name: "Astrant" } },
  publisher: {
    "@type": "Organization",
    name: "Astrant",
    url: "https://astrant.io",
    logo: { "@type": "ImageObject", url: "https://astrant.io/brand/astrant-mark-dark.png" },
  },
  mainEntityOfPage: { "@type": "WebPage", "@id": URL_ABS },
  url: URL_ABS,
};

// Wide tables scroll inside their own container so the page never scrolls
// horizontally at 375px.
function Table({
  head,
  rows,
  minWidth,
  nowrap = false,
}: {
  head: ReactNode[];
  rows: ReactNode[][];
  minWidth: string;
  // Keep numeric cells such as "69.7% (62 / 89)" on one line.
  nowrap?: boolean;
}) {
  return (
    <div className="not-prose my-6 overflow-x-auto rounded border border-[var(--color-border)]">
      <table className={`w-full ${minWidth} border-collapse text-left text-sm`}>
        <thead className="bg-[var(--color-surface-2)]">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="border-b border-[var(--color-border)] px-3 py-2 font-semibold text-[var(--color-fg)]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[var(--color-rule)] last:border-b-0">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-2 align-top text-[var(--color-muted)] ${j === 0 ? "text-[var(--color-fg)]" : nowrap ? "whitespace-nowrap" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PROSE =
  "prose prose-invert mx-auto max-w-3xl px-6 py-16 prose-headings:font-bold prose-headings:tracking-tight prose-h1:text-3xl prose-h1:sm:text-5xl prose-h2:mt-12 prose-h2:text-2xl prose-h3:mt-8 prose-h3:text-xl prose-p:text-[var(--color-muted)] prose-li:text-[var(--color-muted)] prose-strong:text-[var(--color-fg)] prose-a:text-[var(--color-fg)] prose-a:underline prose-a:decoration-[var(--color-dim)] hover:prose-a:decoration-[var(--color-fg)] prose-code:bg-[var(--color-surface)] prose-code:px-1 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-blockquote:not-italic prose-blockquote:border-[var(--color-border)] prose-blockquote:text-[var(--color-muted)] [&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none";

export default function AiCitedVendorsResearchPage() {
  return (
    <div className="min-h-screen">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }} />
      <SiteHeader />
      <main>
        <article className={PROSE}>
          <p className="!mb-2 font-mono text-xs uppercase tracking-wider !text-[var(--color-dim)]">Research</p>
          <h1>{TITLE}</h1>
          <p>
            <em>Data collected 2026-09-24. Author: Bruno, Astrant.</em>
          </p>

          <blockquote>
            <p>
              <strong>Short version.</strong> We asked Perplexity 60 &ldquo;which tool should I use&rdquo; questions
              about developer and B2B SaaS products and recorded every domain it cited. We then asked a second model,
              with no web access, to name products for the same questions, and kept the vendors Perplexity did{" "}
              <em>not</em> cite. Among vendors, the cited ones were more likely to publish an <code>llms.txt</code>{" "}
              file (69.7% vs 44.6%) and homepage JSON-LD (72.1% vs 52.1%). Almost nobody in either group serves MCP
              discovery metadata (3.7% vs 0.9%; not a reliable difference). This is a correlation in one sample. It
              does <strong>not</strong> show that adding these files gets you cited, and other studies suggest it
              probably doesn&rsquo;t.
            </p>
          </blockquote>

          <h2>Why we ran this</h2>
          <p>
            Astrant sells a free &ldquo;Astrant Score&rdquo; that checks how machine-readable a B2B site is (llms.txt,
            structured data, MCP discovery and so on). Before telling anyone those checks matter, we wanted to know
            whether they line up with being cited by an AI search engine at all. We wrote the test so that it could
            fail: the rule, set before the run, was that a check &ldquo;fails&rdquo; if cited sites do not carry the
            artifact at least 10 percentage points more often than uncited ones, with at least 50 sites per group and
            a two-proportion z-test. One of the three checks did fail.
          </p>

          <h2>Method</h2>
          <p>
            <strong>Questions.</strong> 60 buyer-style prompts about developer and B2B infrastructure categories, for
            example &ldquo;Which transactional email API should a startup use?&rdquo;, &ldquo;What are the best
            feature flag services for a B2B SaaS product?&rdquo; and &ldquo;Which vector database should I use for a
            production RAG application?&rdquo;. The first 20 were written for a pilot run; 40 more were added to get
            the sample above 50 per group. The full prompt list is{" "}
            <a href={`${DATA_DIR}/test-a-60-prompts.csv`}>published with the data</a>.
          </p>
          <p>
            <strong>Cited set (Perplexity).</strong> Each prompt was sent once to Perplexity&rsquo;s{" "}
            <code>sonar</code> API at temperature 0. A domain counts as &ldquo;cited&rdquo; if it appears in the
            response&rsquo;s <code>citations</code> list or <code>search_results</code> list for any prompt. URLs
            were reduced to registrable domains (for example <code>docs.example.com</code> &rarr;{" "}
            <code>example.com</code>). Result: <strong>624 cited domains</strong>. Most of them are not vendors: they
            are blogs, review sites, publishers and forums.
          </p>
          <p>
            <strong>Uncited set (closed-book list).</strong> The same 60 prompts went to OpenAI <code>gpt-4o</code>{" "}
            at temperature 0, with an instruction to answer from its own knowledge only and to list the 8 products
            most commonly recommended, as domains. No web search. Any named domain that Perplexity never cited, for
            any prompt, joined the uncited set: <strong>273 domains</strong>. These are vendors the model knows well
            enough to name, but that did not show up in Perplexity&rsquo;s sources for our questions.
          </p>
          <p>
            <strong>Vendor-only cut (our primary comparison).</strong> Because the cited set is publisher-heavy and
            the uncited set is vendors by construction, comparing them directly mixes &ldquo;cited vs uncited&rdquo;
            with &ldquo;publisher vs vendor&rdquo;. So the headline compares the{" "}
            <strong>
              95 cited domains that <code>gpt-4o</code> also named as products
            </strong>{" "}
            against the uncited vendors. That restriction was added after the pilot run showed the publisher problem.
            We report the pre-registered all-cited comparison too.
          </p>
          <p>
            <strong>Checks (one pass per domain, apex domain only):</strong>
          </p>
          <Table
            minWidth="min-w-[34rem]"
            head={["Artifact", "Counts as present when"]}
            rows={[
              [
                "llms.txt",
                <>
                  <code>GET https://&lt;domain&gt;/llms.txt</code> returns 200 and the body does not start with{" "}
                  <code>&lt;</code> (rules out HTML soft-404s)
                </>,
              ],
              [
                "JSON-LD",
                <>
                  The homepage contains an <code>application/ld+json</code> block with <code>@type</code>{" "}
                  Organization, Product, SoftwareApplication, Service or Offer anywhere in it
                </>,
              ],
              [
                "MCP discovery",
                <>
                  <code>GET /.well-known/mcp.json</code> returns parseable JSON, <strong>or</strong> a DNS TXT record
                  at <code>_mcp.&lt;domain&gt;</code> mentions &ldquo;mcp&rdquo;
                </>,
              ],
            ]}
          />
          <p>
            Timeouts, network failures and HTTP 401/403/429/5xx are recorded as{" "}
            <strong>errors, not absences</strong>, and excluded. A blocked request tells you nothing about whether
            the file exists. That is why the N in each row below differs.
          </p>
          <p>
            <strong>Cost.</strong> The whole run cost $0.36 in API fees.
          </p>

          <h2>Results</h2>
          <h3>Primary: cited vendors vs uncited vendors</h3>
          <Table
            minWidth="min-w-[44rem]"
            nowrap
            head={["Artifact", "Cited vendors", "Uncited vendors", "Difference", "p (two-sided)", "Verdict vs. pre-set rule"]}
            rows={[
              ["llms.txt", "69.7% (62 / 89)", "44.6% (108 / 242)", "+25.0 pts", "0.00005", "holds"],
              ["JSON-LD (Organization/Product/…)", "72.1% (62 / 86)", "52.1% (125 / 240)", "+20.0 pts", "0.001", "holds"],
              ["MCP discovery", "3.7% (3 / 82)", "0.9% (2 / 230)", "+2.8 pts", "0.08", <strong key="f">fails</strong>],
              ["Any of the three", "87.2% (75 / 86)", "64.6% (153 / 237)", "+22.7 pts", "0.00008", "holds"],
            ]}
          />

          <h3>As pre-registered: all cited domains (publishers included) vs uncited vendors</h3>
          <Table
            minWidth="min-w-[34rem]"
            nowrap
            head={["Artifact", "All cited", "Uncited vendors", "Difference", "p"]}
            rows={[
              ["llms.txt", "69.5% (406 / 584)", "44.6% (108 / 242)", "+24.9 pts", "<0.001"],
              ["JSON-LD", "76.0% (437 / 575)", "52.1% (125 / 240)", "+23.9 pts", "<0.001"],
              ["MCP discovery", "3.2% (18 / 567)", "0.9% (2 / 230)", "+2.3 pts", "0.06"],
              ["Any of the three", "86.7% (502 / 579)", "64.6% (153 / 237)", "+22.1 pts", "<0.001"],
            ]}
          />
          <p>
            The two cuts tell the same story. The 20-prompt pilot pointed the same way but was too small to call
            (cited vendors N=21–23).
          </p>

          <h2>How this squares with Ahrefs and SE Ranking</h2>
          <p>Two larger studies point the other way, and we think they are right about the thing they measured:</p>
          <ul>
            <li>
              {/* Figures verified against the originals 2026-11-04. */}
              <strong>
                <a href="https://ahrefs.com/blog/llmstxt-study/">Ahrefs</a>
              </strong>{" "}
              looked at 137,000 domains: about 28% publish an llms.txt, and{" "}
              <strong>97% of roughly 38,000 valid files got zero requests</strong> in May 2026. AI retrieval bots
              were a tiny share of the requests the files did get.
            </li>
            <li>
              <strong>
                <a href="https://seranking.com/blog/llms-txt/">SE Ranking</a>
              </strong>{" "}
              looked at about 300,000 domains: 10.13% had an llms.txt, and they found{" "}
              <strong>no correlation</strong> between having one and being cited. Dropping the variable from their
              model made it more accurate.
            </li>
            <li>
              <strong>
                <a href="https://ahrefs.com/blog/schema-ai-citations/">Ahrefs</a>
              </strong>{" "}
              also tested schema on 1,885 pages against 4,000 controls. Citation changes in AI Mode (+2.4%) and
              ChatGPT (+2.2%) were inside the noise; AI Overviews showed a small decline (−4.6%) that Ahrefs reports
              as statistically significant against the controls.
            </li>
          </ul>
          <p>Our result does not contradict these. Three things reconcile them:</p>
          <ol>
            <li>
              <strong>Fetch ≠ cite.</strong> If AI crawlers almost never request llms.txt (Ahrefs), the file cannot
              be what gets a vendor cited. A file that nobody reads can still be a <em>marker</em>: teams that ship
              llms.txt and clean JSON-LD tend to be teams with well-maintained docs, frequent content and active
              developer marketing, which are things AI search engines do retrieve.
            </li>
            <li>
              <strong>Association ≠ cause.</strong> We did not add files to sites and watch citations change. The
              Ahrefs schema study did something closer to that and found no lift. Our numbers describe who the cited
              vendors are, not what made them cited.
            </li>
            <li>
              <strong>Different population.</strong> 44.6% of our <em>uncited</em> developer-tool vendors have
              llms.txt, far above the 10% (SE Ranking) or 28% (Ahrefs) base rates. This is a narrow, early-adopter
              slice of the web, and the gap we see may not exist elsewhere.
            </li>
          </ol>

          <h2>What we would conclude</h2>
          <ul>
            <li>
              In developer and B2B SaaS categories, vendors Perplexity cites are noticeably more likely to carry
              llms.txt and homepage JSON-LD than well-known vendors it doesn&rsquo;t cite. Both gaps clear our pre-set
              threshold, in both comparisons.
            </li>
            <li>
              MCP discovery metadata (<code>/.well-known/mcp.json</code> or <code>_mcp</code> TXT) is close to absent
              everywhere: 5 sites out of 312 checked vendors. It doesn&rsquo;t separate cited from uncited today. If
              you&rsquo;re deciding what to ship this quarter for AI visibility, a discovery file for your MCP server
              should not be near the top.
            </li>
            <li>
              Cheap, correct machine-readable files are reasonable hygiene. They&rsquo;re also useful for coding
              agents and for anyone (human or model) who needs your facts stated accurately.
            </li>
          </ul>

          <h2>What we would not conclude</h2>
          <ul>
            <li>
              That adding llms.txt or JSON-LD will get you cited. Nothing here tests that, and the best intervention
              study we know of found no positive effect for schema.
            </li>
            <li>
              That these files explain more than a small part of citation. Other research points at off-site factors:
              third-party mentions, comparison and &ldquo;best X&rdquo; listicles, community discussion and brand
              size. We did not measure any of those.
            </li>
            <li>
              That the result holds for ChatGPT, Claude or Gemini search. We only measured Perplexity&rsquo;s API,
              which may not match the consumer app.
            </li>
            <li>
              That any specific company is &ldquo;invisible to AI&rdquo;. One sample per question can&rsquo;t show
              that.
            </li>
          </ul>

          <h2>Limitations</h2>
          <ul>
            <li>
              <strong>One engine, one sample.</strong> One Perplexity <code>sonar</code> call per prompt at
              temperature 0. Citation sets vary from run to run.
            </li>
            <li>
              <strong>&ldquo;Cited&rdquo; is broad.</strong> It includes domains in <code>search_results</code> as
              well as <code>citations</code>, so some &ldquo;cited&rdquo; domains were retrieved but may not have been
              shown to a user as a source.
            </li>
            <li>
              <strong>
                The uncited set depends on <code>gpt-4o</code>&rsquo;s memory.
              </strong>{" "}
              The vendors it recalls skew toward established brands. That partly controls for fame (both groups are
              vendors a model can name), but cited vendors may still be bigger or more active.
            </li>
            <li>
              <strong>The vendor-only cut is post-hoc</strong>, added after the pilot&rsquo;s cited set came back
              publisher-heavy. Both cuts are reported.
            </li>
            <li>
              <strong>Apex domain only.</strong> Many companies put llms.txt on a docs subdomain; we didn&rsquo;t
              check subdomains, so presence is undercounted for both groups.
            </li>
            <li>
              <strong>MCP check is narrow.</strong> We didn&rsquo;t check{" "}
              <code>/.well-known/mcp/server-card.json</code> or MCP servers listed elsewhere (registries, docs pages),
              so &ldquo;MCP discovery&rdquo; means only the two signals above.
            </li>
            <li>
              <strong>Timing.</strong> About 386 domains were checked roughly an hour before the other 511; none were
              re-checked.
            </li>
            <li>
              <strong>Domain reduction</strong> used a small built-in multi-label suffix list rather than the full
              Public Suffix List.
            </li>
            <li>
              <strong>Errors excluded.</strong> Between 6% and 16% of rows per group were blocked or failed and are
              left out of the rates. If blocking correlates with artifact presence, rates shift.
            </li>
            <li>
              <strong>We sell a product that checks these files.</strong> Weigh our framing accordingly; the raw data
              is published so you don&rsquo;t have to take our word for it.
            </li>
          </ul>

          <h2>Data and code</h2>
          {/* PENDING BRUNO APPROVAL: the draft had a [CHECK] placeholder here.
              This paragraph is proposed copy, listed in the slice report. */}
          <p>
            The data behind every number on this page:{" "}
            <a href={`${DATA_DIR}/test-a-60-domains.csv`} download>
              domain results (CSV, 897 rows)
            </a>
            , one row per domain with its group and the result and note for each check, and{" "}
            <a href={`${DATA_DIR}/test-a-60-prompts.csv`} download>
              the 60 prompts (CSV)
            </a>
            . A domain marked &ldquo;uncited&rdquo; only means it was not in Perplexity&rsquo;s citations or search
            results for these 60 prompts on 2026-09-24.
          </p>

          <h2>Check your own site</h2>
          <p>
            If you want to see which of these files your site serves, plus a few other agent-readiness checks, the
            free <Link href="/score">Astrant Score</Link> runs with no signup. It won&rsquo;t tell you whether AI cites
            you. The <Link href="/audit">$79 Audit</Link> adds a one-time citation snapshot: Perplexity with live web
            search, plus ChatGPT, Claude and Gemini answering from model knowledge.
          </p>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
