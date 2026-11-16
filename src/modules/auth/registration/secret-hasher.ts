import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ConfigService } from '@/core/config/config.service';

@Injectable()
export class SecretHasher {
  private readonly key: string;

  constructor(config: ConfigService) {
    this.key = config.get('REGISTRATION_SECRET_KEY');
  }

  generateCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  // Bound to the attempt so equal codes of two attempts never share a digest
  digestCode(attemptId: string, code: string): string {
    return this.hmac(`${attemptId}:${code}`);
  }

  digestToken(token: string): string {
    return this.hmac(token);
  }

  matches(expectedHex: string, actualHex: string): boolean {
    const expected = Buffer.from(expectedHex);
    const actual = Buffer.from(actualHex);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  private hmac(input: string): string {
    return createHmac('sha256', this.key).update(input).digest('hex');
  }
}
