// P0-C2 capture cutover (spec CD1) — fail-closed capture-pipeline gate.
//
// "on" ONLY on exact string equality; absent, case-variant, whitespace, or any
// unknown value resolves to "off", and "off" means the literal legacy behavior
// on every touched surface. Byte-parallel in shape to the scanner's
// parseIntegrationMode (privacy-delete.ts).
export function parseCapturePipelineMode(v: unknown): "off" | "on" {
  return v === "on" ? "on" : "off";
}
