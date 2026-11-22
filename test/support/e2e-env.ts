// Runs before each e2e file loads AppModule, because ConfigModule validates the env on import.
// Test-only values for keys required at boot. dotenv never overrides existing variables, so
// these also win over .env; only variables exported in the shell running Jest take precedence.
const requiredTestDefaults: Record<string, string> = {
  REGISTRATION_SECRET_KEY: 'test-secret-key-test-secret-key-0000',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  MAIL_FROM: 'no-reply@example.test',
};

for (const [key, value] of Object.entries(requiredTestDefaults)) {
  process.env[key] ??= value;
}

// Jest sets NODE_ENV=test, which the config schema rejects (only development | production)
if (process.env.NODE_ENV === 'test') {
  process.env.NODE_ENV = 'development';
}
