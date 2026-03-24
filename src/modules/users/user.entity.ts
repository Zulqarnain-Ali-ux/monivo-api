import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
  OneToMany, OneToOne,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Entry } from '../entries/entry.entity';
import { BudgetCategory } from '../budget/budget-category.entity';
import { Income } from '../income/income.entity';
import { Streak } from '../streak/streak.entity';
import { Goal } from '../goals/goal.entity';
import { PlaidItem } from '../plaid/plaid-item.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 255 })
  email: string;

  @Column({ name: 'password_hash', length: 255 })
  @Exclude()
  passwordHash: string;

  @Column({ name: 'fname', length: 100 })
  fname: string;

  @Column({ name: 'lname', length: 100, nullable: true })
  lname: string | null;

  @Column({ length: 10, nullable: true })
  initials: string | null;

  @Column({ name: 'email_verified', default: false })
  emailVerified: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'refresh_token_hash', nullable: true })
  @Exclude()
  refreshTokenHash: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @OneToMany(() => Entry, (entry) => entry.user)
  entries: Entry[];

  @OneToMany(() => BudgetCategory, (cat) => cat.user)
  budgetCategories: BudgetCategory[];

  @OneToOne(() => Income, (income) => income.user)
  income: Income;

  @OneToOne(() => Streak, (streak) => streak.user)
  streak: Streak;

  @OneToMany(() => Goal, (goal) => goal.user)
  goals: Goal[];

  @OneToMany(() => PlaidItem, (item) => item.user)
  plaidItems: PlaidItem[];
}
