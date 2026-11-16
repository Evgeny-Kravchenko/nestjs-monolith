# Config Module

A type-safe configuration module that wraps NestJS `@nestjs/config` with Joi validation. Environment variables are validated at application startup, ensuring the app fails fast if required config is missing or invalid.

## Usage

Inject `ConfigService` into any provider:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from './config/config.service';

@Injectable()
export class MyService {
  constructor(private readonly config: ConfigService) {}

  someMethod() {
    const port = this.config.get('PORT');      // Type-safe, autocomplete works
    const env = this.config.get('NODE_ENV');   // Returns 'development' | 'production'
  }
}
```

## Adding New Options

1. **Define the type** in `config.types.ts`:

```typescript
export interface Config {
  PORT: number;
  NODE_ENV: 'development' | 'production';
  DATABASE_URL: string;  // Add new option here
}
```

2. **Add validation** in `config.validation.ts`:

```typescript
export const configValidationSchema = Joi.object<Config>({
  PORT: Joi.number().port().required(),
  NODE_ENV: Joi.string().valid('development', 'production').required(),
  DATABASE_URL: Joi.string().uri().required(),  // Add validation here
});
```

3. **Set the environment variable** in your `.env` file or environment.

That's it. The new option is now type-safe and validated at startup.

## Registration and Mail Options

Used by user registration (`POST /auth/register`, `/auth/register/confirm`, `/auth/register/resend`).
Keys without a default are required: the app does not boot without them, even when verification is
off, because already-issued verification codes and links must stay confirmable and resendable.

| Key | Default | Purpose |
| --- | --- | --- |
| `REGISTRATION_VERIFICATION_ENABLED` | `false` | Require email verification for new registrations. Affects only registrations made while it is on |
| `REGISTRATION_VERIFICATION_METHOD` | `otp` | `otp` (six-digit code) or `magic_link`. Chosen by the server, never by the client |
| `REGISTRATION_SECRET_KEY` | - | HMAC key (at least 32 characters) for stored codes and link tokens. Rotating it invalidates every outstanding code and link; guests recover through resend |
| `REGISTRATION_MAGIC_LINK_BASE_URL` | `http://localhost:4200/register/confirm` | Frontend page the emailed link points to; the token is appended as `?token=`. Opening it never activates the account |
| `REGISTRATION_THROTTLE_TTL` | `60000` | Registration rate-limit window, in milliseconds |
| `REGISTRATION_THROTTLE_LIMIT` | `5` | Registration requests allowed per client IP per window |
| `SMTP_HOST` | - | SMTP server. Locally `localhost` (Mailpit), or `mailpit` when the backend runs in docker compose |
| `SMTP_PORT` | - | SMTP port (`1025` for Mailpit) |
| `SMTP_SECURE` | `false` | Use implicit TLS (typically port 465) |
| `SMTP_USER` / `SMTP_PASSWORD` | - | SMTP credentials; may be empty for Mailpit |
| `MAIL_FROM` | - | Sender address of verification emails |
