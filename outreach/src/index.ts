// pharos-outreach entrypoint. Scheduled handlers AWAIT everything (never
// ctx.waitUntil) and every handler takes the same D1 lease first (D11).
// DRAFTS ONLY: nothing here can send an email; Bruno sends drafts himself.
import { handleAdmin } from "./admin";
import { makeAlerter, type Alerter } from "./alerts";
import { buildWeeklyBatch, expireBatches } from "./batch";
import { getControl, logEvent, releaseLease, takeLease, tripStop } from "./db";
import { drainInbox } from "./inbound";
import type { MailClient } from "./mail/types";
import { ZohoAuthError, zohoFromEnv } from "./mail/zoho";
import { mayCallModel, mayCreateDrafts, mayResearch, modeOf } from "./mode";
import { handleOptout } from "./optout";
import { researchStep } from "./research";
import { runRetention } from "./retention";
import { draftStep, expireStaleDrafts, reconcileSent, sweepStuckDrafting } from "./drafts";
import { checkStops } from "./stops";
import { processScanDeletions } from "./suppression";
import type { AiBinding, Env } from "./types";

export const CRON_WEEKLY = "5 9 * * 1";
export const CRON_TICK = "7,22,37,52 * * * *";
export const CRON_DAILY = "5 3 * * *";

export type Deps = {
  now: () => number;
  fetch: typeof fetch;
  mail: MailClient | null;
  ai: AiBinding | null;
  alert: Alerter;
};

export function defaultDeps(env: Env): Deps {
  const now = () => Date.now();
  const mail = env.MAIL_PROVIDER === "zoho" || !env.MAIL_PROVIDER ? zohoFromEnv(env) : null;
  return {
    now,
    fetch: (input, init) => fetch(input, init),
    mail,
    ai: mayCallModel(modeOf(env)) ? env.AI : null, // §4: no model calls under off
    alert: makeAlerter(env, mail, now),
  };
}

async function drainSafely(env: Env, deps: Deps): Promise<boolean> {
  if (!deps.mail) return false;
  try {
    return await drainInbox(env, { mail: deps.mail, ai: deps.ai, alert: deps.alert, now: deps.now, mailboxWrites: mayCreateDrafts(modeOf(env)) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("inbox_drain_failed", msg);
    if (e instanceof ZohoAuthError) await tripStop(env.DB, deps.now(), "provider_auth", { where: "inbox" });
    else await logEvent(env.DB, deps.now(), "inbox_drain_failed", null, { message: msg.slice(0, 200) });
    return false;
  }
}

async function reconcileSafely(env: Env, deps: Deps): Promise<number | string> {
  if (!deps.mail) return "no_mail_client";
  try {
    return await reconcileSent(env, { mail: deps.mail, now: deps.now, alert: deps.alert });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof ZohoAuthError) await tripStop(env.DB, deps.now(), "provider_auth", { where: "sent" });
    else await logEvent(env.DB, deps.now(), "sent_reconcile_failed", null, { message: msg.slice(0, 200) });
    return "error";
  }
}

export async function runTick(env: Env, deps: Deps): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  // 1. Inbox drain + reply handling: every mode, including off and paused.
  const caughtUp = await drainSafely(env, deps);
  out.inbox_caught_up = caughtUp;
  // 2. Sent-folder reconciliation (what Bruno actually sent): every mode, read-only on the mailbox.
  out.reconciled = await reconcileSafely(env, deps);
  // 3. Scan-row deletions: every mode.
  out.scans_deleted = await processScanDeletions(env, deps.now(), 5).catch(() => 0);
  // 4. Crash recovery + stops.
  out.draft_unknown = await sweepStuckDrafting(env, { mail: deps.mail ?? nullMail, now: deps.now, alert: deps.alert });
  out.stop = (await checkStops(env, deps.now(), deps.alert))?.reason ?? null;
  // 5. At most one research step (third-party traffic: not under off, not while paused).
  const mode = modeOf(env);
  const c = await getControl(env.DB);
  if (mayResearch(mode) && !c.paused) {
    try {
      out.research = await researchStep(env, { fetch: deps.fetch, now: deps.now });
    } catch (e) {
      out.research = "error";
      await logEvent(env.DB, deps.now(), "research_error", null, { message: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    }
  } else out.research = "skipped";
  // 6. At most one mailbox draft, only if the inbox drained to empty in THIS tick.
  out.draft = deps.mail ? await draftStep(env, { mail: deps.mail, now: deps.now, alert: deps.alert }, caughtUp) : "gate:no_mail_client";
  return out;
}

const nullMail: MailClient = {
  drainInbox: async () => ({ messages: [], caughtUp: false, cursor: null }),
  listSent: async () => ({ messages: [], caughtUp: false, cursor: null }),
  createDraft: async () => ({ draftId: null }),
};

export async function runWeekly(env: Env, deps: Deps): Promise<Record<string, unknown>> {
  await drainSafely(env, deps);
  const r = await buildWeeklyBatch(env, { ai: deps.ai, fetch: deps.fetch, now: deps.now, alert: deps.alert });
  return { batch: r };
}

export async function runDaily(env: Env, deps: Deps): Promise<Record<string, unknown>> {
  const now = deps.now();
  const out: Record<string, unknown> = {};
  out.expired = await expireBatches(env, now);
  out.drafts_expired = await expireStaleDrafts(env, now);
  out.retention = await runRetention(env, now);
  out.stop = (await checkStops(env, now, deps.alert))?.reason ?? null;
  return out;
}

export async function runScheduled(cron: string, env: Env, deps: Deps): Promise<Record<string, unknown>> {
  const lease = await takeLease(env.DB, deps.now());
  if (!lease) return { lease: "busy" };
  try {
    if (cron === CRON_TICK) return await runTick(env, deps);
    if (cron === CRON_WEEKLY) return await runWeekly(env, deps);
    if (cron === CRON_DAILY) return await runDaily(env, deps);
    return { unknown_cron: cron };
  } finally {
    await releaseLease(env.DB, lease);
  }
}

export async function handleFetch(req: Request, env: Env, deps: Pick<Deps, "fetch" | "now">): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/health") return Response.json({ ok: true, mode: modeOf(env) });
  const u = /^\/u\/([A-Za-z0-9_-]{1,200})$/.exec(url.pathname);
  if (u) return handleOptout(req, env, u[1], deps.now());
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) return handleAdmin(req, env, deps);
  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return handleFetch(req, env, { fetch: (i, init) => fetch(i, init), now: () => Date.now() });
  },
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const r = await runScheduled(event.cron, env, defaultDeps(env));
    console.log("outreach_scheduled", event.cron, JSON.stringify(r));
  },
};
