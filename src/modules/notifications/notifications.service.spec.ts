import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken }   from '@nestjs/bull';
import { ConfigService }   from '@nestjs/config';
import { NotificationsService, EmailJob, WeeklySummaryData } from './notifications.service';

// ── Mocks ────────────────────────────────────────────────────────
const mockQueue = () => ({
  add: jest.fn().mockResolvedValue({ id: 'job-1' }),
});

const mockConfig = () => ({
  get: jest.fn((key: string) => {
    const m: Record<string, string> = {
      'notifications.sesRegion':  'us-east-1',
      'notifications.fromEmail':  'noreply@monivo.ai',
      'app.frontendUrl':          'https://monivo.ai',
    };
    return m[key] ?? '';
  }),
});

const mockSes = () => ({
  sendEmail: jest.fn().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) }),
});

const WEEKLY: WeeklySummaryData = {
  weekStart: '2026-03-09', weekEnd: '2026-03-15',
  totalSpent: 420, weekBudget: 350, difference: 70,
  topCategories: [{ category: 'dining', total: 200 }, { category: 'groceries', total: 120 }],
  savingsOpportunity: 35,
};

describe('NotificationsService', () => {
  let service: NotificationsService;
  let queue: ReturnType<typeof mockQueue>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getQueueToken('notifications'), useFactory: mockQueue },
        { provide: ConfigService,                 useFactory: mockConfig },
      ],
    }).compile();

    service = module.get(NotificationsService);
    queue   = module.get(getQueueToken('notifications'));

    // Replace the real SES client with a mock (injected post-construction)
    (service as unknown as { ses: ReturnType<typeof mockSes> }).ses = mockSes();
  });

  // ── Queue helpers ────────────────────────────────────────────────
  describe('queueWelcome()', () => {
    it('adds a welcome job to the queue with correct payload', async () => {
      await service.queueWelcome('jane@test.com', 'Jane');
      expect(queue.add).toHaveBeenCalledWith(
        { type: 'welcome', to: 'jane@test.com', fname: 'Jane' },
        { attempts: 3, backoff: 5000 },
      );
    });
  });

  describe('queueWeeklyReport()', () => {
    it('adds a weekly-report job with summary data', async () => {
      await service.queueWeeklyReport('jane@test.com', 'Jane', WEEKLY);
      expect(queue.add).toHaveBeenCalledWith(
        { type: 'weekly-report', to: 'jane@test.com', fname: 'Jane', summary: WEEKLY },
        { attempts: 3, backoff: 10000 },
      );
    });
  });

  describe('queueStreakAlert()', () => {
    it('adds a streak-alert job with day count', async () => {
      await service.queueStreakAlert('jane@test.com', 'Jane', 7);
      expect(queue.add).toHaveBeenCalledWith(
        { type: 'streak-alert', to: 'jane@test.com', fname: 'Jane', streakDays: 7 },
        { attempts: 3, backoff: 5000 },
      );
    });
  });

  describe('queuePasswordReset()', () => {
    it('adds a password-reset job with reset URL', async () => {
      await service.queuePasswordReset('jane@test.com', 'Jane', 'https://monivo.ai/reset?token=abc');
      expect(queue.add).toHaveBeenCalledWith(
        { type: 'password-reset', to: 'jane@test.com', fname: 'Jane', resetUrl: 'https://monivo.ai/reset?token=abc' },
        { attempts: 3, backoff: 5000 },
      );
    });
  });

  // ── Email send (called by Bull processor) ────────────────────────
  describe('send()', () => {
    it('sends welcome email with correct subject', async () => {
      const ses = (service as unknown as { ses: ReturnType<typeof mockSes> }).ses;
      const job: EmailJob = { type: 'welcome', to: 'jane@test.com', fname: 'Jane' };
      await service.send(job);
      expect(ses.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          Destination: { ToAddresses: ['jane@test.com'] },
          Message: expect.objectContaining({
            Subject: expect.objectContaining({ Data: 'Welcome to MONIVO' }),
          }),
        }),
      );
    });

    it('sends weekly report email with correct subject', async () => {
      const ses = (service as unknown as { ses: ReturnType<typeof mockSes> }).ses;
      const job: EmailJob = { type: 'weekly-report', to: 'j@test.com', fname: 'Jane', summary: WEEKLY };
      await service.send(job);
      const call = (ses.sendEmail as jest.Mock).mock.calls[0][0] as { Message: { Subject: { Data: string } } };
      expect(call.Message.Subject.Data).toContain('2026-03-09');
    });

    it('sends streak alert with day count in subject', async () => {
      const ses = (service as unknown as { ses: ReturnType<typeof mockSes> }).ses;
      await service.send({ type: 'streak-alert', to: 'j@test.com', fname: 'Jane', streakDays: 14 });
      const call = (ses.sendEmail as jest.Mock).mock.calls[0][0] as { Message: { Subject: { Data: string } } };
      expect(call.Message.Subject.Data).toContain('14');
    });

    it('sends over-budget alert with category name in subject', async () => {
      const ses = (service as unknown as { ses: ReturnType<typeof mockSes> }).ses;
      await service.send({ type: 'over-budget', to: 'j@test.com', fname: 'Jane', category: 'dining', amount: 85 });
      const call = (ses.sendEmail as jest.Mock).mock.calls[0][0] as { Message: { Subject: { Data: string } } };
      expect(call.Message.Subject.Data).toContain('dining');
    });

    it('sends password reset email with link in body', async () => {
      const ses = (service as unknown as { ses: ReturnType<typeof mockSes> }).ses;
      await service.send({ type: 'password-reset', to: 'j@test.com', fname: 'Jane', resetUrl: 'https://monivo.ai/reset?t=abc' });
      const call = (ses.sendEmail as jest.Mock).mock.calls[0][0] as { Message: { Body: { Html: { Data: string } } } };
      expect(call.Message.Body.Html.Data).toContain('https://monivo.ai/reset?t=abc');
    });

    it('throws when SES send fails (so Bull retries the job)', async () => {
      const ses = (service as unknown as { ses: ReturnType<typeof mockSes> }).ses;
      ses.sendEmail.mockReturnValue({ promise: jest.fn().mockRejectedValue(new Error('SES throttled')) });
      await expect(service.send({ type: 'welcome', to: 'j@test.com', fname: 'Jane' }))
        .rejects.toThrow('SES throttled');
    });
  });

  // ── Email template content ────────────────────────────────────────
  describe('email template content', () => {
    it('welcome email contains frontend URL as CTA', async () => {
      const ses = (service as unknown as { ses: ReturnType<typeof mockSes> }).ses;
      await service.send({ type: 'welcome', to: 'j@test.com', fname: 'Jane' });
      const body = (ses.sendEmail as jest.Mock).mock.calls[0][0].Message.Body.Html.Data as string;
      expect(body).toContain('https://monivo.ai');
      expect(body).toContain('Jane');
    });

    it('weekly report shows correct spending comparison', async () => {
      const ses = (service as unknown as { ses: ReturnType<typeof mockSes> }).ses;
      await service.send({ type: 'weekly-report', to: 'j@test.com', fname: 'Jane', summary: WEEKLY });
      const body = (ses.sendEmail as jest.Mock).mock.calls[0][0].Message.Body.Html.Data as string;
      expect(body).toContain('420');     // total spent
      expect(body).toContain('350');     // budget
      expect(body).toContain('dining');  // top category
    });

    it('weekly report shows positive difference in red color', async () => {
      const ses = (service as unknown as { ses: ReturnType<typeof mockSes> }).ses;
      await service.send({ type: 'weekly-report', to: 'j@test.com', fname: 'Jane', summary: { ...WEEKLY, difference: 70 } });
      const body = (ses.sendEmail as jest.Mock).mock.calls[0][0].Message.Body.Html.Data as string;
      expect(body).toContain('#E05252');  // over-budget red
    });

    it('weekly report shows negative difference in teal color', async () => {
      const ses = (service as unknown as { ses: ReturnType<typeof mockSes> }).ses;
      await service.send({ type: 'weekly-report', to: 'j@test.com', fname: 'Jane', summary: { ...WEEKLY, difference: -50 } });
      const body = (ses.sendEmail as jest.Mock).mock.calls[0][0].Message.Body.Html.Data as string;
      expect(body).toContain('#2DC98A');  // under-budget teal
    });

    it('all emails contain MONIVO branding in base template', async () => {
      const ses = (service as unknown as { ses: ReturnType<typeof mockSes> }).ses;
      for (const job of [
        { type: 'welcome' as const,        to: 'j@test.com', fname: 'J' },
        { type: 'streak-alert' as const,   to: 'j@test.com', fname: 'J', streakDays: 5 },
        { type: 'over-budget' as const,    to: 'j@test.com', fname: 'J', category: 'dining', amount: 50 },
        { type: 'password-reset' as const, to: 'j@test.com', fname: 'J', resetUrl: 'https://x' },
      ] satisfies EmailJob[]) {
        (ses.sendEmail as jest.Mock).mockClear();
        await service.send(job);
        const body = (ses.sendEmail as jest.Mock).mock.calls[0][0].Message.Body.Html.Data as string;
        expect(body).toContain('MONIVO');
      }
    });
  });
});
