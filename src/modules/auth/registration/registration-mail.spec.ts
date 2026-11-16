import { buildMagicLinkMail, buildOtpMail } from './registration-mail';

describe('registration mail', () => {
  describe('buildOtpMail', () => {
    const to = 'new@example.com';
    const code = '000042';
    const mail = buildOtpMail(to, code);

    it('should address the recipient with the registration subject', () => {
      expect(mail.to).toBe(to);
      expect(mail.subject).toBe('Confirm your registration');
    });

    it.each(['text', 'html'] as const)(
      'should contain the code with its leading zeros and the validity in %s',
      (part) => {
        expect(mail[part]).toContain(code);
        expect(mail[part]).toContain('10 minutes');
      },
    );

    it('should contain no attempt id', () => {
      const uuid =
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

      for (const part of [mail.subject, mail.text, mail.html]) {
        expect(part).not.toMatch(uuid);
        expect(part.toLowerCase()).not.toContain('attempt');
      }
    });
  });

  describe('buildMagicLinkMail', () => {
    const to = 'new@example.com';
    const link =
      'https://app.example.com/confirm?source=mail&token=abc_DEF-123';
    const mail = buildMagicLinkMail(to, link);

    it('should address the recipient with the registration subject', () => {
      expect(mail.to).toBe(to);
      expect(mail.subject).toBe('Confirm your registration');
    });

    it('should contain the link and the validity in the text', () => {
      expect(mail.text).toContain(link);
      expect(mail.text).toContain('10 minutes');
    });

    it('should link to the HTML-escaped URL in the html', () => {
      expect(mail.html).toContain(
        'href="https://app.example.com/confirm?source=mail&amp;token=abc_DEF-123"',
      );
      expect(mail.html).toContain('10 minutes');
    });
  });
});
