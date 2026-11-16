import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

import { IsPasswordPolicy } from '../password-policy.validator';

export class RegisterDto {
  @ApiProperty({
    description: 'Trimmed and lowercased before validation and storage',
    example: '  New@Example.com ',
    format: 'email',
    maxLength: 254,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    description:
      'At least 8 characters, at least one letter (any alphabet) and one digit, at most 72 bytes UTF-8. Surrounding whitespace is part of the password.',
    example: 'секрет12',
    format: 'password',
    minLength: 8,
  })
  @IsPasswordPolicy()
  password!: string;
}
