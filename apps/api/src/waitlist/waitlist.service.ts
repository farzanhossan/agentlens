import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WaitlistEntity } from './waitlist.entity.js';

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    @InjectRepository(WaitlistEntity)
    private readonly repo: Repository<WaitlistEntity>,
    private readonly config: ConfigService,
  ) {}

  async saveEmail(email: string): Promise<{ created: boolean }> {
    try {
      await this.repo.insert({ email, source: 'landing' });
    } catch (err: unknown) {
      // Postgres unique violation
      const pgCode = (err as { code?: string }).code;
      if (pgCode === '23505') return { created: false };
      throw err;
    }

    await this.sendWelcomeEmail(email);
    return { created: true };
  }

  private async sendWelcomeEmail(email: string): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey || apiKey === 're_skip') return;

    const from =
      this.config.get<string>('WAITLIST_EMAIL_FROM') ?? 'hello@agentlens.ai';

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: email,
          subject: "You're on the AgentLens waitlist 🎉",
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0a0a0a;color:#f4f4f5;border-radius:12px">
              <h2 style="color:#818cf8;margin-bottom:8px">You're on the list!</h2>
              <p style="color:#a1a1aa;line-height:1.6">
                Thanks for joining the AgentLens waitlist. We'll reach out as soon as
                we're ready to onboard you.
              </p>
              <p style="color:#a1a1aa;line-height:1.6;margin-top:16px">
                In the meantime, star us on GitHub and follow along:<br/>
                <a href="https://github.com/farzanhossan/agentlens" style="color:#818cf8">
                  github.com/farzanhossan/agentlens
                </a>
              </p>
              <p style="color:#52525b;font-size:13px;margin-top:32px">— The AgentLens team</p>
            </div>
          `,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        this.logger.warn(`Resend returned ${res.status}: ${body}`);
      }
    } catch (err: unknown) {
      this.logger.error(`Failed to send waitlist email to ${email}: ${String(err)}`);
    }
  }
}
