import { Injectable } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';

import { ConfigService } from '@/core/config/config.service';

import { MailDeliveryError, OutgoingMail } from './mail.types';

@Injectable()
export class MailService {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    const user = config.get('SMTP_USER');

    // Short timeouts keep the 503 path prompt when the mail server is down
    this.transport = createTransport({
      host: config.get('SMTP_HOST'),
      port: Number(config.get('SMTP_PORT')),
      secure: String(config.get('SMTP_SECURE')) === 'true',
      ...(user ? { auth: { user, pass: config.get('SMTP_PASSWORD') } } : {}),
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 20000,
    });
    this.from = config.get('MAIL_FROM');
  }

  async send(mail: OutgoingMail): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    } catch {
      // The transport error may echo the recipient or body, so it is not propagated
      throw new MailDeliveryError();
    }
  }
}
