import { MailDeliveryError, OutgoingMail } from '@/core/mail/mail.types';

export class InMemoryMailService {
  readonly sent: OutgoingMail[] = [];
  private pendingFailures = 0;

  send(mail: OutgoingMail): Promise<void> {
    if (this.pendingFailures > 0) {
      this.pendingFailures -= 1;
      return Promise.reject(new MailDeliveryError());
    }
    this.sent.push(mail);
    return Promise.resolve();
  }

  failNext(count = 1): void {
    this.pendingFailures += count;
  }

  lastTo(email: string): OutgoingMail | undefined {
    return this.sent.filter((mail) => mail.to === email).at(-1);
  }

  clear(): void {
    this.sent.length = 0;
    this.pendingFailures = 0;
  }
}
