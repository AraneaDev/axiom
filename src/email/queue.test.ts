import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' });
const mockGetTransporter = vi.fn();
const mockGetFromAddress = vi.fn().mockReturnValue('Axiom <noreply@axiom.local>');

vi.mock('../config/email', () => ({
  getTransporter: (...args: unknown[]) => mockGetTransporter(...args),
  getFromAddress: (...args: unknown[]) => mockGetFromAddress(...args),
}));

let capturedWorkerProcessor: ((job: { data: Record<string, unknown> }) => Promise<void>) | null =
  null;
let capturedWorkerEvents: Record<string, (...args: unknown[]) => void> = {};

// We need these as module-level fns that vi.mock factory can reference
const _mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-1' });
const _mockQueueClose = vi.fn().mockResolvedValue(undefined);

vi.mock('bullmq', () => {
  const mockWorkerClose = vi.fn().mockResolvedValue(undefined);
  return {
    Queue: vi.fn().mockImplementation(() => ({
      add: (...args: unknown[]) => _mockQueueAdd(...args),
      close: (...args: unknown[]) => _mockQueueClose(...args),
    })),
    Worker: vi
      .fn()
      .mockImplementation(
        (_name: string, processor: (job: { data: Record<string, unknown> }) => Promise<void>) => {
          capturedWorkerProcessor = processor;
          capturedWorkerEvents = {};
          return {
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              capturedWorkerEvents[event] = handler;
            }),
            close: mockWorkerClose,
          };
        },
      ),
  };
});

import { emailQueue, startEmailWorker, stopEmailWorker } from './queue';

describe('Email Queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedWorkerProcessor = null;
    capturedWorkerEvents = {};
  });

  // ── Queue ─────────────────────────────────────────────────

  describe('emailQueue', () => {
    it('should export emailQueue with add method', () => {
      expect(emailQueue).toBeDefined();
      expect(emailQueue.add).toBeDefined();
    });

    it('should add jobs to the queue', async () => {
      await emailQueue.add('send', {
        to: 'user@test.dev',
        recipientName: 'Test User',
        type: 'issue_assigned',
        title: 'Test Issue',
      });
      expect(_mockQueueAdd).toHaveBeenCalledWith('send', {
        to: 'user@test.dev',
        recipientName: 'Test User',
        type: 'issue_assigned',
        title: 'Test Issue',
      });
    });
  });

  // ── startEmailWorker ──────────────────────────────────────

  describe('startEmailWorker', () => {
    it('should not start worker when transporter is null', () => {
      mockGetTransporter.mockReturnValue(null);
      startEmailWorker();
      expect(capturedWorkerProcessor).toBeNull();
    });

    it('should start worker when transporter is available', () => {
      mockGetTransporter.mockReturnValue({ sendMail: mockSendMail });
      startEmailWorker();
      expect(capturedWorkerProcessor).not.toBeNull();
    });

    it('should register failed and error event handlers', () => {
      mockGetTransporter.mockReturnValue({ sendMail: mockSendMail });
      startEmailWorker();
      expect(capturedWorkerEvents['failed']).toBeDefined();
      expect(capturedWorkerEvents['error']).toBeDefined();
    });

    it('worker processor should render template and call sendMail', async () => {
      mockGetTransporter.mockReturnValue({ sendMail: mockSendMail });
      startEmailWorker();

      expect(capturedWorkerProcessor).not.toBeNull();
      await capturedWorkerProcessor!({
        data: {
          to: 'alice@test.dev',
          recipientName: 'Alice',
          type: 'issue_assigned',
          title: 'Bug in login',
          body: 'Please fix this',
          link: '/issues/1',
        },
      });

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.to).toBe('alice@test.dev');
      expect(callArgs.from).toBe('Axiom <noreply@axiom.local>');
      expect(callArgs.subject).toBe('Issue assigned: Bug in login');
      expect(callArgs.html).toContain('Alice');
      expect(callArgs.html).toContain('Please fix this');
      expect(callArgs.text).toContain('Alice');
      expect(callArgs.text).toContain('Bug in login');
    });

    it('worker should send email with correct subject for each type', async () => {
      mockGetTransporter.mockReturnValue({ sendMail: mockSendMail });
      startEmailWorker();

      const cases = [
        { type: 'issue_assigned', expected: 'Issue assigned: Title' },
        { type: 'issue_commented', expected: 'New comment: Title' },
        { type: 'pr_review_requested', expected: 'Review requested: Title' },
        { type: 'pr_merged', expected: 'Pull request merged: Title' },
        { type: 'mention', expected: 'You were mentioned: Title' },
      ];

      for (const { type, expected } of cases) {
        mockSendMail.mockClear();
        await capturedWorkerProcessor!({
          data: { to: 'a@b.com', recipientName: 'X', type, title: 'Title' },
        });
        expect(mockSendMail.mock.calls[0][0].subject).toBe(expected);
      }
    });

    it('worker should handle missing optional fields', async () => {
      mockGetTransporter.mockReturnValue({ sendMail: mockSendMail });
      startEmailWorker();

      await capturedWorkerProcessor!({
        data: {
          to: 'bob@test.dev',
          recipientName: 'Bob',
          type: 'mention',
          title: 'Mentioned you',
        },
      });

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).not.toContain('View in Axiom');
      expect(callArgs.text).not.toContain('View in Axiom');
    });
  });

  // ── stopEmailWorker ───────────────────────────────────────

  describe('stopEmailWorker', () => {
    it('should close queue without error when no worker is running', async () => {
      await expect(stopEmailWorker()).resolves.not.toThrow();
      expect(_mockQueueClose).toHaveBeenCalled();
    });
  });
});
