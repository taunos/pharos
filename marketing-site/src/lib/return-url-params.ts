// src/lib/return-url-params.ts
//
// H1 hygiene: Dodo appends `?payment_id=…&status=…&email=<buyer email>` to
// the checkout return_url. Neither /audit-results/{sessionId} nor /f2-success
// reads those params, and leaving them in the URL keeps the buyer email in
// browser history and leaks it via Referer. middleware.ts redirects to the
// cleaned URL returned here.

export const DODO_RETURN_PARAMS = ["email", "payment_id", "status"] as const;

// Returns a copy of the URL with the Dodo return params removed (other params
// kept), or null when none are present (no redirect needed).
export function stripDodoReturnParams(input: URL): URL | null {
  const url = new URL(input.toString());
  let changed = false;
  for (const name of DODO_RETURN_PARAMS) {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name);
      changed = true;
    }
  }
  return changed ? url : null;
}
