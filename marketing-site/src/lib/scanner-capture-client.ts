// P0-C2 Chunk E2 — typed Service Binding RPC client for the scanner-owned
// capture state machine. All calls go over the `SCANNER_CAPTURE` Fetcher binding
// (never direct public HTTP / D1). Each method returns a DISCRIMINATED UNION and
// is RUNTIME-VALIDATED per RPC: transport failures, 5xx / unexpected HTTP, and
// any known status whose required fields are missing/wrong THROW (so Queue
// automatic-retry/DLQ semantics apply). A merely recognizable status on an
// inconsistent body (wrong HTTP class, missing field) is NOT accepted.

type Raw = { status: string } & Record<string, unknown>;

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export type ErrorResult = { status: "error"; reason: string };

export type ClaimResult =
  | { status: "claimed"; job: Record<string, unknown>; scan: Record<string, unknown> }
  | { status: "deferred"; next_attempt_at: number }
  | { status: "ack_no_work" };
export type RegisterResult = { status: "registered" | "already_registered"; r2_key: string } | ErrorResult;
export type UploadResult = { status: "uploaded" | "already_uploaded" } | ErrorResult;
export type CommitResult =
  | { status: "committed" | "already_committed" | "preserved_for_retry" }
  | { status: "compensation_required"; r2_key: string }
  | ErrorResult;
export type ConfirmResult = { status: "confirmed" } | { status: "refused"; reason: string };
export type FreezeResult =
  | { status: "frozen"; updated_at: number }
  | { status: "already_frozen"; snapshot: string; updated_at: number }
  | ErrorResult;
export type CompleteResult = { status: "done" | "already_done" } | ErrorResult;
export type DeferResult = { status: "deferred"; next_attempt_at: number } | ErrorResult;
export type AmbiguousResult = { status: "ambiguous" } | ErrorResult;
export type DeadLetterResult = { status: "dead_lettered" | "noop" | "ack_no_work" } | ErrorResult;

export class ScannerCaptureClient {
  constructor(
    private readonly fetcher: Fetcher,
    private readonly key: string,
  ) {}

  private async call(op: string, body: Record<string, unknown>): Promise<{ http: number; body: Raw }> {
    let res: Response;
    try {
      res = await this.fetcher.fetch(
        new Request(`https://scanner.internal/api/internal/capture/${op}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-capture-consumer-key": this.key },
          body: JSON.stringify(body),
        }),
      );
    } catch {
      throw new Error("rpc_transport");
    }
    if (res.status !== 200 && res.status !== 422) throw new Error("rpc_status"); // 5xx/401/400/404 → throw
    const json = (await res.json().catch(() => null)) as Raw | null;
    if (!json || typeof json.status !== "string") throw new Error("rpc_malformed");
    return { http: res.status, body: json };
  }

  private static bad(): never {
    throw new Error("rpc_malformed");
  }
  // Success statuses must arrive on HTTP 200; error/refused on HTTP 422.
  private static expectHttp(http: number, isErr: boolean): void {
    if (http !== (isErr ? 422 : 200)) ScannerCaptureClient.bad();
  }
  private static asError(j: Raw, http: number): ErrorResult {
    ScannerCaptureClient.expectHttp(http, true);
    if (!isStr(j.reason)) ScannerCaptureClient.bad();
    return { status: "error", reason: j.reason as string };
  }

  async claim(jobId: string): Promise<ClaimResult> {
    const { http, body: j } = await this.call("claim", { job_id: jobId });
    if (j.status === "claimed") {
      ScannerCaptureClient.expectHttp(http, false);
      if (!isObj(j.job) || !isObj(j.scan)) ScannerCaptureClient.bad();
      return { status: "claimed", job: j.job, scan: j.scan };
    }
    if (j.status === "deferred") {
      ScannerCaptureClient.expectHttp(http, false);
      if (!isInt(j.next_attempt_at)) ScannerCaptureClient.bad();
      return { status: "deferred", next_attempt_at: j.next_attempt_at };
    }
    if (j.status === "ack_no_work") {
      ScannerCaptureClient.expectHttp(http, false);
      return { status: "ack_no_work" };
    }
    return ScannerCaptureClient.bad();
  }

  async registerArtifact(jobId: string, claimId: string): Promise<RegisterResult> {
    const { http, body: j } = await this.call("register-artifact", { job_id: jobId, claim_id: claimId });
    if (j.status === "registered" || j.status === "already_registered") {
      ScannerCaptureClient.expectHttp(http, false);
      if (!isStr(j.r2_key)) ScannerCaptureClient.bad();
      return { status: j.status, r2_key: j.r2_key as string };
    }
    if (j.status === "error") return ScannerCaptureClient.asError(j, http);
    return ScannerCaptureClient.bad();
  }

  async markUploaded(jobId: string, claimId: string, r2Key: string): Promise<UploadResult> {
    const { http, body: j } = await this.call("mark-uploaded", { job_id: jobId, claim_id: claimId, r2_key: r2Key });
    if (j.status === "uploaded" || j.status === "already_uploaded") {
      ScannerCaptureClient.expectHttp(http, false);
      return { status: j.status };
    }
    if (j.status === "error") return ScannerCaptureClient.asError(j, http);
    return ScannerCaptureClient.bad();
  }

  async commitPointer(jobId: string, claimId: string, r2Key: string): Promise<CommitResult> {
    const { http, body: j } = await this.call("commit-pointer", { job_id: jobId, claim_id: claimId, r2_key: r2Key });
    if (j.status === "committed" || j.status === "already_committed" || j.status === "preserved_for_retry") {
      ScannerCaptureClient.expectHttp(http, false);
      return { status: j.status };
    }
    if (j.status === "compensation_required") {
      ScannerCaptureClient.expectHttp(http, false);
      if (!isStr(j.r2_key)) ScannerCaptureClient.bad();
      return { status: "compensation_required", r2_key: j.r2_key as string };
    }
    if (j.status === "error") return ScannerCaptureClient.asError(j, http);
    return ScannerCaptureClient.bad();
  }

  async confirmCompensation(jobId: string, r2Key: string): Promise<ConfirmResult> {
    const { http, body: j } = await this.call("confirm-compensation", { job_id: jobId, r2_key: r2Key });
    if (j.status === "confirmed") {
      ScannerCaptureClient.expectHttp(http, false);
      return { status: "confirmed" };
    }
    if (j.status === "refused") {
      ScannerCaptureClient.expectHttp(http, false); // refused is a 200 outcome from the RPC
      if (!isStr(j.reason)) ScannerCaptureClient.bad();
      return { status: "refused", reason: j.reason as string };
    }
    return ScannerCaptureClient.bad();
  }

  async freezeSnapshot(jobId: string, claimId: string, snapshot: unknown): Promise<FreezeResult> {
    const { http, body: j } = await this.call("freeze-snapshot", { job_id: jobId, claim_id: claimId, snapshot });
    if (j.status === "frozen") {
      ScannerCaptureClient.expectHttp(http, false);
      if (!isInt(j.updated_at)) ScannerCaptureClient.bad();
      return { status: "frozen", updated_at: j.updated_at };
    }
    if (j.status === "already_frozen") {
      ScannerCaptureClient.expectHttp(http, false);
      if (!isStr(j.snapshot) || !isInt(j.updated_at)) ScannerCaptureClient.bad();
      return { status: "already_frozen", snapshot: j.snapshot as string, updated_at: j.updated_at };
    }
    if (j.status === "error") return ScannerCaptureClient.asError(j, http);
    return ScannerCaptureClient.bad();
  }

  async complete(jobId: string, claimId: string): Promise<CompleteResult> {
    const { http, body: j } = await this.call("complete", { job_id: jobId, claim_id: claimId });
    if (j.status === "done" || j.status === "already_done") {
      ScannerCaptureClient.expectHttp(http, false);
      return { status: j.status };
    }
    if (j.status === "error") return ScannerCaptureClient.asError(j, http);
    return ScannerCaptureClient.bad();
  }

  async defer(jobId: string, claimId: string, nextAttemptAt: number): Promise<DeferResult> {
    const { http, body: j } = await this.call("defer", { job_id: jobId, claim_id: claimId, next_attempt_at: nextAttemptAt });
    if (j.status === "deferred") {
      ScannerCaptureClient.expectHttp(http, false);
      if (!isInt(j.next_attempt_at)) ScannerCaptureClient.bad();
      return { status: "deferred", next_attempt_at: j.next_attempt_at };
    }
    if (j.status === "error") return ScannerCaptureClient.asError(j, http);
    return ScannerCaptureClient.bad();
  }

  async markAmbiguous(jobId: string, claimId: string): Promise<AmbiguousResult> {
    const { http, body: j } = await this.call("mark-ambiguous", { job_id: jobId, claim_id: claimId });
    if (j.status === "ambiguous") {
      ScannerCaptureClient.expectHttp(http, false);
      return { status: "ambiguous" };
    }
    if (j.status === "error") return ScannerCaptureClient.asError(j, http);
    return ScannerCaptureClient.bad();
  }

  async markDeadLetter(jobId: string): Promise<DeadLetterResult> {
    const { http, body: j } = await this.call("mark-dead-letter", { job_id: jobId });
    if (j.status === "dead_lettered" || j.status === "noop" || j.status === "ack_no_work") {
      ScannerCaptureClient.expectHttp(http, false);
      return { status: j.status };
    }
    if (j.status === "error") return ScannerCaptureClient.asError(j, http);
    return ScannerCaptureClient.bad();
  }
}
