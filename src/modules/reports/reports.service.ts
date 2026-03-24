import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Entry } from '../entries/entry.entity';
import { BudgetCategory } from '../budget/budget-category.entity';
import { Income } from '../income/income.entity';

export interface CategoryTotal  { category: string; total: number; count: number }
export interface MonthSummary   { month: string; total: number; byCategory: CategoryTotal[] }
export interface DailySummary   { date: string; total: number }
export interface BenchmarkRow   { category: string; yours: number; avg: number; isOver: boolean }

const PEER_AVERAGES: Record<string, number> = {
  dining: 320, groceries: 280, transport: 180, shopping: 240, fun: 150, health: 90,
};

@Injectable()
export class ReportsService {
  constructor(
    private dataSource: DataSource,
    @InjectRepository(Entry) private entryRepo: Repository<Entry>,
    @InjectRepository(BudgetCategory) private budgetRepo: Repository<BudgetCategory>,
    @InjectRepository(Income) private incomeRepo: Repository<Income>,
  ) {}

  async monthlySummary(userId: string, months = 6): Promise<MonthSummary[]> {
    const rows = await this.dataSource.query<
      Array<{ month: string; category: string; total: string; cnt: string }>
    >(
      `SELECT TO_CHAR(entry_date,'YYYY-MM') AS month, category,
              SUM(amount)::numeric AS total, COUNT(*)::int AS cnt
       FROM entries
       WHERE user_id = $1
         AND entry_date >= DATE_TRUNC('month', NOW()) - INTERVAL '${months - 1} months'
       GROUP BY month, category ORDER BY month ASC, total DESC`,
      [userId],
    );
    const map = new Map<string, MonthSummary>();
    for (const r of rows) {
      if (!map.has(r.month)) map.set(r.month, { month: r.month, total: 0, byCategory: [] });
      const s = map.get(r.month)!;
      const t = parseFloat(r.total);
      s.total += t;
      s.byCategory.push({ category: r.category, total: t, count: Number(r.cnt) });
    }
    return Array.from(map.values());
  }

  async currentMonthBreakdown(userId: string) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const dayOfMonth  = now.getDate();
    const monthStr    = `${year}-${String(month).padStart(2, '0')}`;

    const [catRows, budget, income] = await Promise.all([
      this.dataSource.query<Array<{ category: string; total: string; cnt: string }>>(
        `SELECT category, SUM(amount)::numeric AS total, COUNT(*)::int AS cnt
         FROM entries WHERE user_id=$1 AND TO_CHAR(entry_date,'YYYY-MM')=$2
         GROUP BY category ORDER BY total DESC`,
        [userId, monthStr],
      ),
      this.budgetRepo.find({ where: { userId }, order: { sortOrder: 'ASC' } }),
      this.incomeRepo.findOne({ where: { userId } }),
    ]);

    const byCategory: CategoryTotal[] = catRows.map(r => ({
      category: r.category, total: parseFloat(r.total), count: Number(r.cnt),
    }));
    const totalSpent     = byCategory.reduce((s, c) => s + c.total, 0);
    const totalIncome    = income ? Number(income.salary) + Number(income.side) + Number(income.passive) : 0;
    const variableMonthly = budget.filter(c => c.groupType === 'variable').reduce((s,c)=>s+Number(c.amount),0);

    return {
      total: totalSpent, byCategory,
      budget: budget.map(c => ({ catId: c.catId, name: c.name, amount: Number(c.amount), groupType: c.groupType })),
      income: { total: totalIncome, savingsGoal: income ? Number(income.savingsGoal) + Number(income.investGoal) : 0 },
      dailyAllowance: variableMonthly / daysInMonth,
      daysInMonth, dayOfMonth,
    };
  }

  async dailyTotals(userId: string, from: string, to: string): Promise<DailySummary[]> {
    const rows = await this.dataSource.query<Array<{ date: string; total: string }>>(
      `SELECT entry_date::text AS date, SUM(amount)::numeric AS total
       FROM entries WHERE user_id=$1 AND entry_date BETWEEN $2 AND $3
       GROUP BY entry_date ORDER BY entry_date ASC`,
      [userId, from, to],
    );
    return rows.map(r => ({ date: r.date, total: parseFloat(r.total) }));
  }

  async benchmarks(userId: string): Promise<BenchmarkRow[]> {
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const rows = await this.dataSource.query<Array<{ category: string; total: string }>>(
      `SELECT category, SUM(amount)::numeric AS total
       FROM entries WHERE user_id=$1 AND TO_CHAR(entry_date,'YYYY-MM')=$2 AND category=ANY($3)
       GROUP BY category`,
      [userId, monthStr, Object.keys(PEER_AVERAGES)],
    );
    const yourMap = new Map(rows.map(r => [r.category, parseFloat(r.total)]));
    return Object.entries(PEER_AVERAGES).map(([cat, avg]) => {
      const yours = yourMap.get(cat) ?? 0;
      return { category: cat, yours, avg, isOver: yours >= avg * 1.1 };
    });
  }

  async weeklySummary(userId: string, weekStart: string, weekEnd: string) {
    const [rows, budget] = await Promise.all([
      this.dataSource.query<Array<{ category: string; total: string }>>(
        `SELECT category, SUM(amount)::numeric AS total
         FROM entries WHERE user_id=$1 AND entry_date BETWEEN $2 AND $3
         GROUP BY category ORDER BY total DESC`,
        [userId, weekStart, weekEnd],
      ),
      this.budgetRepo.find({ where: { userId, groupType: 'variable' } }),
    ]);
    const totalSpent = rows.reduce((s,r)=>s+parseFloat(r.total), 0);
    const weekBudget = (budget.reduce((s,c)=>s+Number(c.amount),0)/30)*7;
    return {
      weekStart, weekEnd, totalSpent, weekBudget,
      difference: totalSpent - weekBudget,
      topCategories: rows.slice(0,4).map(r=>({ category:r.category, total:parseFloat(r.total) })),
      savingsOpportunity: Math.max(0, Math.abs(totalSpent-weekBudget)*0.5),
    };
  }
}
