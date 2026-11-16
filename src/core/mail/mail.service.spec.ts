import { Test } from '@nestjs/testing';
import { createTransport } from 'nodemailer';

import { ConfigService } from '@/core/config/config.service';

import { MailService } from './mail.service';
import { MailDeliveryError, OutgoingMail } from './mail.types';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

describe('MailService', () => {
  const mail: OutgoingMail = {
    to: 'new@example.com',
    subject: 'Confirm your registration',
    text: 'Your code is 000042',
    html: '<p>Your code is <b>000042</b></p>',
  };

  // Joi coerces the env, so at runtime port is a number and secure a boolean
  let config: Record<string, unknown>;
  let sendMail: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;

  const createService = async (): Promise<MailService> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();

    return moduleRef.get(MailService);
  };

  beforeEach(() => {
    config = {
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      MAIL_FROM: 'no-reply@example.com',
    };
    sendMail = jest
      .fn<Promise<unknown>, [Record<string, unknown>]>()
      .mockResolvedValue({ messageId: 'id' });
    jest.mocked(createTransport).mockReturnValue({
      sendMail,
    } as unknown as ReturnType<typeof createTransport>);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('transport', () => {
    it('should build the SMTP transport once from config with the timeouts', async () => {
      const service = await createService();
      await service.send(mail);
      await service.send(mail);

      expect(createTransport).toHaveBeenCalledTimes(1);
      expect(createTransport).toHaveBeenCalledWith({
        host: 'localhost',
        port: 1025,
        secure: false,
        connectionTimeout: 10000,
        greetingTimeout: 5000,
        socketTimeout: 20000,
      });
    });

    it('should accept the string forms of port and secure', async () => {
      config.SMTP_PORT = '465';
      config.SMTP_SECURE = 'true';

      await createService();

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ port: 465, secure: true }),
      );
    });

    it('should add auth when SMTP_USER is set', async () => {
      config.SMTP_USER = 'mailer';
      config.SMTP_PASSWORD = 's3cret';

      await createService();

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ auth: { user: 'mailer', pass: 's3cret' } }),
      );
    });

    it.each([
      ['empty', ''],
      ['absent', undefined],
    ])('should omit auth when SMTP_USER is %s', async (_, user) => {
      config.SMTP_USER = user;

      await createService();

      expect(createTransport).toHaveBeenCalledWith(
        expect.not.objectContaining({ auth: expect.anything() as unknown }),
      );
    });
  });

  describe('send', () => {
    it('should send the mail from MAIL_FROM', async () => {
      const service = await createService();

      await service.send(mail);

      expect(sendMail).toHaveBeenCalledWith({
        from: 'no-reply@example.com',
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    });

    it('should turn a rejected sendMail into MailDeliveryError without the message content', async () => {
      sendMail.mockRejectedValueOnce(
        new Error(`550 rejected: ${mail.to} ${mail.text} ${mail.html}`),
      );
      const service = await createService();

      const error = await service.send(mail).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MailDeliveryError);
      const { message } = error as MailDeliveryError;
      expect(message).not.toContain('000042');
      expect(message).not.toContain(mail.to);
      expect(message).not.toContain(mail.subject);
    });
  });
});
