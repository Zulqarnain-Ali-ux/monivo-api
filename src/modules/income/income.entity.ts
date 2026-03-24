import {
  Entity, PrimaryGeneratedColumn, Column,
  OneToOne, JoinColumn, UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('income')
export class Income {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', unique: true })
  userId: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  salary: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  side: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  passive: number;

  @Column({ name: 'savings_goal', type: 'numeric', precision: 10, scale: 2, default: 0 })
  savingsGoal: number;

  @Column({ name: 'invest_goal', type: 'numeric', precision: 10, scale: 2, default: 0 })
  investGoal: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToOne(() => User, (user) => user.income, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
