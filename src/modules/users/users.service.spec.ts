import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { EmailAlreadyRegisteredError } from './email-already-registered.error';
import { User } from './user.entity';
import { UserStatus } from './user-status.enum';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let repository: jest.Mocked<
    Pick<Repository<User>, 'create' | 'save' | 'findOneBy' | 'update'>
  >;

  const email = 'new@example.com';
  const passwordHash = '$argon2id$v=19$m=19456,t=2,p=1$salt$hash';

  const uniqueViolation = (constraint: string) =>
    new QueryFailedError('INSERT INTO "users" ...', [], {
      code: '23505',
      constraint,
    } as unknown as Error);

  beforeEach(async () => {
    repository = {
      create: jest.fn((data) => data as User),
      save: jest.fn((user) =>
        Promise.resolve({ id: 'user-id', ...user } as User),
      ),
      findOneBy: jest.fn(),
      update: jest.fn(),
    } as unknown as typeof repository;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repository },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('createActive', () => {
    it('should persist an active user with the given email and hash', async () => {
      const user = await service.createActive(email, passwordHash);

      expect(repository.create).toHaveBeenCalledWith({
        email,
        passwordHash,
        status: UserStatus.Active,
      });
      expect(repository.save).toHaveBeenCalledTimes(1);
      expect(user).toMatchObject({
        id: 'user-id',
        email,
        status: UserStatus.Active,
      });
    });
  });

  describe('createPending', () => {
    it('should persist a pending user with the given email and hash', async () => {
      const user = await service.createPending(email, passwordHash);

      expect(repository.create).toHaveBeenCalledWith({
        email,
        passwordHash,
        status: UserStatus.Pending,
      });
      expect(user).toMatchObject({
        id: 'user-id',
        email,
        status: UserStatus.Pending,
      });
    });
  });

  describe('unique email violations', () => {
    it.each([
      ['createActive', () => service.createActive(email, passwordHash)],
      ['createPending', () => service.createPending(email, passwordHash)],
    ])(
      'should turn a UQ_users_email violation in %s into EmailAlreadyRegisteredError',
      async (_name, create) => {
        repository.save.mockRejectedValueOnce(
          uniqueViolation('UQ_users_email'),
        );

        await expect(create()).rejects.toBeInstanceOf(
          EmailAlreadyRegisteredError,
        );
      },
    );

    it('should rethrow a unique violation on another constraint unchanged', async () => {
      const error = uniqueViolation('PK_some_other_constraint');
      repository.save.mockRejectedValueOnce(error);

      await expect(service.createActive(email, passwordHash)).rejects.toBe(
        error,
      );
    });

    it('should rethrow other errors unchanged', async () => {
      const error = new Error('connection lost');
      repository.save.mockRejectedValueOnce(error);

      await expect(service.createPending(email, passwordHash)).rejects.toBe(
        error,
      );
    });
  });

  describe('findByEmail', () => {
    it('should look the user up by the given (already normalized) email', async () => {
      const stored = { id: 'user-id', email } as User;
      repository.findOneBy.mockResolvedValueOnce(stored);

      await expect(service.findByEmail(email)).resolves.toBe(stored);
      expect(repository.findOneBy).toHaveBeenCalledWith({ email });
    });

    it('should return null when no user has the email', async () => {
      repository.findOneBy.mockResolvedValueOnce(null);

      await expect(service.findByEmail(email)).resolves.toBeNull();
    });
  });

  describe('activate', () => {
    it('should set the user status to active', async () => {
      await service.activate('user-id');

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'user-id' },
        { status: UserStatus.Active },
      );
    });
  });
});
