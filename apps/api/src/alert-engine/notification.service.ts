import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface NotificationPayload {
  projectName: string;
  alertName: string;
  alertType: string;
  currentValue: number;
  threshold: number;
  dashboardUrl: string;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Posts a formatted message block to a Slack incoming webhook URL.
   */
  async sendSlack(webhookUrl: string, payload: NotificationPayload): Promise<void> {
    const body = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `🚨 AgentLens Alert: ${payload.alertName}`,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Project:*\n${payload.projectName}` },
            { type: 'mrkdwn', text: `*Alert type:*\n${payload.alertType}` },
            { type: 'mrkdwn', text: `*Current value:*\n${payload.currentValue.toFixed(4)}` },
            { type: 'mrkdwn', text: `*Threshold:*\n${payload.threshold}` },
          ],
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View Dashboard' },
              url: payload.dashboardUrl,
            },
          ],
        },
      ],
    };

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Slack webhook returned HTTP ${res.status}`);
    }
  }

  /**
   * Sends an alert email via the Resend API.
   * Requires RESEND_API_KEY and optionally ALERT_EMAIL_FROM env vars.
   */
  async sendEmail(to: string, subject: string, payload: NotificationPayload): Promise<void> {
    const apiKey = this.config.getOrThrow<string>('RESEND_API_KEY');
    const from = this.config.get<string>('ALERT_EMAIL_FROM', 'alerts@agentlens.ai');

    const html = [
      `<h2>🚨 AgentLens Alert: ${payload.alertName}</h2>`,
      `<table>`,
      `<tr><td><strong>Project</strong></td><td>${payload.projectName}</td></tr>`,
      `<tr><td><strong>Alert type</strong></td><td>${payload.alertType}</td></tr>`,
      `<tr><td><strong>Current value</strong></td><td>${payload.currentValue.toFixed(4)}</td></tr>`,
      `<tr><td><strong>Threshold</strong></td><td>${payload.threshold}</td></tr>`,
      `</table>`,
      `<p><a href="${payload.dashboardUrl}">View Dashboard →</a></p>`,
    ].join('\n');

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to, subject, html }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API error ${res.status}: ${body}`);
    }
  }

  /**
   * POSTs a structured JSON payload to an arbitrary HTTPS endpoint.
   * Retries up to 3 times with exponential backoff before throwing.
   */
  async sendWebhook(url: string, payload: NotificationPayload): Promise<void> {
    const body = {
      event: 'alert.fired',
      timestamp: new Date().toISOString(),
      ...payload,
    };

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          throw new Error(`Webhook endpoint returned HTTP ${res.status}`);
        }
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          `Webhook attempt ${attempt + 1}/3 failed for ${url}: ${lastError.message}`,
        );
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt));
        }
      }
    }
    throw lastError;
  }
}
