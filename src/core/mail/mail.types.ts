export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export class MailDeliveryError extends Error {
  constructor(message = 'Mail could not be delivered') {
    super(message);
    this.name = 'MailDeliveryError';
  }
}
