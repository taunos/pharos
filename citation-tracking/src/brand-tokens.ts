// citation-tracking/src/brand-tokens.ts
// D12 LOCKED at F3.3 v3 — brand color constants (dark + light) for digest render layer.
// SYNC WITH marketing-site/src/app/globals.css — manual sync on brand changes.
// Light tokens (digestLight*) are NEW for digest email per F3.3 v3 D12; do NOT exist in globals.css
// (the marketing-site is dark-mode-only per globals.css:30-32; light theme tokens are invented here).

// Dark palette — extracted from marketing-site/src/app/globals.css lines 6-23.
// Used by pdf-renderer.ts (PDF body matches existing F3.1/F3.2 brand chrome).
export const darkPalette = {
  bg: "#0a0a0a",       // --color-bg
  fg: "#fafafa",       // --color-fg
  surface: "#0f0f10",  // --color-surface
  surface2: "#18181b", // --color-surface-2
  border: "#27272a",   // --color-border
  rule: "#1c1c1f",     // --color-rule
  muted: "#a1a1aa",    // --color-muted
  dim: "#71717a",      // --color-dim
  paper: "#fafaf7",    // --color-paper
  accent: "#f59e0b",   // --color-accent (CTA-only per globals.css:9-10 reservation)
} as const;

// Light palette — NEW at F3.3 v3 (globals.css doesn't define light theme).
// Used by digest-email.ts only (per Path B; PDF uses dark palette above).
export const lightPalette = {
  bg: "#fafaf7",     // digestLightBg (= --color-paper from globals.css)
  card: "#ffffff",   // digestLightCard (NEW; pure white card on paper bg)
  fg: "#18181b",     // digestLightFg (= --color-surface-2 inverted as fg on paper)
  muted: "#71717a",  // digestLightMuted (= --color-dim; ~4.31:1 against paper — slightly under AA Normal)
  border: "#e4e4e7", // digestLightBorder (NEW; design call)
  accent: "#f59e0b", // digestLightAccent (= darkPalette.accent; single source for CTA tone)
} as const;
