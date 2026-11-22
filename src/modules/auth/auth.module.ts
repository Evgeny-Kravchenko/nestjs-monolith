import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MailModule } from '@/core/mail/mail.module';
import { UsersModule } from '@/modules/users/users.module';

import { PasswordHasher } from './registration/password-hasher';
import { RegistrationChallenge } from './registration/registration-challenge.entity';
import { RegistrationController } from './registration/registration.controller';
import { RegistrationService } from './registration/registration.service';
import { SecretHasher } from './registration/secret-hasher';

@Module({
  imports: [
    TypeOrmModule.forFeature([RegistrationChallenge]),
    MailModule,
    UsersModule,
  ],
  controllers: [RegistrationController],
  providers: [RegistrationService, PasswordHasher, SecretHasher],
})
export class AuthModule {}
