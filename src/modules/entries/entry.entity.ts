import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, CreateDateColumn, Index,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('entries')
@Index(['userId', 'entryDate'])
export class Entry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  amount: number;

  @Column({ length: 100 })
  category: string;

  @Column({ name: 'entry_date', type: 'date' })
  entryDate: string; // YYYY-MM-DD

  @Column({ name: 'entry_ts', type: 'bigint' })
  entryTs: number; // unix ms for sub-day ordering

  @Column({ length: 500, default: '' })
  note: string;

  @Column({ name: 'plaid_transaction_id', nullable: true, unique: true })
  plaidTransactionId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.entries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
