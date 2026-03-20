import { describe, it, expect, vi, afterEach } from 'vitest';

describe('Email Config', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getTransporter', () => {
    it('should return null when SMTP_HOST is not set', async () => {
      delete process.env.SMTP_HOST;
      vi.resetModules();
      vi.doMock('nodemailer', () => ({
        createTransport: vi.fn(),
      }));

      const { getTransporter } = await import('./email');
      expect(getTransporter()).toBeNull();
    });

    it('should return a transporter when SMTP_HOST is set', async () => {
      process.env.SMTP_HOST = 'smtp.test.local';
      process.env.SMTP_PORT = '587';
      vi.resetModules();

      const mockTransporter = {
        sendMail: vi.fn(),
        verify: vi.fn().mockResolvedValue(true),
      };
      vi.doMock('nodemailer', () => ({
        createTransport: vi.fn().mockReturnValue(mockTransporter),
      }));

      const { getTransporter } = await import('./email');
      expect(getTransporter()).not.toBeNull();

      delete process.env.SMTP_HOST;
    });
  });

  describe('getFromAddress', () => {
    it('should return default from address when SMTP_FROM is not set', async () => {
      delete process.env.SMTP_FROM;
      delete process.env.SMTP_HOST;
      vi.resetModules();
      vi.doMock('nodemailer', () => ({
        createTransport: vi.fn(),
      }));

      const { getFromAddress } = await import('./email');
      expect(getFromAddress()).toBe('Axiom <noreply@axiom.local>');
    });

    it('should return custom from address when SMTP_FROM is set', async () => {
      process.env.SMTP_FROM = 'Custom <custom@example.com>';
      delete process.env.SMTP_HOST;
      vi.resetModules();
      vi.doMock('nodemailer', () => ({
        createTransport: vi.fn(),
      }));

      const { getFromAddress } = await import('./email');
      expect(getFromAddress()).toBe('Custom <custom@example.com>');

      delete process.env.SMTP_FROM;
    });
  });

  describe('transporter configuration', () => {
    it('should use secure=true for port 465', async () => {
      process.env.SMTP_HOST = 'smtp.test.local';
      process.env.SMTP_PORT = '465';
      vi.resetModules();

      const mockCreateTransport = vi.fn().mockReturnValue({
        sendMail: vi.fn(),
        verify: vi.fn().mockResolvedValue(true),
      });
      vi.doMock('nodemailer', () => ({
        createTransport: mockCreateTransport,
      }));

      await import('./email');
      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.test.local',
          port: 465,
          secure: true,
        }),
      );

      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
    });

    it('should use secure=false for non-465 ports', async () => {
      process.env.SMTP_HOST = 'smtp.test.local';
      process.env.SMTP_PORT = '587';
      vi.resetModules();

      const mockCreateTransport = vi.fn().mockReturnValue({
        sendMail: vi.fn(),
        verify: vi.fn().mockResolvedValue(true),
      });
      vi.doMock('nodemailer', () => ({
        createTransport: mockCreateTransport,
      }));

      await import('./email');
      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          secure: false,
        }),
      );

      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
    });

    it('should include auth when SMTP_USER and SMTP_PASS are set', async () => {
      process.env.SMTP_HOST = 'smtp.test.local';
      process.env.SMTP_PORT = '587';
      process.env.SMTP_USER = 'myuser';
      process.env.SMTP_PASS = 'mypass';
      vi.resetModules();

      const mockCreateTransport = vi.fn().mockReturnValue({
        sendMail: vi.fn(),
        verify: vi.fn().mockResolvedValue(true),
      });
      vi.doMock('nodemailer', () => ({
        createTransport: mockCreateTransport,
      }));

      await import('./email');
      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { user: 'myuser', pass: 'mypass' },
        }),
      );

      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
    });

    it('should omit auth when SMTP_USER is not set', async () => {
      process.env.SMTP_HOST = 'smtp.test.local';
      process.env.SMTP_PORT = '25';
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      vi.resetModules();

      const mockCreateTransport = vi.fn().mockReturnValue({
        sendMail: vi.fn(),
        verify: vi.fn().mockResolvedValue(true),
      });
      vi.doMock('nodemailer', () => ({
        createTransport: mockCreateTransport,
      }));

      await import('./email');
      const callArgs = mockCreateTransport.mock.calls[0][0];
      expect(callArgs.auth).toBeUndefined();

      delete process.env.SMTP_HOST;
    });
  });
});
