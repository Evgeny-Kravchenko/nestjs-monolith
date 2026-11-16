import Joi from 'joi';

import { Config } from './config.types';

export const configValidationSchema = Joi.object<Config>({
  PORT: Joi.number().port().required(),
  NODE_ENV: Joi.string().valid('development', 'production').required(),

  /**
   * Cookie secret
   */
  COOKIE_SECRET: Joi.string().required(),

  /**
   * Health check options
   */
  HEALTH_CHECK_ENABLED: Joi.boolean().optional().default(false),

  /**
   * Throttler options
   */
  THROTTLE_GLOBAL_TTL: Joi.number().optional().default(10000),
  THROTTLE_GLOBAL_LIMIT: Joi.number().optional().default(10),

  /**
   * PostgreSQL database options
   */
  POSTGRES_HOST: Joi.string().hostname().required(),
  POSTGRES_PORT: Joi.number().port().required(),
  POSTGRES_USER: Joi.string().required(),
  POSTGRES_PASSWORD: Joi.string().required(),
  POSTGRES_DB: Joi.string().required(),
  POSTGRES_SYNCHRONIZE: Joi.boolean().optional().default(false),
  POSTGRES_LOGGING: Joi.boolean().optional().default(false),
  POSTGRES_MIGRATIONS_RUN: Joi.boolean().optional().default(false),

  /**
   * Registration options
   */
  REGISTRATION_VERIFICATION_ENABLED: Joi.boolean().optional().default(false),
  REGISTRATION_VERIFICATION_METHOD: Joi.string()
    .valid('otp', 'magic_link')
    .optional()
    .default('otp'),
  REGISTRATION_SECRET_KEY: Joi.string().min(32).required(),
  REGISTRATION_MAGIC_LINK_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional()
    .default('http://localhost:4200/register/confirm'),
  REGISTRATION_THROTTLE_TTL: Joi.number().optional().default(60000),
  REGISTRATION_THROTTLE_LIMIT: Joi.number().optional().default(5),

  /**
   * Mail (SMTP) options
   */
  SMTP_HOST: Joi.string().hostname().required(),
  SMTP_PORT: Joi.number().port().required(),
  SMTP_SECURE: Joi.boolean().optional().default(false),
  // Empty values are allowed: local interceptors such as Mailpit need no credentials
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASSWORD: Joi.string().allow('').optional(),
  MAIL_FROM: Joi.string().required(),
});
