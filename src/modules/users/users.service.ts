import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { EmailAlreadyRegisteredError } from './email-already-registered.error';
import { User } from './user.entity';
import { UserStatus } from './user-status.enum';

const UNIQUE_VIOLATION = '23505';
const EMAIL_UNIQUE_INDEX = 'UQ_users_email';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  createActive(email: string, passwordHash: string): Promise<User> {
    return this.create(email, passwordHash, UserStatus.Active);
  }

  createPending(email: string, passwordHash: string): Promise<User> {
    return this.create(email, passwordHash, UserStatus.Pending);
  }

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ email });
  }

  async activate(userId: string): Promise<void> {
    await this.usersRepository.update(
      { id: userId },
      { status: UserStatus.Active },
    );
  }

  private async create(
    email: string,
    passwordHash: string,
    status: UserStatus,
  ): Promise<User> {
    const user = this.usersRepository.create({ email, passwordHash, status });

    try {
      return await this.usersRepository.save(user);
    } catch (error) {
      if (isEmailUniqueViolation(error)) {
        throw new EmailAlreadyRegisteredError();
      }
      throw error;
    }
  }
}

function isEmailUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = error.driverError as {
    code?: string;
    constraint?: string;
  };
  return (
    driverError.code === UNIQUE_VIOLATION &&
    driverError.constraint === EMAIL_UNIQUE_INDEX
  );
}
