/**
 * Demo account seed — run once after first migration:
 *   npx ts-node src/database/seeds/demo.seed.ts
 *
 * Creates demo@monivo.ai with 6 months of realistic spending data.
 */
import { AppDataSource } from '../data-source';
import * as bcrypt from 'bcrypt';
import { User } from '../../modules/users/user.entity';
import { Income } from '../../modules/income/income.entity';
import { Streak } from '../../modules/streak/streak.entity';
import { BudgetCategory } from '../../modules/budget/budget-category.entity';
import { Entry } from '../../modules/entries/entry.entity';
import { defaultBudgetCategories } from '../../modules/budget/budget.defaults';

async function seed() {
  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();
  await qr.startTransaction();

  try {
    const userRepo   = AppDataSource.getRepository(User);
    const incomeRepo = AppDataSource.getRepository(Income);
    const streakRepo = AppDataSource.getRepository(Streak);
    const budgetRepo = AppDataSource.getRepository(BudgetCategory);
    const entryRepo  = AppDataSource.getRepository(Entry);

    // Idempotent — skip if already seeded
    const existing = await userRepo.findOne({ where: { email: 'demo@monivo.ai' } });
    if (existing) {
      console.log('Demo account already exists — skipping seed');
      await qr.rollbackTransaction();
      return;
    }

    // ── User ──────────────────────────────────────────────────────
    const passwordHash = await bcrypt.hash('demo-password', 10);
    const user = await userRepo.save(userRepo.create({
      email: 'demo@monivo.ai', passwordHash,
      fname: 'Alex', lname: 'Chen', initials: 'AC',
    }));
    console.log(`Created user: ${user.id}`);

    // ── Income ────────────────────────────────────────────────────
    await incomeRepo.save(incomeRepo.create({
      userId: user.id, salary: 5200, side: 800, passive: 200,
      savingsGoal: 600, investGoal: 300,
    }));

    // ── Budget ────────────────────────────────────────────────────
    const cats = defaultBudgetCategories(6200).map((c, i) =>
      budgetRepo.create({ ...c, userId: user.id, sortOrder: i }),
    );
    await budgetRepo.save(cats);

    // ── Streak ────────────────────────────────────────────────────
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await streakRepo.save(streakRepo.create({
      userId: user.id, days: 6,
      lastLog: yesterday.toISOString().slice(0, 10),
      graceUsed: false,
    }));

    // ── Entries: 6 months of realistic data ───────────────────────
    const categories = [
      'dining', 'groceries', 'transport', 'fun', 'shopping',
      'health', 'dining', 'groceries', 'dining', 'transport',
    ];
    const amounts = [
      5.50, 14.00, 3.25, 47.80, 22.00, 6.00, 12.50, 8.00,
      3.50, 38.00, 15.50, 4.75, 31.00, 9.50, 6.50, 55.00,
      18.00, 7.00, 42.00, 11.00, 28.00, 13.50, 9.00, 67.00,
    ];
    const notes = [
      'Blue Bottle Coffee', 'Chipotle', 'Uber', 'Whole Foods', 'Netflix',
      'Starbucks', 'Sweetgreen', 'Gym class', 'CVS Pharmacy', 'Target',
      'Trader Joes', 'Lyft', 'Spotify', 'Amazon', 'Corner Bistro',
    ];

    const entries: Partial<Entry>[] = [];
    const now = new Date();
    let ai = 0;

    // 6 months back
    for (let monthsBack = 5; monthsBack >= 0; monthsBack--) {
      const daysInMonth = monthsBack === 0
        ? now.getDate() - 1   // current month: up to yesterday
        : new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 0).getDate();

      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(now.getFullYear(), now.getMonth() - monthsBack, day);
        const dateStr = date.toISOString().slice(0, 10);
        const logsThisDay = Math.random() < 0.7 ? Math.floor(Math.random() * 3) + 1 : 0;

        for (let l = 0; l < logsThisDay; l++) {
          entries.push({
            userId: user.id,
            amount: amounts[ai % amounts.length] * (0.8 + Math.random() * 0.4),
            category: categories[ai % categories.length],
            entryDate: dateStr,
            entryTs: date.getTime() + l * 3_600_000,
            note: notes[ai % notes.length],
          });
          ai++;
        }
      }
    }

    // Round amounts to 2dp
    for (const e of entries) {
      e.amount = Math.round((e.amount as number) * 100) / 100;
    }

    await entryRepo.save(entries.map(e => entryRepo.create(e)));
    console.log(`Seeded ${entries.length} entries across 6 months`);

    await qr.commitTransaction();
    console.log('Demo seed complete');
  } catch (err) {
    await qr.rollbackTransaction();
    console.error('Seed failed — rolled back:', err);
    process.exit(1);
  } finally {
    await AppDataSource.destroy();
  }
}

void seed();
