import {
  Entity, Column, OneToOne, JoinColumn, UpdateDateColumn, PrimaryColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('streaks')
export class Streak {
  @PrimaryColumn({ name: 'user_id' })
  userId: string;

  @Column({ default: 0 })
  days: number;

  @Column({ name: 'last_log', type: 'date', nullable: true })
  lastLog: string | null; // YYYY-MM-DD

  @Column({ name: 'grace_used', default: false })
  graceUsed: boolean;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToOne(() => User, (user) => user.streak, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
