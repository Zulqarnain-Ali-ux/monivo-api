import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Streak } from './streak.entity';

@Injectable()
export class StreakService {
  constructor(
    @InjectRepository(Streak) private streakRepo: Repository<Streak>,
  ) {}

  async get(userId: string): Promise<Streak> {
    let streak = await this.streakRepo.findOne({ where: { userId } });
    if (!streak) {
      streak = this.streakRepo.create({ userId, days: 0, lastLog: null, graceUsed: false });
      await this.streakRepo.save(streak);
    }
    return streak;
  }

  /**
   * Called after every log entry.
   * Mirrors the frontend updateStreak() function exactly:
   *   - same day → no change
   *   - yesterday → increment
   *   - 2 days ago + grace not used → increment + mark grace used
   *   - otherwise → reset to 1
   */
  async update(userId: string, logDateStr: string): Promise<Streak> {
    const streak = await this.get(userId);
    const logDate = logDateStr; // YYYY-MM-DD

    if (streak.lastLog === logDate) return streak; // already logged today

    const yesterday = this.offsetDate(logDate, -1);
    const twoDaysAgo = this.offsetDate(logDate, -2);

    if (streak.lastLog === yesterday) {
      streak.days += 1;
      streak.graceUsed = false;
    } else if (streak.lastLog === twoDaysAgo && !streak.graceUsed) {
      streak.days += 1;
      streak.graceUsed = true;
    } else if (streak.lastLog) {
      streak.days = 1;
      streak.graceUsed = false;
    } else {
      streak.days = 1;
    }

    streak.lastLog = logDate;
    return this.streakRepo.save(streak);
  }

  private offsetDate(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
}
