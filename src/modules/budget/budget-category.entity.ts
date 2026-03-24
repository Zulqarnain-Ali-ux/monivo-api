import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, UpdateDateColumn, Index,
} from 'typeorm';
import { User } from '../users/user.entity';

export type BudgetGroup = 'fixed' | 'variable' | 'financial';

@Entity('budget_categories')
@Index(['userId'])
export class BudgetCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'cat_id', length: 50 })
  catId: string; // 'rent', 'groc', 'dining' etc

  @Column({ length: 100 })
  name: string;

  @Column({ name: 'group_type', length: 20 })
  groupType: BudgetGroup;

  @Column({ name: 'cat_key', length: 100, nullable: true })
  catKey: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  amount: number;

  @Column({ length: 10, nullable: true })
  icon: string | null;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.budgetCategories, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
