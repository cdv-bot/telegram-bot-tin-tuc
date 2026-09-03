import { defineJob } from '../../core/job.js';
import { fetchGitHubTrending } from './fetcher.js';
import { formatGitHubTrendingToHtml } from './formatter.js';

export const githubTrendingJob = defineJob({
  id: 'github-trending',
  name: 'GitHub Trending Repositories',
  description: 'Top các repository nổi bật và thịnh hành nhất trên GitHub',
  cronSchedule: process.env.GITHUB_TRENDING_CRON || '0 9 * * *',
  autoSchedule: process.env.GITHUB_TRENDING_AUTO === 'true', // Mặc định tắt tự động gửi, chỉ chạy khi gõ lệnh Bot
  command: 'github_trending',
  botType: 'MAIN',
  targetChatId: (config) => config.TELEGRAM_GITHUB_CHAT_ID || config.TELEGRAM_CHAT_ID,
  retryConfig: {
    maxRetries: 2,
    retryDelayMs: 60000,
  },

  async run(ctx) {
    ctx.logger.info('Bắt đầu quy trình lấy danh sách GitHub Trending...');

    const repos = await fetchGitHubTrending({
      limit: 10,
      since: 'daily',
    });

    const formattedMessages = formatGitHubTrendingToHtml(repos, {
      since: 'daily',
    });

    return formattedMessages;
  },
});

export default githubTrendingJob;
export * from './fetcher.js';
export * from './formatter.js';
