// Operator alert helper (F2 v6.1 LOW-1 fold).
//
// Send a small structured alert email to Bruno when something operationally
// notable happens. v1 use case: F2 over-capacity / missing-custom-fields paths
// in /api/dodo-webhook + /api/impl-fulfill. F3's existing
// F3_OVER_CAPACITY_DIRECT_PURCHASE log surface can retroactively adopt.
//
// From-address: reports@astrant.io (per V-N — already shipping F3 emails;
// astrant.io domain is DNS-verified on Resend). If Bruno verifies a separate
// alerts@astrant.io address in the future, swap the literal here.

import { Resend } from "resend";

export interface OperatorAlertEnv {
  RESEND_API_KEY: string;
  OPERATOR_ALERT_EMAIL: string;
}

export type OperatorAlertParams = {
  alert_code: string;          // e.g. "F2_OVER_CAPACITY_DIRECT_PURCHASE"
  customer_email?: string;
  session_id?: string;
  dodo_payment_id?: string;
  notes?: string;
};

const FROM_ADDRESS = "Astrant Alerts <reports@astrant.io>";

export async function sendOperatorAlert(
  env: OperatorAlertEnv,
  params: OperatorAlertParams,
): Promise<void> {
  const resend = new Resend(env.RESEND_API_KEY);
  const lines = [
    `Alert: ${params.alert_code}`,
    params.customer_email ? `Customer: ${params.customer_email}` : null,
    params.session_id ? `Session: ${params.session_id}` : null,
    params.dodo_payment_id ? `Dodo payment: ${params.dodo_payment_id}` : null,
    params.notes ? `Notes: ${params.notes}` : null,
    `Action: investigate + refund if needed via Dodo dashboard.`,
  ].filter(Boolean);

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: env.OPERATOR_ALERT_EMAIL,
      subject: `[ALERT] ${params.alert_code}`,
      text: lines.join("\n"),
    });
  } catch (err) {
    // Fail-open: alert send failures should NOT cascade to the caller's
    // primary action (e.g. webhook handler returning 503 to Dodo). Log only.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`OPERATOR_ALERT_SEND_FAILED code=${params.alert_code} err=${msg}`);
  }
}
