import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { User } from '../users/user.entity';
import { Streak } from '../streak/streak.entity';
import { ReportsService } from '../reports/reports.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectRepository(User)   private userRepo: Repository<User>,
    @InjectRepository(Streak) private streakRepo: Repository<Streak>,
    private reportsService: ReportsService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Weekly spending digest — every Sunday at 8 AM UTC.
   * Sends a personalised week-in-review email to every active user
   * who has logged at least one entry in the last 7 days.
   */
  @Cron('0 8 * * 0', { name: 'weekly-report', timeZone: 'UTC' })
  async sendWeeklyReports(): Promise<void> {
    this.logger.log('Starting weekly report batch');

    const now       = new Date();
    const weekEnd   = this.toDateStr(now);
    const weekStart = this.toDateStr(new Date(now.getTime() - 6 * 86_400_000));

    const users = await this.userRepo.find({
      where: { isActive: true, emailVerified: true },
      select: ['id', 'email', 'fname'],
    });

    let sent = 0, skipped = 0;

    for (const user of users) {
      try {
        const summary = await this.reportsService.weeklySummary(
          user.id, weekStart, weekEnd,
        );

        // Skip users with no spending this week
        if (summary.totalSpent === 0) { skipped++; continue; }

        await this.notificationsService.queueWeeklyReport(
          user.email, user.fname, summary,
        );
        sent++;
      } catch (e) {
        this.logger.error(`Weekly report failed for ${user.id}`, e);
      }
    }

    this.logger.log(`Weekly reports: ${sent} queued, ${skipped} skipped (no activity)`);
  }

  /**
   * Streak risk alerts — daily at 7 PM UTC.
   * Warns users who have a streak ≥ 3 but have NOT logged today,
   * so they have time to log before midnight and save their streak.
   */
  @Cron('0 19 * * *', { name: 'streak-alerts', timeZone: 'UTC' })
  async sendStreakAlerts(): Promise<void> {
    this.logger.log('Checking streak alerts');

    const today     = this.toDateStr(new Date());
    const yesterday = this.toDateStr(new Date(Date.now() - 86_400_000));

    // Users with streak >= 3 whose last log was YESTERDAY (not yet today)
    const atRisk = await this.streakRepo
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.user', 'u')
      .where('s.days >= :min', { min: 3 })
      .andWhere('s.last_log = :yesterday', { yesterday })
      .andWhere('u.is_active = true')
      .andWhere('u.email_verified = true')
      .getMany();

    let sent = 0;
    for (const streak of atRisk) {
      try {
        await this.notificationsService.queueStreakAlert(
          streak.user.email,
          streak.user.fname,
          streak.days,
        );
        sent++;
      } catch (e) {
        this.logger.error(`Streak alert failed for ${streak.userId}`, e);
      }
    }

    this.logger.log(`Streak alerts sent: ${sent} of ${atRisk.length} at-risk users`);
  }

  /**
   * Over-budget check — daily at 6 PM UTC.
   * Notifies users if any variable category is tracking > 20% over budget
   * with more than 5 days left in the month.
   */
  @Cron('0 18 * * *', { name: 'over-budget-alerts', timeZone: 'UTC' })
  async sendOverBudgetAlerts(): Promise<void> {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth  = now.getDate();
    const daysLeft    = daysInMonth - dayOfMonth;

    // Only alert if there are enough days left to course-correct
    if (daysLeft < 5) return;

    this.logger.log('Checking over-budget alerts');

    const users = await this.userRepo.find({
      where: { isActive: true, emailVerified: true },
      select: ['id', 'email', 'fname'],
    });

    let sent = 0;
    for (const user of users) {
      try {
        const summary = await this.reportsService.currentMonthBreakdown(user.id);
        const monthFraction = dayOfMonth / daysInMonth;

        // Check each budget category
        for (const cat of summary.budget) {
          if (cat.groupType !== 'variable' || cat.amount === 0) continue;

          const actual  = summary.byCategory.find(c => c.category === cat.catId)?.total ?? 0;
          const prorated = cat.amount * monthFraction;

          // Trigger at 20% over prorated budget
          if (actual > prorated * 1.20) {
            const overage = Math.round(actual - cat.amount);
            if (overage > 10) { // skip tiny overages
              await this.notificationsService.queueOverBudget(
                user.email, user.fname, cat.name, overage,
              );
              sent++;
              break; // one alert per user per day max
            }
          }
        }
      } catch (e) {
        this.logger.error(`Over-budget check failed for ${user.id}`, e);
      }
    }

    this.logger.log(`Over-budget alerts sent: ${sent}`);
  }

  private toDateStr(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
}
