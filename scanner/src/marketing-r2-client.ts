// P0-C2 Chunk F1 — typed Service Binding client to marketing's R2 reconciliation
// endpoints. Scanner drives reconciliation (D1 owner) but marketing owns R2, so
// the physical object deletes go over this binding. ONLY an HTTP-200 confirmed
// response is success; ANY other outcome (transport, non-200, malformed) THROWS —
// so the reconciler never marks a D1 row `purged` on an unconfirmed R2 delete.

export class MarketingR2Client {
  constructor(
    private readonly fetcher: Fetcher,
    private readonly key: string,
  ) {}

  private async call(op: string, body: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>> {
    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-reconcile-key": this.key },
      body: JSON.stringify(body),
    };
    // Bound the RPC below the caller's remaining lease window so an external
    // delete can never still be running when another owner acquires the lease.
    if (timeoutMs != null && Number.isFinite(timeoutMs)) init.signal = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await this.fetcher.fetch(new Request(`https://marketing.internal/api/internal/r2/${op}`, init));
    } catch {
      throw new Error("r2_transport"); // includes AbortError on timeout ⇒ fail closed
    }
    if (res.status !== 200) throw new Error("r2_rpc_failed"); // any non-200 ⇒ unconfirmed ⇒ throw
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!json || json.ok !== true) throw new Error("r2_malformed");
    return json;
  }

  // Confirmed exact delete, else throw. Optional timeout bounds the RPC.
  async deleteArtifact(key: string, timeoutMs?: number): Promise<void> {
    const r = await this.call("delete", { key }, timeoutMs);
    if (r.status !== "deleted") throw new Error("r2_delete_unconfirmed");
  }

  // Confirmed prefix purge (returns the object count), else throw. The count must
  // be a NON-NEGATIVE integer. Optional timeout bounds the RPC below the caller's
  // remaining lease window (deleteArtifact precedent).
  async purgePrefix(prefix: string, timeoutMs?: number): Promise<number> {
    const r = await this.call("purge-prefix", { prefix }, timeoutMs);
    if (r.status !== "purged" || !Number.isInteger(r.purged) || (r.purged as number) < 0) throw new Error("r2_purge_unconfirmed");
    return r.purged as number;
  }
}
