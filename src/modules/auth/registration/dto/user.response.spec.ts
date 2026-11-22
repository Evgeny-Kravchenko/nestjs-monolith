import { User } from '@/modules/users/user.entity';
import { UserStatus } from '@/modules/users/user-status.enum';

import { UserResponse } from './user.response';

describe('UserResponse', () => {
  it('should expose only id, email and status', () => {
    const user = Object.assign(new User(), {
      id: 'user-id',
      email: 'new@example.com',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$salt$hash',
      status: UserStatus.Active,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = UserResponse.from(user);

    expect(JSON.parse(JSON.stringify(response))).toEqual({
      id: 'user-id',
      email: 'new@example.com',
      status: 'active',
    });
  });
});
