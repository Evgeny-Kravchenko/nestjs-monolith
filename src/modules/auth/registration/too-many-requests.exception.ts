import { HttpException, HttpStatus } from '@nestjs/common';

// Nest has no built-in 429 exception; a plain HttpException body would lack the `error` field
export class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(
      HttpException.createBody(
        message,
        'Too Many Requests',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
