import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import * as AWS from 'aws-sdk';

export type EmailJob =
  | { type: 'welcome';        to: string; fname: string }
  | { type: 'weekly-report';  to: string; fname: string; summary: WeeklySummaryData }
  | { type: 'streak-alert';   to: string; fname: string; streakDays: number }
  | { type: 'over-budget';    to: string; fname: string; category: string; amount: number }
  | { type: 'password-reset'; to: string; fname: string; resetUrl: string };

export interface WeeklySummaryData {
  weekStart: string; weekEnd: string;
  totalSpent: number; weekBudget: number; difference: number;
  topCategories: Array<{ category: string; total: number }>;
  savingsOpportunity: number;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly ses: AWS.SES;
  private readonly from: string;

  constructor(
    @InjectQueue('notifications') private queue: Queue<EmailJob>,
    private configService: ConfigService,
  ) {
    this.ses = new AWS.SES({ region: configService.get<string>('notifications.sesRegion') });
    this.from = configService.get<string>('notifications.fromEmail') ?? 'noreply@monivo.ai';
  }

  async queueWelcome(to: string, fname: string): Promise<void> {
    await this.queue.add({ type: 'welcome', to, fname }, { attempts: 3, backoff: 5000 });
  }

  async queueWeeklyReport(to: string, fname: string, summary: WeeklySummaryData): Promise<void> {
    await this.queue.add({ type: 'weekly-report', to, fname, summary }, { attempts: 3, backoff: 10000 });
  }

  async queueStreakAlert(to: string, fname: string, streakDays: number): Promise<void> {
    await this.queue.add({ type: 'streak-alert', to, fname, streakDays }, { attempts: 3, backoff: 5000 });
  }

  async queuePasswordReset(to: string, fname: string, resetUrl: string): Promise<void> {
    await this.queue.add({ type: 'password-reset', to, fname, resetUrl }, { attempts: 3, backoff: 5000 });
  }

  async queueOverBudget(to: string, fname: string, category: string, amount: number): Promise<void> {
    await this.queue.add(
      { type: 'over-budget', to, fname, category, amount },
      { attempts: 3, backoff: 5000 },
    );
  }


  async send(job: EmailJob): Promise<void> {
    const { subject, html } = this.buildEmail(job);
    try {
      await this.ses.sendEmail({
        Source: `MONIVO <${this.from}>`,
        Destination: { ToAddresses: [job.to] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Html: { Data: html, Charset: 'UTF-8' } },
        },
      }).promise();
      this.logger.log(`Sent ${job.type} → ${job.to}`);
    } catch (e) {
      this.logger.error(`Failed ${job.type} → ${job.to}`, e);
      throw e;
    }
  }

  private buildEmail(job: EmailJob): { subject: string; html: string } {
    switch (job.type) {
      case 'welcome':
        return { subject: 'Welcome to MONIVO', html: this.welcomeTemplate(job.fname) };
      case 'weekly-report':
        return { subject: `Your week with money - ${job.summary.weekStart}`, html: this.weeklyTemplate(job.fname, job.summary) };
      case 'streak-alert':
        return { subject: `${job.streakDays}-day streak - keep it going`, html: this.streakTemplate(job.fname, job.streakDays) };
      case 'over-budget':
        return { subject: `Heads up: ${job.category} is over budget`, html: this.overBudgetTemplate(job.fname, job.category, job.amount) };
      case 'password-reset':
        return { subject: 'Reset your MONIVO password', html: this.passwordResetTemplate(job.fname, job.resetUrl) };
    }
  }

  private base(content: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;background:#0F0E0C;color:#F2EFE8;margin:0;padding:0}
  .wrap{max-width:560px;margin:0 auto;padding:32px 24px}
  .logo{color:#C9A84C;font-size:24px;font-weight:bold;margin-bottom:24px}
  .card{background:#1A1916;border-radius:12px;padding:24px;margin:16px 0}
  .teal{color:#2DC98A}.gray{color:#6E6B64;font-size:13px}
  .btn{display:inline-block;background:#C9A84C;color:#0F0E0C;padding:12px 28px;border-radius:99px;text-decoration:none;font-weight:600;margin-top:16px}
  .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #252320;font-size:14px}
</style></head>
<body><div class="wrap">
  <div class="logo">MONIVO</div>
  ${content}
  <p class="gray" style="margin-top:32px;">monivo.ai</p>
</div></body></html>`;
  }

  private welcomeTemplate(fname: string): string {
    const url = this.configService.get<string>('app.frontendUrl') ?? 'https://monivo.ai';
    return this.base(`
      <h2>Welcome, ${fname}</h2>
      <p>Your daily spending intelligence is ready. Every day, MONIVO tells you one number: how much you can safely spend today.</p>
      <a href="${url}" class="btn">Open MONIVO</a>`);
  }

  private weeklyTemplate(fname: string, s: WeeklySummaryData): string {
    const url = this.configService.get<string>('app.frontendUrl') ?? 'https://monivo.ai';
    const color = s.difference > 0 ? '#E05252' : '#2DC98A';
    const sign  = s.difference > 0 ? '+' : '';
    const rows  = s.topCategories.map(c =>
      `<div class="row"><span style="text-transform:capitalize">${c.category}</span><span>$${c.total.toFixed(0)}</span></div>`
    ).join('');
    return this.base(`
      <h2>Your week with money</h2>
      <p class="gray">${s.weekStart} to ${s.weekEnd}</p>
      <div class="card">
        <div class="row"><span>Spent</span><span>$${s.totalSpent.toFixed(0)}</span></div>
        <div class="row"><span>Budget</span><span>$${s.weekBudget.toFixed(0)}</span></div>
        <div class="row"><span>Difference</span><span style="color:${color}">${sign}$${Math.abs(s.difference).toFixed(0)}</span></div>
      </div>
      ${rows ? `<div class="card">${rows}</div>` : ''}
      <a href="${url}" class="btn">View full report</a>`);
  }

  private streakTemplate(fname: string, days: number): string {
    const url = this.configService.get<string>('app.frontendUrl') ?? 'https://monivo.ai';
    return this.base(`
      <h2>${days}-day streak</h2>
      <p>Logging every day is the single most powerful financial habit. You are still here.</p>
      <a href="${url}" class="btn">Log today</a>`);
  }

  private overBudgetTemplate(fname: string, category: string, amount: number): string {
    const url = this.configService.get<string>('app.frontendUrl') ?? 'https://monivo.ai';
    return this.base(`
      <h2>Heads up, ${fname}</h2>
      <p>Your <strong>${category}</strong> spending is $${amount.toFixed(0)} over budget this month.</p>
      <a href="${url}" class="btn">Review budget</a>`);
  }

  private passwordResetTemplate(fname: string, resetUrl: string): string {
    return this.base(`
      <h2>Reset your password</h2>
      <p>Hi ${fname}, we received a request to reset your MONIVO password.</p>
      <p>Click the button below. This link expires in 30 minutes.</p>
      <a href="${resetUrl}" class="btn">Reset password</a>
      <p class="gray" style="margin-top:24px;">If you did not request this, you can safely ignore this email. Your password has not changed.</p>`);
  }
}
