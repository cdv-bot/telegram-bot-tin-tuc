import { describe, it, expect, vi, beforeAll } from 'vitest';
import { defineJob } from '../src/core/job.js';
import { jobRegistry } from '../src/core/jobRegistry.js';
import { schedulerEngine } from '../src/core/schedulerEngine.js';

describe('Job Plugin System & Extensibility', () => {
  beforeAll(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'mock_bot_token_12345';
    process.env.TELEGRAM_CHAT_ID = '123456789';
  });

  it('should easily define and register a new custom automation job', async () => {
    const mockSendMessage = vi.fn().mockResolvedValue({ message_id: 999 });
    const mockBot = {
      api: {
        sendMessage: mockSendMessage,
      },
    } as any;

    // Định nghĩa 1 tính năng mới cực kỳ đơn giản (Ví dụ: Thời tiết)
    const customWeatherJob = defineJob({
      id: 'weather-hanoi',
      name: 'Dự báo thời tiết Hà Nội',
      description: 'Gửi dự báo thời tiết lúc 7h00 sáng',
      cronSchedule: '0 7 * * *',
      command: 'weather',
      async run(ctx) {
        return `☀️ <b>Hà Nội hôm nay:</b> Nắng đẹp, 29°C!`;
      },
    });

    jobRegistry.register(customWeatherJob);
    schedulerEngine.setBot(mockBot);

    // Kích hoạt thực thi
    const result = await schedulerEngine.executeJob(customWeatherJob, {
      customChatId: '123456789',
      overrideRetryDelayMs: 10,
    });

    expect(result.success).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456789',
      '☀️ <b>Hà Nội hôm nay:</b> Nắng đẹp, 29°C!',
      expect.anything()
    );

    const retrieved = jobRegistry.getByCommand('weather');
    expect(retrieved?.id).toBe('weather-hanoi');
  });
});
