> HARNESS NOTE: free Score PDF, text of renderScoreReportHTML (watermark removed). Lines below are what the visitor reads.

ASTRANT · Score gap report
Generated 2026-11-08 02:11:12 UTC · scan fbfa5bd9

https://ugmonk.com/

71
B

Scored on 4 of 6 dimensions applicable to this site. Citation Visibility is not measured in the free Score; it runs live with the $79 Audit. Some dimensions did not apply to your site (e.g. no API surface for the OpenAPI dimension) and were dropped from the composite.

## Dimension breakdown

### llms.txt Quality

69
C

| Check | Score | Weight | Priority | Notes |

| Presence | 100/100 | 25% | Passing | Found an llms.txt file at /llms.txt. |

| Spec compliance (H1 + blockquote) | 50/100 | 25% | Medium priority | The file has an H1 title but no blockquote summary (a line starting with >). |

| Linked pages return useful markdown | 80/100 | 20% | Passing | 4 of the 5 llms.txt links we checked returned Markdown or plain text; the rest returned HTML or did not load. |

| Curation quality | 100/100 | 15% | Passing | clean link list |

| Blockquote elevator-pitch quality | 0/100 | 15% | High priority | no blockquote to evaluate |

### MCP Server Discoverability

33
F

| Check | Score | Weight | Priority | Notes |

| Well-known discovery (mcp.json / server-card.json) | 0/100 | 30% | High priority | no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json; an MCP server was found (an MCP endpoint answered at https://ugmonk.com/api/mcp) but it is not advertised with a server card |

| Tool coverage and quality | 0/100 | 20% | High priority | no card or no tools declared |

| OAuth metadata (when auth declared) · N/A | — | 15% | — | No MCP server card found, so there is no declared authentication to check. This check is not counted in your score. |

| Live MCP tools/list invocation | 100/100 | 25% | Passing | The MCP server answered and listed 1 tool. |

| DNS TXT discovery (_mcp subdomain) · N/A | — | 10% | — | No TXT record at _mcp.ugmonk.com. Informational only: no ratified standard defines an _mcp DNS record, so this is not scored. |

### OpenAPI / API Catalog N/A

not applicable

No OpenAPI description or API catalog was found (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link). The site does show API evidence (a link to an MCP endpoint, https://ugmonk.com/api/ucp/mcp), so it is not a content-only site: this dimension is marked N/A because there is no OpenAPI description to check, not because there is no API.

### Structured Capability Data

88
A-

| Check | Score | Weight | Priority | Notes |

| JSON-LD present on homepage | 100/100 | 25% | Passing | 1 valid JSON-LD block(s) on homepage |

| Organization schema completeness | 60/100 | 20% | Medium priority | Organization markup found, but it has no description. |

| Service / Product / Offer schema | 100/100 | 20% | Passing | 9 Service/Product/Offer block(s); best match has 3/3 required fields (on the sampled product page https://ugmonk.com/products/analog-task-cards-small; none on the homepage) |

| FAQPage schema · N/A | — | 20% | — | No FAQPage markup found. FAQ markup is optional: add it only for questions the site really answers. This check is not counted in your score. |

| Review / AggregateRating schema · N/A | — | 15% | — | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. This check is not counted in your score. |

### Agent-Parsable Content

100
A

| Check | Score | Weight | Priority | Notes |

| JS-vs-no-JS render diff | 100/100 | 30% | Passing | Static fetch returned 17347 chars of body text including pricing/capabilities signals. The free Score reads your server's HTML only; the $79 Audit also loads the page in a browser and compares the two. |

| Page weight | 100/100 | 15% | Passing | Homepage HTML size: 0.08 MB (79391 bytes). This check looks at page size only; it does not measure loading speed. |

| Markdown content negotiation · N/A | — | 25% | — | We found no Markdown version at the addresses we checked (https://ugmonk.com/index.md and an Accept: text/markdown request to the homepage). Agents read the HTML instead. Informational only: serving Markdown is an emerging convention most hosts don't support yet, so this is not scored. |

| Pricing text visibility | 100/100 | 20% | Passing | No pricing page found, so we checked the prices shown on the homepage (https://ugmonk.com/en-br): 52 text-based price token(s); 0 with a billing period or marked one-time. |

| Case-study scannability · N/A | — | 10% | — | No case-study or portfolio page detected (homepage links such as /case-studies, /customers, /work, /portfolio, /casos or /projetos, and the /case-studies, /customers, /success-stories, /work and /portfolio paths). This check is not counted in your score. |

### Citation Visibility N/A

not measured

Not measured in the free Score. The $79 Audit asks four AI models (OpenAI GPT-4o, Anthropic Claude, Google Gemini and Perplexity Sonar) about 10 questions each about your domain and checks whether each answer names and cites it. This dimension is not counted in your free score.

Priority reflects how far each check is from passing. It is not a forecast of traffic or citations.

### Want deeper remediation guidance per gap?

- $79 Audit — a suggested fix for every check that did not pass, matched to what we found on your site, plus a JSON export. Same dimensions, full evidence and per-gap path.

- $1,299 Implementation (not open yet) — a Git-applicable patch for your site, plus a report verifying each change once it is live and again 30 days later.

- $4,999+ Custom (pre-launch) — Bespoke scoping for complex APIs, multi-region content, custom MCP tools.

Compare tiers at astrant.io. (Paid checkouts are in pre-launch verification — drop your email on each page to be notified when they open.)

Scan ID: fbfa5bd9-e32b-434a-9f85-9539734d081a

Engine: v1.5.1

PDF Template: v1.0.0

Generated: 2026-11-08T02:11:12.052Z

View this scan at https://astrant.io/score/fbfa5bd9-e32b-434a-9f85-9539734d081a

Generated by Astrant for the email shown in the watermark above. PDF watermarking is an anti-abuse measure documented in our Privacy Policy.
