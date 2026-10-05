// Test C-A (A3 + R2-9) — routes a Queue batch to its consumer by batch.queue.
// Kept out of worker.ts (which imports the generated .open-next bundle) so it
// is unit-testable.
//
//   astrant-audit-fulfill      → auditFulfillQueueHandler
//   astrant-audit-fulfill-dlq  → auditFulfillDlqHandler
//   anything else              → the existing capture consumer, unchanged
//
// The P0-C2 capture queue has no fixed name anywhere in the tree (it is not
// bound in wrangler.jsonc; its DLQ name is the CAPTURE_DLQ_NAME env var), so
// non-audit queues still fall through to the capture consumer — logged with
// the queue name so an unexpected binding is visible. Once the capture queue
// is provisioned, pin its name here and make unknown names throw.

import { captureQueueHandler, type CaptureConsumerEnv, type CaptureJobMessage } from "./capture-queue-consumer";
import {
  AUDIT_FULFILL_DLQ_NAME,
  AUDIT_FULFILL_QUEUE_NAME,
  auditFulfillDlqHandler,
  auditFulfillQueueHandler,
  type AuditFulfillConsumerEnv,
  type AuditFulfillMessage,
} from "./audit-fulfill-queue-consumer";

export type WorkerQueueEnv = CaptureConsumerEnv & AuditFulfillConsumerEnv;
export type WorkerQueueMessage = CaptureJobMessage | AuditFulfillMessage;

export interface QueueHandlers {
  auditFulfill: (batch: MessageBatch<AuditFulfillMessage>, env: AuditFulfillConsumerEnv) => Promise<void>;
  auditFulfillDlq: (batch: MessageBatch<AuditFulfillMessage>, env: AuditFulfillConsumerEnv) => Promise<void>;
  capture: (batch: MessageBatch<CaptureJobMessage>, env: CaptureConsumerEnv) => Promise<void>;
}

const DEFAULT_HANDLERS: QueueHandlers = {
  auditFulfill: (batch, env) => auditFulfillQueueHandler(batch, env),
  auditFulfillDlq: auditFulfillDlqHandler,
  capture: captureQueueHandler,
};

export async function routeQueueBatch(
  batch: MessageBatch<WorkerQueueMessage>,
  env: WorkerQueueEnv,
  handlers: QueueHandlers = DEFAULT_HANDLERS,
): Promise<void> {
  if (batch.queue === AUDIT_FULFILL_QUEUE_NAME) {
    await handlers.auditFulfill(batch as MessageBatch<AuditFulfillMessage>, env);
  } else if (batch.queue === AUDIT_FULFILL_DLQ_NAME) {
    await handlers.auditFulfillDlq(batch as MessageBatch<AuditFulfillMessage>, env);
  } else {
    console.error(`QUEUE_ROUTER_FALLTHROUGH queue=${batch.queue} → capture consumer`);
    await handlers.capture(batch as MessageBatch<CaptureJobMessage>, env);
  }
}
