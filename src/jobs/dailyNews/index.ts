import { defineJob } from '../../core/job.js';
import { fetchAllSources } from './fetcher.js';
import { filterAndDeduplicateArticles, recordSentArticles } from './deduplicator.js';
import { buildDailyDigestAsync } from './summarizer.js';
import { formatDigestToHtml } from './formatter.js';

export const dailyNewsJob = defineJob({
  id: 'daily-news',
  name: 'Bản Tin Tóm Tắt Buổi Sáng',
  description: 'Tự động thu thập, lọc trùng và gửi điểm tin tức hàng ngày',
  cronSchedule: process.env.CRON_SCHEDULE || '30 6 * * *',
  command: 'digest',
  botType: 'MAIN',
  targetChatId: (config) => config.TELEGRAM_NEWS_CHAT_ID || config.TELEGRAM_CHAT_ID,
  retryConfig: {
    maxRetries: 3,
    retryDelayMs: 300000, // 5 phút
  },

  async run(ctx) {
    ctx.logger.info('Bắt đầu quy trình thu thập và xử lý bản tin tin tức...');

    // 1. Thu thập tin thô từ các nguồn RSS
    const rawArticles = await fetchAllSources();

    // 2. Lọc trùng lặp & loại bài đã gửi trong 48h
    const uniqueArticles = filterAndDeduplicateArticles(rawArticles);

    // 3. Tóm tắt với AI 9Router và tạo DailyDigest
    const digest = await buildDailyDigestAsync(uniqueArticles);

    // 4. Định dạng sang HTML Telegram
    const formattedMessages = formatDigestToHtml(digest);

    // 5. Lưu vết bài viết đã gửi để tránh lặp lại
    const articlesToRecord: { link: string; title: string }[] = [];
    for (const cat of digest.categories) {
      for (const art of cat.articles) {
        articlesToRecord.push({ link: art.link, title: art.title });
      }
    }
    recordSentArticles(articlesToRecord);

    // Trả về danh sách message HTML cần gửi, Core Engine sẽ tự động gửi kèm retry 3 lần x 5 phút!
    return formattedMessages;
  },
});

export default dailyNewsJob;
