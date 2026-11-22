import { ApiProperty } from '@nestjs/swagger';

import { User } from '@/modules/users/user.entity';
import { UserStatus } from '@/modules/users/user-status.enum';

export class UserResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email', example: 'new@example.com' })
  email!: string;

  @ApiProperty({ enum: [UserStatus.Active] })
  status!: UserStatus;

  static from(user: User): UserResponse {
    const response = new UserResponse();
    response.id = user.id;
    response.email = user.email;
    response.status = user.status;
    return response;
  }
}
