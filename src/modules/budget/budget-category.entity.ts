import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
  Index,
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

  @Column({ name: 'cat_id', type: 'varchar', length: 50 })
  catId: string; // 'rent', 'groc', 'dining' etc

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'group_type', type: 'varchar', length: 20 })
  groupType: BudgetGroup;

  // ✅ FIXED (IMPORTANT)
  @Column({
    name: 'cat_key',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  catKey: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  amount: number;

  @Column({ type: 'varchar', length: 10, nullable: true })
  icon: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.budgetCategories, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
