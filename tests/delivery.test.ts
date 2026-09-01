import { describe, it, expect, vi, beforeAll } from 'vitest';
import { sendMessagesWithRetry } from '../src/core/deliveryService.js';

describe('Delivery Service with Retry Mechanism', () => {
  beforeAll(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'mock_bot_token_12345';
    process.env.TELEGRAM_CHAT_ID = '123456789';
  });

  it('should deliver successfully on first try when bot API succeeds', async () => {
    const mockSendMessage = vi.fn().mockResolvedValue({ message_id: 123 });
    const mockBot = {
      api: {
        sendMessage: mockSendMessage,
      },
    } as any;

    const result = await sendMessagesWithRetry(mockBot, 'test-job', '<b>Hello World</b>', {
      customChatId: '123456789',
      overrideMaxRetries: 3,
      overrideRetryDelayMs: 10,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('should retry up to maxRetries when API fails and succeed if subsequent attempt passes', async () => {
    let callCount = 0;
    const mockSendMessage = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error('Telegram API 502 Bad Gateway');
      }
      return { message_id: 456 };
    });

    const mockBot = {
      api: {
        sendMessage: mockSendMessage,
      },
    } as any;

    const result = await sendMessagesWithRetry(mockBot, 'test-job', ['Message 1', 'Message 2'], {
      customChatId: '123456789',
      overrideMaxRetries: 3,
      overrideRetryDelayMs: 10,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3); // Failed 2 times, succeeded on 3rd attempt
  });

  it('should fail gracefully and log error after exceeding max retries (3 retries)', async () => {
    const mockSendMessage = vi.fn().mockRejectedValue(new Error('Network timeout'));
    const mockBot = {
      api: {
        sendMessage: mockSendMessage,
      },
    } as any;

    const result = await sendMessagesWithRetry(mockBot, 'test-job', 'Test message', {
      customChatId: '123456789',
      overrideMaxRetries: 3,
      overrideRetryDelayMs: 10,
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(4); // initial + 3 retries = 4
    expect(result.error).toContain('Network timeout');
  });
});
