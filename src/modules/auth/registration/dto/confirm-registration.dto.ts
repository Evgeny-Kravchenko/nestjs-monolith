import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  registerDecorator,
  ValidationArguments,
} from 'class-validator';

const present = (value: unknown): boolean =>
  value !== undefined && value !== null;

// Registered on a key of its own: @IsOptional on the real fields would skip it when they are absent
function IsSingleConfirmForm(): ClassDecorator {
  return (target) => {
    registerDecorator({
      target,
      propertyName: 'form',
      options: { message: 'Provide either attemptId and code, or token' },
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const dto = args.object as ConfirmRegistrationDto;
          const withCode = present(dto.attemptId) && present(dto.code);
          const anyCodePart = present(dto.attemptId) || present(dto.code);
          return present(dto.token) ? !anyCodePart : withCode;
        },
      },
    });
  };
}

@IsSingleConfirmForm()
export class ConfirmRegistrationDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Sent together with `code`; omit when sending `token`',
  })
  @IsOptional()
  @IsUUID()
  attemptId?: string;

  @ApiPropertyOptional({ example: '042817', description: 'Six digits' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  code?: string;

  @ApiPropertyOptional({
    description:
      'base64url of 32 random bytes (43 characters); send alone, without `attemptId` and `code`',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  token?: string;
}
