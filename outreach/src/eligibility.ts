// §10.2 EU/EEA exclusion (OQ-8) and §6.1 ICP denylist. Pure functions.

// EU-27 country codes.
export const EU27 = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
] as const;
// EEA non-EU members.
export const EEA_EXTRA = ["NO", "IS", "LI"] as const;
export const EU_EEA_COUNTRIES: ReadonlySet<string> = new Set([...EU27, ...EEA_EXTRA]);

// ccTLDs for the above. Greece's ccTLD is .gr (ISO code is GR; EL is only the EU's own code).
export const EU_EEA_CCTLDS: ReadonlySet<string> = new Set([
  "at", "be", "bg", "hr", "cy", "cz", "dk", "ee", "fi", "fr", "de", "gr", "hu", "ie",
  "it", "lv", "lt", "lu", "mt", "nl", "pl", "pt", "ro", "sk", "si", "es", "se",
  "no", "is", "li",
  "eu",
]);

// Country names some import sources use instead of ISO codes.
const COUNTRY_NAMES: Record<string, string> = {
  austria: "AT", belgium: "BE", bulgaria: "BG", croatia: "HR", cyprus: "CY", czechia: "CZ",
  "czech republic": "CZ", denmark: "DK", estonia: "EE", finland: "FI", france: "FR",
  germany: "DE", greece: "GR", hungary: "HU", ireland: "IE", italy: "IT", latvia: "LV",
  lithuania: "LT", luxembourg: "LU", malta: "MT", netherlands: "NL", "the netherlands": "NL",
  poland: "PL", portugal: "PT", romania: "RO", slovakia: "SK", slovenia: "SI", spain: "ES",
  sweden: "SE", norway: "NO", iceland: "IS", liechtenstein: "LI",
  "united kingdom": "GB", uk: "GB", "united states": "US", usa: "US", us: "US",
};

export function normalizeCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) {
    const up = t.toUpperCase();
    return up === "EL" ? "GR" : up === "UK" ? "GB" : up;
  }
  return COUNTRY_NAMES[t.toLowerCase()] ?? null;
}

export function tldOf(domain: string): string {
  const parts = domain.toLowerCase().replace(/\.$/, "").split(".");
  return parts[parts.length - 1] ?? "";
}

export type ExclusionReason = "eu_eea_tld" | "eu_eea_country";

/**
 * v1 sends to no EU/EEA recipient. Excluded: EU-27 + EEA ccTLDs, .eu, and any
 * lead whose known company country is EU/EEA. .uk stays in. Unknown country on
 * .com/.io is not excluded (no free signal).
 */
export function euExclusion(domain: string, country: string | null | undefined): ExclusionReason | null {
  if (EU_EEA_CCTLDS.has(tldOf(domain))) return "eu_eea_tld";
  const c = normalizeCountry(country ?? null);
  if (c && EU_EEA_COUNTRIES.has(c)) return "eu_eea_country";
  return null;
}

// Code-owned denylist of obviously large companies (not the ICP: small/mid B2B SaaS).
export const LARGE_COMPANY_DENYLIST: ReadonlySet<string> = new Set([
  "amazon.com", "aws.amazon.com", "google.com", "microsoft.com", "apple.com", "meta.com",
  "facebook.com", "salesforce.com", "atlassian.com", "oracle.com", "ibm.com", "sap.com",
  "adobe.com", "cisco.com", "intel.com", "nvidia.com", "openai.com", "anthropic.com",
  "github.com", "gitlab.com", "shopify.com", "stripe.com", "twilio.com", "zoom.us",
  "slack.com", "hubspot.com", "zendesk.com", "servicenow.com", "workday.com", "intuit.com",
  "dropbox.com", "box.com", "docusign.com", "okta.com", "cloudflare.com", "datadoghq.com",
  "snowflake.com", "mongodb.com", "elastic.co", "netflix.com", "uber.com", "airbnb.com",
  "paypal.com", "squareup.com", "block.xyz", "linkedin.com", "x.com", "twitter.com",
  "notion.so", "notion.com", "figma.com", "canva.com", "vercel.com", "netlify.com",
  "digitalocean.com", "heroku.com", "akamai.com", "fastly.com", "vmware.com", "dell.com",
  "hp.com", "zoho.com", "mailchimp.com", "intercom.com", "monday.com", "asana.com",
]);

export function isDenylisted(domain: string): boolean {
  const d = domain.toLowerCase();
  if (LARGE_COMPANY_DENYLIST.has(d)) return true;
  for (const big of LARGE_COMPANY_DENYLIST) if (d.endsWith("." + big)) return true;
  return false;
}

/** Lowercase host without scheme, path, port, trailing dot or leading www. */
export function normalizeDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].split(":")[0].replace(/\.$/, "");
  if (s.startsWith("www.")) s = s.slice(4);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  return s;
}
