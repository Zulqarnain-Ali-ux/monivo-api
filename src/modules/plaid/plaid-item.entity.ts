import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('plaid_items')
@Index(['userId'])
export class PlaidItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'plaid_item_id', unique: true })
  plaidItemId: string;

  // Stored encrypted via AWS KMS
  @Column({ name: 'access_token_encrypted' })
  accessTokenEncrypted: string;

  @Column({ name: 'institution_id', nullable: true })
  institutionId: string | null;

  @Column({ name: 'institution_name', nullable: true })
  institutionName: string | null;

  @Column({ name: 'cursor', nullable: true })
  cursor: string | null; // Plaid transaction sync cursor

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.plaidItems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
