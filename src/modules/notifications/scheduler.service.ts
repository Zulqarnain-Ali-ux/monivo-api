import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User }   from '../users/user.entity';
import { Streak } from '../streak/streak.entity';
import { ReportsService }       from '../reports/reports.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectRepository(User)   private userRepo:   Repository<User>,
    @InjectRepository(Streak) private streakRepo: Repository<Streak>,
    private reportsService:       ReportsService,
    private notificationsService: NotificationsService,
  ) {}

  // ── Weekly report email — every Sunday at 8 AM UTC ───────────────
  @Cron('0 8 * * 0', { name: 'weekly-reports', timeZone: 'UTC' })
  async sendWeeklyReports(): Promise<void> {
    this.logger.log('Weekly report job started');

    const users = await this.userRepo.find({
      where: { isActive: true, emailVerified: true },
      select: ['id', 'email', 'fname'],
    });

    const now     = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(now.getDate() - 1); // yesterday = Saturday
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekEnd.getDate() - 6); // 7 days ago = last Sunday

    const wStart = weekStart.toISOString().slice(0, 10);
    const wEnd   = weekEnd.toISOString().slice(0, 10);

    let sent = 0;
    let skipped = 0;

    for (const user of users) {
      try {
        const summary = await this.reportsService.weeklySummary(user.id, wStart, wEnd);

        // Skip users with no activity this week
        if (summary.totalSpent === 0) { skipped++; continue; }

        await this.notificationsService.queueWeeklyReport(user.email, user.fname, summary);
        sent++;
      } catch (e) {
        this.logger.error(`Weekly report failed for user ${user.id}:`, e);
      }
    }

    this.logger.log(`Weekly reports: ${sent} queued, ${skipped} skipped (no activity)`);
  }

  // ── Streak at-risk reminder — every day at 6 PM UTC ──────────────
  // Fires for users whose streak is at risk (last log was yesterday,
  // and they haven't logged today yet).
  @Cron('0 18 * * *', { name: 'streak-reminders', timeZone: 'UTC' })
  async sendStreakReminders(): Promise<void> {
    this.logger.log('Streak reminder job started');

    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    // Find streaks where lastLog = yesterday and days >= 3 (worth protecting)
    const atRisk = await this.streakRepo.find({
      where: { lastLog: yesterday },
      relations: ['user'],
    });

    let sent = 0;
    for (const streak of atRisk) {
      if (!streak.user?.isActive || streak.days < 3) continue;
      try {
        await this.notificationsService.queueStreakAlert(
          streak.user.email,
          streak.user.fname,
          streak.days,
        );
        sent++;
      } catch (e) {
        this.logger.error(`Streak reminder failed for user ${streak.userId}:`, e);
      }
    }

    this.logger.log(`Streak reminders sent: ${sent}`);
  }

  // ── Over-budget alert — runs daily at noon UTC ───────────────────
  // Notifies users who are >20% over their variable budget with 7+ days left.
  @Cron('0 12 * * *', { name: 'over-budget-alerts', timeZone: 'UTC' })
  async sendOverBudgetAlerts(): Promise<void> {
    this.logger.log('Over-budget alert job started');

    const now      = new Date();
    const dayOfMonth  = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft    = daysInMonth - dayOfMonth;

    // Only alert if there are enough days left to course-correct
    if (daysLeft < 7) return;

    const users = await this.userRepo.find({
      where: { isActive: true },
      select: ['id', 'email', 'fname'],
    });

    let sent = 0;
    for (const user of users) {
      try {
        const summary = await this.reportsService.currentMonthBreakdown(user.id);

        // Find categories over budget by >20%
        const overspentCats = summary.budget
          .filter((cat) => cat.groupType === 'variable' && cat.amount > 0)
          .map((cat) => {
            const spent = summary.byCategory.find((c) => c.category === cat.catId)?.total ?? 0;
            const expected = cat.amount * (dayOfMonth / daysInMonth);
            return { name: cat.name, spent, expected, ratio: spent / expected };
          })
          .filter((c) => c.ratio > 1.2)
          .sort((a, b) => b.ratio - a.ratio);

        if (!overspentCats.length) continue;

        const worst = overspentCats[0];
        await this.notificationsService.queueOverBudget(
          user.email,
          user.fname,
          worst.name,
          Math.round(worst.spent - worst.expected),
        );
        sent++;
      } catch (e) {
        this.logger.error(`Over-budget alert failed for user ${user.id}:`, e);
      }
    }

    this.logger.log(`Over-budget alerts sent: ${sent}`);
  }
}
