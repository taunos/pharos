// Operator alert dispatch for B1.3 v1.1 cron-fix.
// Resend-backed; reads env.RESEND_API_KEY + env.OPERATOR_ALERT_TO (verified pre-flight per Step 0.4-bis).
// Throws on Resend non-2xx — drain handler's D8 per-row try-catch handles throw-recovery.

export interface AlertEnv {
  RESEND_API_KEY: string;
  OPERATOR_ALERT_TO: string;
}

export async function sendOperatorAlert(env: AlertEnv, message: string): Promise<void> {
  const subject = `Astrant probe alert: ${message.split(' ')[0]}`;
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'alerts@astrant.io',
      to: env.OPERATOR_ALERT_TO,
      subject,
      text: message,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Resend ${resp.status}: ${await resp.text()}`);
  }
}
