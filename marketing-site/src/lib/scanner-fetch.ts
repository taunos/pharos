// Marketing → scanner transport. Every marketing call to pharos-scanner goes
// through scannerFetch: over the SCANNER_SVC Service Binding (wrangler.jsonc
// `services`, the scanner's default fetch entrypoint) when it is bound, so these
// calls no longer depend on the scanner's workers.dev route; otherwise plain
// HTTP to the URL (local dev, tests, a deploy that predates the binding).
// Path, method, headers and body are identical either way; a Service Binding
// ignores the URL's host.

export const DEFAULT_SCANNER_URL = "https://pharos-scanner.pharos-dev.workers.dev";

export interface ScannerServiceEnv {
  SCANNER_SVC?: Fetcher;
}

export function scannerFetch(svc: Fetcher | undefined, url: string, init: RequestInit): Promise<Response> {
  return svc ? svc.fetch(url, init) : fetch(url, init);
}
