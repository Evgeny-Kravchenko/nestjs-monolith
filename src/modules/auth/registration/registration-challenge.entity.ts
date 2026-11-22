import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

// Relative on purpose: the TypeORM CLI loads entities without tsconfig-paths, so `@/` breaks there
import { User } from '../../users/user.entity';

import { RegistrationMethod } from './registration-method.enum';

@Entity('registration_challenges')
@Check('CHK_registration_challenges_attempts', 'attempts BETWEEN 0 AND 5')
@Index('UQ_registration_challenges_user_id', ['userId'], { unique: true })
@Index('UQ_registration_challenges_magic_link_secret', ['secretHash'], {
  unique: true,
  where: "method = 'magic_link'",
})
export class RegistrationChallenge {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({
    type: 'enum',
    enum: RegistrationMethod,
    enumName: 'registration_challenges_method_enum',
  })
  method!: RegistrationMethod;

  @Column({ name: 'secret_hash', type: 'char', length: 64 })
  secretHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'last_sent_at', type: 'timestamptz', nullable: true })
  lastSentAt!: Date | null;

  @Column({ type: 'smallint', default: 0 })
  attempts!: number;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
